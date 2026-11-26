// A provider's limits on one tool's parameters schema. Fitting keeps the schema the model reads under them; the server
// still validates every call against its own full schema.
type Json = Record<string, unknown>;

export type ToolSchemaProfileId = "moonshot" | "antigravity";

export interface ToolSchemaProfile {
  id: ToolSchemaProfileId;
  /** The provider as the person knows it, for log lines and the note a shortened tool carries. */
  provider: string;
  maxSchemaBytes: number;
  /** Optional ceiling on the whole serialized `{ name, description, parameters }` tool entry. */
  maxToolBytes?: number;
  /** Optional ceiling on the sum of serialized tool entries returned by one MCP server's `tools/list`. */
  maxListBytes?: number;
  maxDepth: number;
  /** The engine inlines local `$ref`s before it sends, so the inlined form is what the provider measures. */
  measureInlined: boolean;
}

const PROFILES: Record<ToolSchemaProfileId, ToolSchemaProfile> = {
  // Moonshot refuses the whole request when one tool's `function.parameters`, as Go's encoding/json writes it, passes an
  // undocumented size (about 13.7 KB accepted, 15 KB refused): https://github.com/MoonshotAI/kimi-code/issues/4231,
  // https://github.com/morluto/rea/issues/3654. Depth 30 is walle's default (https://github.com/MoonshotAI/walle/blob/main/conf.go).
  // Kimi Code inlines every local $ref first (normalizeKimiToolSchema in MoonshotAI/kimi-code packages/kosong).
  moonshot: { id: "moonshot", provider: "Kimi", maxSchemaBytes: 12_000, maxDepth: 30, measureInlined: true },
  // Antigravity ACP packs MCP tools smallest-first into a ~60 KB total budget across all MCP servers; capping each tool at
  // 1,250 B and each server list at 36 KB keeps agents + browser + data (~51 KB combined) safely inside budget so visual
  // tools (`show_html`, `show_widget`, `data_show`) and coordination tools (`coordinate_bots`, `trigger`) all load.
  antigravity: { id: "antigravity", provider: "Antigravity", maxSchemaBytes: 1_250, maxToolBytes: 1_250, maxListBytes: 36_000, maxDepth: 20, measureInlined: false },
};

export const TOOL_SCHEMA_PROFILE_ENV = "OMB_TOOL_SCHEMA_PROFILE";
export const TOOL_SCHEMA_PROFILE_HEADER = "x-omb-tool-schema-profile";

export function toolSchemaProfile(id: unknown): ToolSchemaProfile | undefined {
  return typeof id === "string" && Object.hasOwn(PROFILES, id) ? PROFILES[id as ToolSchemaProfileId] : undefined;
}

export function toolSchemaProfileFromEnv(env: Record<string, string | undefined> = process.env): ToolSchemaProfile | undefined {
  return toolSchemaProfile(env[TOOL_SCHEMA_PROFILE_ENV]);
}

function hostOf(url: string | undefined): string {
  try { return url ? new URL(url).hostname.toLowerCase() : ""; } catch { return ""; }
}

const MOONSHOT_HOST = /(?:^|\.)(?:moonshot\.ai|moonshot\.cn|kimi\.com|kimi\.ai)$/;
const OPENROUTER_HOST = /(?:^|\.)openrouter\.ai$/;

/** Kimi Code always reaches Moonshot. Any other engine does when its endpoint is Moonshot's own, or when OpenRouter may
 * route one of Moonshot's models to Moonshot's endpoint. */
