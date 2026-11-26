// Local Powell Model v7 / Topstep $50K Trading Desk REST endpoints.
// Bridges cleanly to /home/nebula/.gemini/antigravity/scratch/powell-backtest/trading_bridge.py.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

const execFileAsync = promisify(execFile);

const POWELL_DIR = process.env.POWELL_BACKTEST_DIR || "/home/nebula/.gemini/antigravity/scratch/powell-backtest";
const PYTHON_BIN = `${POWELL_DIR}/.venv/bin/python`;
const BRIDGE_SCRIPT = `${POWELL_DIR}/trading_bridge.py`;

interface CacheEntry {
  at: number;
  data: unknown;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
let cacheGen = 0;

async function runBridge(args: string[], timeoutMs = 25_000): Promise<unknown> {
  const { stdout } = await execFileAsync(PYTHON_BIN, [BRIDGE_SCRIPT, ...args], {
    cwd: POWELL_DIR,
    timeout: timeoutMs,
    maxBuffer: 12 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

async function cachedBridge(key: string, ttlMs: number, args: string[], bypass = false): Promise<unknown> {
  const now = Date.now();
  const hit = cache.get(key);
  if (!bypass && hit && now - hit.at < ttlMs) return hit.data;

  const existing = inFlight.get(key);
  if (!bypass && existing) return existing;

  const gen = cacheGen;
  const promise = runBridge(args)
    .then((data) => {
      if (cacheGen === gen) {
        cache.set(key, { at: Date.now(), data });
      }
      return data;
    })
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

function invalidateTradingCache(): void {
  cacheGen += 1;
  cache.clear();
}

export const tradingRoutes: RouteHandler = async (ctx: RouteContext) => {
  const { path, method, url, res, json, readBody } = ctx;
  if (!path.startsWith("/api/trading")) return PASS;

  try {
    if (method === "GET" && path === "/api/trading/state") {
      const refresh = url.searchParams.get("refresh") === "1";
      const data = await cachedBridge("state", 4_000, ["state"], refresh);
      json(res, 200, data);
      return;
    }

    if (method === "GET" && path === "/api/trading/chart") {
      const tf = url.searchParams.get("tf") || "5";
      const bars = url.searchParams.get("bars") || "200";
      const refresh = url.searchParams.get("refresh") === "1";
      const key = `chart:${tf}:${bars}`;
      const args = ["chart", "--tf", tf, "--bars", bars, ...(refresh ? ["--refresh"] : [])];
      const data = await cachedBridge(key, 6_000, args, refresh);
      json(res, 200, data);
      return;
    }

    if (method === "GET" && path === "/api/trading/journals") {
      const refresh = url.searchParams.get("refresh") === "1";
      const data = await cachedBridge("journals", 15_000, ["journals"], refresh);
      json(res, 200, data);
      return;
    }

    if (method === "POST" && path === "/api/trading/flatten") {
      const data = await runBridge(["flatten"], 30_000);
      invalidateTradingCache();
      json(res, 200, data);
      return;
    }

    if (method === "POST" && path === "/api/trading/config") {
      const body = (await readBody(ctx.req)) as Record<string, unknown>;
      const args = ["set-config"];
      if (typeof body.execution_mode === "string") args.push("--execution-mode", body.execution_mode);
      if (typeof body.topstep_mode === "string") args.push("--topstep-mode", body.topstep_mode);
      if (body.base_risk !== undefined && body.base_risk !== null) args.push("--base-risk", String(body.base_risk));
      const data = await runBridge(args);
      invalidateTradingCache();
      json(res, 200, data);
      return;
    }

    if (method === "POST" && path === "/api/trading/propose") {
      const body = (await readBody(ctx.req)) as Record<string, unknown>;
      const args = [
        "propose",
        "--side", String(body.side ?? "long"),
        "--type", String(body.type ?? "limit"),
        "--price", String(body.price ?? 0),
        "--attempt", String(body.attempt ?? 1),
        "--entry-type", String(body.entry_type ?? "ko_10am"),
        "--setup", String(body.setup ?? "Powell v7 Setup"),
        "--reason", String(body.reason ?? "Proposed from Trading Desk"),
      ];
      if (typeof body.rb_id === "string" && body.rb_id) args.push("--rb-id", body.rb_id);
      const data = await runBridge(args);
      invalidateTradingCache();
      json(res, 200, data);
      return;
    }

    const decideMatch = path.match(/^\/api\/trading\/approvals\/([\w-]+)\/(approve|reject)$/);
    if (method === "POST" && decideMatch) {
      const [, approvalId, action] = decideMatch;
      const data = await runBridge(["decide", "--id", approvalId, "--action", action], 30_000);
      invalidateTradingCache();
      json(res, 200, data);
      return;
    }

    return PASS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, 500, { ok: false, error: message });
  }
};