export function toolSchemaProfileFor(target: { engine?: string; url?: string; model?: string }): ToolSchemaProfile | undefined {
  const host = hostOf(target.url);
  if (target.engine === "antigravityAgent") return PROFILES.antigravity;
  if (target.engine === "kimiAgent" || MOONSHOT_HOST.test(host)) return PROFILES.moonshot;
  if (OPENROUTER_HOST.test(host) && /^moonshotai\//i.test(target.model ?? "")) return PROFILES.moonshot;
  return undefined;
}

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The length Go's encoding/json gives: compact, with `<`, `>` and `&` written as six-byte escapes, as are U+2028/U+2029. */
export function schemaBytes(value: unknown): number {
  const text = JSON.stringify(value) ?? "";
  return Buffer.byteLength(text) + 5 * (text.match(/[<>&]/g)?.length ?? 0) + 3 * (text.match(/[\u2028\u2029]/g)?.length ?? 0);
}

const MAP_SLOTS = ["properties", "patternProperties", "dependencies", "dependentSchemas", "$defs", "definitions"] as const;
const NESTED_SLOTS = ["additionalProperties", "items", "additionalItems", "contains", "propertyNames", "contentSchema", "unevaluatedProperties", "unevaluatedItems"] as const;
const NESTED_LISTS = ["prefixItems", "items"] as const;
/** Alternatives describe the same value, so they sit at its depth. */
const ALTERNATIVE_LISTS = ["anyOf", "oneOf", "allOf"] as const;
const ALTERNATIVES = ["not", "if", "then", "else"] as const;

/** Every subschema with its depth: a property, item or definition is one deeper than its parent. */
function walk(node: unknown, depth: number, visit: (node: Json, depth: number) => void): void {
  if (!isObject(node)) return;
  visit(node, depth);
  for (const slot of MAP_SLOTS) if (isObject(node[slot])) for (const child of Object.values(node[slot])) walk(child, depth + 1, visit);
  for (const slot of NESTED_SLOTS) walk(node[slot], depth + 1, visit);
  for (const slot of NESTED_LISTS) if (Array.isArray(node[slot])) for (const item of node[slot]) walk(item, depth + 1, visit);
  for (const slot of ALTERNATIVE_LISTS) if (Array.isArray(node[slot])) for (const item of node[slot]) walk(item, depth, visit);
  for (const slot of ALTERNATIVES) walk(node[slot], depth, visit);
}

function schemaDepth(schema: Json): number {
  let deepest = 0;
  walk(schema, 0, (_node, depth) => { deepest = Math.max(deepest, depth); });
  return deepest;
}

function pointer(root: Json, ref: string): unknown {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const part = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current) && /^(?:0|[1-9]\d*)$/.test(part)) current = current[Number(part)];
    else if (isObject(current) && Object.hasOwn(current, part)) current = current[part];
    else return undefined;
  }
  return current;
}

function dropUnusedDefinitions(schema: Json): void {
  const rest = JSON.stringify(Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$defs" && key !== "definitions")));
  for (const bucket of ["$defs", "definitions"]) if (!rest.includes(`"#/${bucket}/`)) delete schema[bucket];
}

const INLINE_NODE_BUDGET = 200_000;

/** Local refs inlined the way Kimi Code inlines them, siblings winning; a cyclic ref stays a ref beside the definitions
 * it needs. Undefined when inlining would build more than INLINE_NODE_BUDGET nodes. */
function inlineRefs(schema: Json): Json | undefined {
  let nodes = 0;
  const resolve = (node: unknown, stack: Set<string>): unknown => {
    if (++nodes > INLINE_NODE_BUDGET) throw new RangeError("inline budget");
    if (Array.isArray(node)) return node.map((item) => resolve(item, stack));
    if (!isObject(node)) return node;
    const ref = node.$ref;
    const target = typeof ref === "string" && !stack.has(ref) ? pointer(schema, ref) : undefined;
    if (typeof ref === "string" && target !== undefined) {
      stack.add(ref);
      const resolved = resolve(target, stack);
      stack.delete(ref);
      if (!isObject(resolved)) return resolved;
      const merged: Json = { ...resolved };
      for (const [key, value] of Object.entries(node)) if (key !== "$ref") merged[key] = resolve(value, stack);
      return merged;
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, resolve(value, stack)]));
  };
  try {
    const inlined = resolve(schema, new Set()) as Json;
    dropUnusedDefinitions(inlined);
    return inlined;
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

function fits(schema: Json, profile: ToolSchemaProfile): boolean {
  return schemaBytes(schema) <= profile.maxSchemaBytes && schemaDepth(schema) <= profile.maxDepth;
}

/** Words for people and tooling: none of them constrains a value. */
const ANNOTATIONS = new Set(["examples", "example", "$comment", "title", "deprecated", "readOnly", "writeOnly", "$schema", "$id"]);

function stripAnnotations(schema: Json): void {
  walk(schema, 0, (node) => {
    for (const key of Object.keys(node)) if (ANNOTATIONS.has(key) || key.startsWith("x-")) delete node[key];
  });
}

function shortened(text: unknown, chars: number): string | undefined {
  if (typeof text !== "string" || !text.trim() || chars <= 0) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= chars ? flat : `${flat.slice(0, chars - 1).replace(/\s+\S*$/, "")}…`;
}

function shortenDescriptions(schema: Json, fromDepth: number, chars: number): void {
  walk(schema, 0, (node, depth) => {
    if (depth < fromDepth) return;
    const description = shortened(node.description, chars);
    if (description) node.description = description;
    else delete node.description;
  });
}

const JSON_TYPES = ["string", "number", "integer", "boolean", "object", "array", "null"];

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value === "object" ? "object" : typeof value;
}

function hasReferencedType(node: Json, root: Json): boolean {
  const seen = new Set<Json>();
  let current = node;
  while (typeof current.$ref === "string" && !seen.has(current)) {
    seen.add(current);
    const target = pointer(root, current.$ref);
    if (!isObject(target)) return false;
    if ("type" in target) return true;
    current = target;
  }
  return false;
}

/** Kimi Code 2.7.2 tries to infer a single type from each untyped enum, even for a nullable field. */
function withTypedMixedEnums(schema: Json): Json {
  const copy = structuredClone(schema);
  let changed = false;
  walk(copy, 0, (node) => {
    if ("type" in node || !Array.isArray(node.enum) || hasReferencedType(node, copy)) return;
    const types = new Set(node.enum.map(valueType));
    if (types.has("number")) types.delete("integer");
    if (types.size < 2) return;
    node.type = [...types];
    changed = true;
  });
  return changed ? copy : schema;
}

function typesOf(node: Json, root: Json, hops = 0): string[] {
  if (hops > 16) return [];
  if (typeof node.type === "string") return [node.type];
  if (Array.isArray(node.type)) return node.type.filter((type): type is string => typeof type === "string");
  const target = typeof node.$ref === "string" ? pointer(root, node.$ref) : undefined;
  if (isObject(target)) return typesOf(target, root, hops + 1);
  const branches = ALTERNATIVE_LISTS.flatMap((slot) => Array.isArray(node[slot]) ? node[slot].filter(isObject) : []);
  if (branches.length) return [...new Set(branches.flatMap((branch) => typesOf(branch, root, hops + 1)))];
  if (Array.isArray(node.enum) && node.enum.length) return [...new Set(node.enum.map(valueType))];
  if ("const" in node) return [valueType(node.const)];
  if (isObject(node.properties) || "additionalProperties" in node || Array.isArray(node.required)) return ["object"];
  if ("items" in node || "prefixItems" in node) return ["array"];
  return [];
}

/** A subschema's type and nothing inside it, valid where Moonshot wants every subschema typed; a free-form object names
 * additionalProperties because a bare `{"type":"object"}` reads there as recursion without end, and every array keeps an
 * `items` schema because Gemini/Antigravity rejects `{"type":"array"}` without `items`. */
function placeholder(node: Json, root: Json): Json {
  const types = typesOf(node, root).filter((type) => JSON_TYPES.includes(type));
  const unique = [...new Set(types.map((type) => (type === "integer" && types.includes("number") ? "number" : type)))];
  if (unique.length !== 1) {
    const out: Json = { type: unique.length ? unique : JSON_TYPES };
    if (unique.includes("array")) out.items = { type: "string" };
    return out;
  }
  const type = unique[0]!;
  if (type === "object") return { type, additionalProperties: true };
  if (type === "array") {
    const itemNode = isObject(node.items) ? node.items : undefined;
    const itemTypes = itemNode ? typesOf(itemNode, root).filter((t) => JSON_TYPES.includes(t) && t !== "null") : [];
    const itemUnique = [...new Set(itemTypes.map((t) => (t === "integer" && itemTypes.includes("number") ? "number" : t)))];
    const itemType = itemUnique.length === 1 ? itemUnique[0]! : "string";
    const items: Json = itemType === "object"
      ? { type: "object", additionalProperties: true }
      : itemType === "array"
        ? { type: "array", items: { type: "string" } }
        : { type: itemType };
    return { type: "array", items };
  }
  const choices = Array.isArray(node.enum) ? node.enum : "const" in node ? [node.const] : undefined;
  const sameType = (value: unknown) => valueType(value) === type || (type === "number" && valueType(value) === "integer");
  const keep = choices && choices.length <= 64 && choices.every(sameType) && schemaBytes(choices) <= 1_024;
  return keep ? { type, enum: choices } : { type };
}

/** Gemini/Antigravity rejects any `type: "array"` schema without an `items` object (HTTP 400 INVALID_ARGUMENT). */
function ensureArrayItems(schema: Json): void {
  walk(schema, 0, (node) => {
    const isArray = node.type === "array" || (Array.isArray(node.type) && node.type.includes("array"));
    if (isArray && !("items" in node)) {
      node.items = { type: "string" };
    }
  });
}

/** Each subschema at `depth` becomes its placeholder; its parent keeps every field name and `required`. */
function collapseAt(schema: Json, depth: number): void {
  walk(schema, 0, (node, at) => {
    if (at !== depth - 1) return;
    for (const slot of MAP_SLOTS) {
      const map = node[slot];
      if (isObject(map)) for (const [key, child] of Object.entries(map)) if (isObject(child)) map[key] = placeholder(child, schema);
    }
    for (const slot of NESTED_SLOTS) if (isObject(node[slot])) node[slot] = placeholder(node[slot], schema);
    for (const slot of NESTED_LISTS) {
      const list = node[slot];
      if (Array.isArray(list)) list.forEach((item, index) => { if (isObject(item)) list[index] = placeholder(item, schema); });
    }
  });
  dropUnusedDefinitions(schema);
}

function topLevelOnly(schema: Json, descriptionChars: number): Json {
  const declared = isObject(schema.properties) ? schema.properties : {};
  const properties: Json = {};
  for (const [key, child] of Object.entries(declared)) {
    const flat = isObject(child) ? placeholder(child, schema) : { type: JSON_TYPES };
    const description = isObject(child) ? shortened(child.description, descriptionChars) : undefined;
    properties[key] = description ? { ...flat, description } : flat;
  }
  const required = Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string" && Object.hasOwn(properties, key)) : [];
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: true };
}

/** kept: every field, constraint and annotation kept. trimmed: every field and constraint kept, fewer words. loosened: fields deeper in are
 * left to the tool's description. minimal: only the top-level fields. dropped: not even those fit. */
export type SchemaFit =
  | { outcome: "kept"; schema: Json; bytes: number }
  | { outcome: "trimmed" | "loosened" | "minimal"; schema: Json; bytes: number; from: number }
  | { outcome: "dropped"; bytes: number; from: number };

/** Least loss first, stopping at the first form that fits. */
export function fitToolSchema(schema: Json, profile: ToolSchemaProfile): SchemaFit {
  const typed = profile.id === "moonshot" ? withTypedMixedEnums(schema) : schema;
  const measured = profile.measureInlined ? inlineRefs(typed) : typed;
  const from = schemaBytes(measured ?? typed);
  if (measured && fits(measured, profile)) return { outcome: "kept", schema: typed, bytes: from };
  const fitted = (outcome: "trimmed" | "loosened" | "minimal", form: Json): SchemaFit => ({ outcome, schema: form, bytes: schemaBytes(form), from });

  const working = structuredClone(measured ?? typed);
  if (measured) {
    stripAnnotations(working);
    if (fits(working, profile)) return fitted("trimmed", working);
    for (let depth = schemaDepth(working); depth >= 2; depth -= 1) {
      shortenDescriptions(working, depth, 0);
      if (fits(working, profile)) return fitted("trimmed", working);
    }
    shortenDescriptions(working, 0, 300);
    if (fits(working, profile)) return fitted("trimmed", working);
    for (let depth = schemaDepth(working); depth >= 2; depth -= 1) {
      collapseAt(working, depth);
      if (fits(working, profile)) return fitted("loosened", working);
    }
  }
  for (const chars of [120, 0]) {
    const top = topLevelOnly(working, chars);
    if (fits(top, profile)) return fitted("minimal", top);
  }
  return { outcome: "dropped", bytes: schemaBytes(topLevelOnly(working, 0)), from };
}

/** Validation bounds the server still enforces on every call; dropping them from an advertised schema loses no field names or types. */
const SERVER_ENFORCED_BOUNDS = new Set([
  "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "uniqueItems", "pattern", "maxProperties",
]);

function stripBoundsAndAnnotations(schema: Json): void {
  walk(schema, 0, (node) => {
    for (const key of Object.keys(node)) {
      if (ANNOTATIONS.has(key) || SERVER_ENFORCED_BOUNDS.has(key) || key.startsWith("x-")) delete node[key];
      else if (key === "additionalProperties" && node[key] === false) delete node[key];
    }
  });
}

function toolEntryBytes(name: string, description: string, parameters: Json): number {
  return schemaBytes({ name, description, parameters });
}

function fitDescriptionToBudget(name: string, description: string, parameters: Json, maxBytes: number): string | undefined {
  if (toolEntryBytes(name, description, parameters) <= maxBytes) return description;
  if (toolEntryBytes(name, "", parameters) > maxBytes) return undefined;
  let lo = 0;
  let hi = description.length;
  let best = "";
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = shortened(description, mid) ?? "";
    if (toolEntryBytes(name, candidate, parameters) <= maxBytes) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export type ToolEntryFit =
  | { outcome: "kept"; description: string; schema: Json; bytes: number }
  | { outcome: "trimmed" | "loosened" | "minimal"; description: string; schema: Json; bytes: number; from: number }
  | { outcome: "dropped"; bytes: number; from: number };

/** Fits a whole MCP tool entry (`{ name, description, parameters }`) under `profile.maxToolBytes`, keeping every field name,
 * type and enum first before shortening descriptions or collapsing nested subschemas. */
export function fitToolEntry(
  entry: { name: string; description: string; inputSchema: Json },
  profile: ToolSchemaProfile,
): ToolEntryFit {
  const maxBytes = profile.maxToolBytes ?? profile.maxSchemaBytes;
  const baseSchema = structuredClone(entry.inputSchema);
  ensureArrayItems(baseSchema);
  const from = toolEntryBytes(entry.name, entry.description, baseSchema);
  if (from <= maxBytes && schemaDepth(baseSchema) <= profile.maxDepth) {
    return { outcome: "kept", description: entry.description, schema: baseSchema, bytes: from };
  }
  const done = (outcome: "trimmed" | "loosened" | "minimal", description: string, schema: Json): ToolEntryFit => ({
    outcome, description, schema, bytes: toolEntryBytes(entry.name, description, schema), from,
  });
  const tryFit = (outcome: "trimmed" | "loosened" | "minimal", schema: Json, minDescChars: number): ToolEntryFit | undefined => {
    ensureArrayItems(schema);
    if (schemaDepth(schema) > profile.maxDepth) return undefined;
    if (toolEntryBytes(entry.name, entry.description, schema) <= maxBytes) return done(outcome, entry.description, schema);
    const desc = fitDescriptionToBudget(entry.name, entry.description, schema, maxBytes);
    if (desc !== undefined && (desc.length >= minDescChars || entry.description.length <= minDescChars)) {
      return done(outcome, desc, schema);
    }
    return undefined;
  };

  const working = structuredClone(entry.inputSchema);
  stripBoundsAndAnnotations(working);
  let hit = tryFit("trimmed", working, 420);
  if (hit) return hit;

  for (const chars of [60, 0]) {
    shortenDescriptions(working, 2, chars);
    hit = tryFit("trimmed", working, 320);
    if (hit) return hit;
  }
  for (const chars of [60, 30, 0]) {
    shortenDescriptions(working, 1, chars);
    hit = tryFit("trimmed", working, 220);
    if (hit) return hit;
  }
  for (let depth = schemaDepth(working); depth >= 2; depth -= 1) {
    collapseAt(working, depth);
    hit = tryFit("loosened", working, 160);
    if (hit) return hit;
  }
  for (const chars of [40, 0]) {
    const top = topLevelOnly(working, chars);
    stripBoundsAndAnnotations(top);
    hit = tryFit("minimal", top, 0);
    if (hit) return hit;
  }
  const smallest = topLevelOnly(working, 0);
  stripBoundsAndAnnotations(smallest);
  return { outcome: "dropped", bytes: toolEntryBytes(entry.name, "", smallest), from };
}
