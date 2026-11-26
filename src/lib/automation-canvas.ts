// Pure graph model and layout engine for the Automations Canvas: turns live automations, bots and their
// inferred connected systems into a 4-stage directed workflow (Triggers -> Bots -> Active Jobs -> Systems).
import { automationStatus, nextWhen, statusLine, type Automation, type AutomationStatus } from "@/lib/automations";
import { isRoutineProblemRun, type RoutineSchedule } from "@/lib/routines";
import type { Bot } from "@/state/store";

export type CanvasNodeKind = "trigger" | "bot" | "job" | "system";

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasBox {
  width: number;
  height: number;
}

export const NODE_SIZES: Record<CanvasNodeKind, CanvasBox> = {
  trigger: { width: 224, height: 96 },
  bot: { width: 248, height: 112 },
  job: { width: 276, height: 136 },
  system: { width: 220, height: 78 },
};

export const COLUMN_X: Record<CanvasNodeKind, number> = {
  trigger: 48,
  bot: 344,
  job: 668,
  system: 1024,
};

export type SystemIconKey = "exchange" | "tape" | "news" | "journal" | "benchmark" | "script" | "web" | "mail" | "calendar" | "github" | "chat";

export interface TriggerNodeData {
  kind: "trigger";
  id: string;
  automationId: string;
  automationKind: Automation["kind"];
  title: string;
  subtitle: string;
  enabled: boolean;
  status: AutomationStatus;
}

export interface BotNodeData {
  kind: "bot";
  id: string;
  botId: string;
  bot: Bot;
  supervisorOnly: boolean;
  automationCount: number;
  runningCount: number;
}

export interface JobNodeData {
  kind: "job";
  id: string;
  automationId: string;
  automation: Automation;
  summary: string;
  statusLine: string;
  status: AutomationStatus;
  running: boolean;
  tags: string[];
}

export interface SystemNodeData {
  kind: "system";
  id: string;
  systemKey: string;
  label: string;
  detail: string;
  icon: SystemIconKey;
  connectedCount: number;
}

export type CanvasNode = (TriggerNodeData | BotNodeData | JobNodeData | SystemNodeData) & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CanvasEdgeTone = "active" | "running" | "paused" | "warning" | "danger" | "oversight";

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  tone: CanvasEdgeTone;
  animated: boolean;
  dashed: boolean;
  automationId?: string;
}

export interface AutomationCanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface SystemRule {
  key: string;
  label: string;
  detail: string;
  icon: SystemIconKey;
  pattern: RegExp;
}

const SYSTEM_RULES: readonly SystemRule[] = [
  {
    key: "topstep",
    label: "TopstepX · $50K RTA",
    detail: "Balance, MLL/DLL cushion & orders",
    icon: "exchange",
    pattern: /\b(topstep|topstepx|projectx|mll|dll|pdll|combine|xfa|buying power|trading_bridge\.py\s+state)\b/i,
  },
  {
    key: "tape",
    label: "MNQ / ES Live Tape",
    detail: "NY AM execution & SMT feed",
    icon: "tape",
    pattern: /\b(live_trader\.py|mnq|nq\b|es\b|smt|10:00|ko reclaim|rejection block|ny am|flatten)\b/i,
  },
  {
    key: "news",
    label: "Forex Factory USD News",
    detail: "High-impact events & crash regime",
    icon: "news",
    pattern: /\b(forex factory|usd news|red folder|cpi|fomc|pce|nfp|volatility regime|650\s*pt|overnight range)\b/i,
  },
  {
    key: "journals",
    label: "Live Session Journals",
    detail: "Daily execution logs & EOD grades",
    icon: "journal",
    pattern: /\b(journal|journals|eod|discipline|replay|trading_bridge\.py\s+journals)\b/i,
  },
  {
    key: "benchmark",
    label: "80-Day Blind Benchmark",
    detail: "57.9% WR · PF 2.58 · Payout pace",
    icon: "benchmark",
    pattern: /\b(80[- ]day|benchmark|blind|payout|53,?000|consistency cap)\b/i,
  },
  {
    key: "github",
    label: "GitHub / Repo",
    detail: "Pull requests, commits & issues",
    icon: "github",
    pattern: /\b(github|pull request|commit|branch|repository|pr #)\b/i,
  },
  {
    key: "mail",
    label: "Email / Inbox",
    detail: "Messages & follow-ups",
    icon: "mail",
    pattern: /\b(gmail|email|inbox|mailbox|outlook)\b/i,
  },
  {
    key: "calendar",
    label: "Calendar",
    detail: "Events & schedule",
    icon: "calendar",
    pattern: /\b(google calendar|calendar event|meeting|agenda)\b/i,
  },
  {
    key: "web",
    label: "Web / Browser",
    detail: "Live pages & research",
    icon: "web",
    pattern: /\b(https?:\/\/|browser|scrape|webpage|website)\b/i,
  },
  {
    key: "script",
    label: "Local Scripts & Data",
    detail: "Python jobs & workspace files",
    icon: "script",
    pattern: /\b(\.py\b|python|script|csv|parquet|duckdb|sql)\b/i,
  },
];

/** Infers the external/workspace systems an automation reads or writes from its name and prompt. */
export function inferAutomationSystems(automation: Pick<Automation, "name" | "instructions" | "kind" | "appTrigger">): Array<Pick<SystemRule, "key" | "label" | "detail" | "icon">> {
  const haystack = `${automation.name}\n${automation.instructions}`;
  const matched: Array<Pick<SystemRule, "key" | "label" | "detail" | "icon">> = [];
  for (const rule of SYSTEM_RULES) {
    if (rule.key === "script" && matched.length > 0) continue;
    if (rule.pattern.test(haystack)) {
      matched.push({ key: rule.key, label: rule.label, detail: rule.detail, icon: rule.icon });
    }
  }
  if (matched.length === 0) {
    return [{ key: "chat", label: "Chat Thread Updates", detail: "Reports results back to chat", icon: "chat" }];
  }
  return matched.slice(0, 3);
}

/** Short human-readable trigger headline for the left-hand Trigger node. */
export function triggerHeadline(automation: Automation): string {
  if (automation.kind === "webhook") {
    return automation.eventTypes?.length ? `Webhook · ${automation.eventTypes.slice(0, 2).join(", ")}` : "Incoming Webhook";
  }
  if (automation.kind === "app") {
    const app = automation.appTrigger?.appName || automation.appTrigger?.app || "Connected App";
    const ev = automation.appTrigger?.eventName || automation.appTrigger?.event || "Event";
    return `${app} · ${ev}`;
  }
  return formatScheduleCompact(automation.schedule);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function formatScheduleCompact(schedule: RoutineSchedule | undefined): string {
  if (!schedule) return "Scheduled Run";
  if (schedule.type === "daily") {
    const days = schedule.weekdays ?? [];
    if (days.length > 0 && days.length < 7) {
      const weekdaysOnly = days.length === 5 && !days.includes(0) && !days.includes(6);
      const dayLabel = weekdaysOnly ? "Mon–Fri" : days.map((d) => DAY_NAMES[d] ?? String(d)).join(", ");
      return `${schedule.time} · ${dayLabel}`;
    }
    return `Daily · ${schedule.time}`;
  }
  if (schedule.type === "interval") {
    const unit = schedule.everyMinutes >= 60 && schedule.everyMinutes % 60 === 0
      ? `${schedule.everyMinutes / 60}h`
      : `${schedule.everyMinutes}m`;
    return `Every ${unit}`;
  }
  if (schedule.type === "once") {
    return Number.isFinite(schedule.at) ? `Once · ${nextWhen(schedule.at)}` : "One-time Run";
  }
  if (schedule.type === "cron") {
    const parsed = parseWeekdayCron(schedule.expression, schedule.timeZone);
    return parsed ?? `Cron · ${schedule.expression}`;
  }
  if (schedule.type === "limit_reset") return "On Limit Reset";
  return "Scheduled Run";
}

function parseWeekdayCron(expression: string, timeZone?: string): string | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (!/^\d{1,2}$/.test(min!) || !/^\d{1,2}$/.test(hour!) || dom !== "*" || mon !== "*") return null;
  const h = Number(hour);
  const m = Number(min);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const clock = `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`;
  const tz = timeZone === "America/New_York" ? " ET"
    : timeZone === "Europe/Berlin" ? " CET"
    : timeZone === "UTC" ? " UTC"
    : timeZone ? ` ${timeZone.split("/").at(-1)?.replace(/_/g, " ")}` : "";
  const days = dow === "1-5" || dow === "MON-FRI" ? "Mon–Fri"
    : dow === "*" ? "Daily"
    : dow;
  return `${clock}${tz} · ${days}`;
}

/** Cleans raw automation prompt text into a concise, human-readable 2-line task summary. */
export function summarizeJobInstructions(instructions: string): string {
  const lines = instructions
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^keep it concise/i.test(line) && !/^do not ask/i.test(line));
  const cleaned = lines
    .map((line) => line.replace(/`[^`]*\/[^`]*`/g, (match) => {
      const base = match.slice(1, -1).split(/\s+/).map((tok) => tok.includes("/") ? tok.split("/").at(-1) : tok).join(" ");
      return base;
    }))
    .join(" · ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Runs automated workflow instructions.";
  return cleaned.length > 130 ? `${cleaned.slice(0, 129).trimEnd()}…` : cleaned;
}

const isRunningAutomation = (automation: Automation): boolean => automation.runs.some((run) => run.status === "running");

function edgeToneFor(automation: Automation, status: AutomationStatus, botBusy: boolean): { tone: CanvasEdgeTone; animated: boolean; dashed: boolean } {
  const running = isRunningAutomation(automation);
  if (running) return { tone: "running", animated: true, dashed: false };
  if (!automation.enabled || status.state === "paused") return { tone: "paused", animated: false, dashed: true };
  if (status.state === "needs-you") return { tone: "warning", animated: false, dashed: false };
  if (automation.runs.some((run) => isRoutineProblemRun(run) && !run.seenAt)) return { tone: "danger", animated: false, dashed: false };
  return { tone: "active", animated: botBusy, dashed: false };
}

/** Builds the full 4-column workflow graph and deterministic default layout. */
export function buildAutomationCanvasGraph(args: {
  automations: readonly Automation[];
  bots: readonly Bot[];
  positions?: Record<string, CanvasPoint>;
}): AutomationCanvasGraph {
  const { automations, bots, positions = {} } = args;
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];

  if (automations.length === 0) {
    return { nodes, edges, bounds: { minX: 0, minY: 0, maxX: 900, maxY: 480 } };
  }

  // Group automations by bot while preserving chronological / listed order within each bot.
  const byBot = new Map<string, Automation[]>();
  for (const automation of automations) {
    const list = byBot.get(automation.botId) ?? [];
    list.push(automation);
    byBot.set(automation.botId, list);
  }

  const ownedBotIds = [...byBot.keys()];
  const chief = bots.find((bot) => bot.chiefOfStaff && !bot.hidden);
  const includeChiefSupervisor = Boolean(chief && !byBot.has(chief.id) && ownedBotIds.length > 0);

  const ROW_STEP = 166;
  const GROUP_GAP = 26;
  const TOP_PAD = 72;
  let cursorY = TOP_PAD;

  // Track where each job lands vertically so system nodes can center against their incoming jobs.
  const systemJobs = new Map<string, { meta: Pick<SystemRule, "key" | "label" | "detail" | "icon">; ys: number[]; jobIds: Array<{ jobId: string; automation: Automation; status: AutomationStatus; botBusy: boolean }> }>();
  const botCenters: Array<{ botId: string; y: number }> = [];

  if (includeChiefSupervisor && chief) {
    const nodeId = `bot:${chief.id}`;
    const size = NODE_SIZES.bot;
    const saved = positions[nodeId];
    nodes.push({
      kind: "bot",
      id: nodeId,
      botId: chief.id,
      bot: chief,
      supervisorOnly: true,
      automationCount: automations.length,
      runningCount: automations.filter(isRunningAutomation).length,
      x: saved?.x ?? COLUMN_X.bot,
      y: saved?.y ?? cursorY,
      ...size,
    });
    cursorY += size.height + 44;
  }

  for (const botId of ownedBotIds) {
    const bot = botById.get(botId);
    const group = byBot.get(botId) ?? [];
    const groupStartY = cursorY;
    const jobYs: number[] = [];

    for (const automation of group) {
      const status = automationStatus(automation);
      const running = isRunningAutomation(automation);
      const triggerId = `trigger:${automation.id}`;
      const jobId = `job:${automation.id}`;
      const triggerSize = NODE_SIZES.trigger;
      const jobSize = NODE_SIZES.job;

      const rowCenterY = cursorY + jobSize.height / 2;
      const triggerDefaultY = Math.round(rowCenterY - triggerSize.height / 2);
      const triggerSaved = positions[triggerId];
      const jobSaved = positions[jobId];
      const systems = inferAutomationSystems(automation);

      nodes.push({
        kind: "trigger",
        id: triggerId,
        automationId: automation.id,
        automationKind: automation.kind,
        title: triggerHeadline(automation),
        subtitle: automation.nextRunAt ? `Next: ${nextWhen(automation.nextRunAt)}` : automation.enabled ? "Listening" : "Paused",
        enabled: automation.enabled,
        status,
        x: triggerSaved?.x ?? COLUMN_X.trigger,
        y: triggerSaved?.y ?? triggerDefaultY,
        ...triggerSize,
      });

      nodes.push({
        kind: "job",
        id: jobId,
        automationId: automation.id,
        automation,
        summary: summarizeJobInstructions(automation.instructions),
        statusLine: statusLine(automation),
        status,
        running,
        tags: systems.map((s) => s.label.split("·")[0]!.trim()),
        x: jobSaved?.x ?? COLUMN_X.job,
        y: jobSaved?.y ?? cursorY,
        ...jobSize,
      });

      const wire = edgeToneFor(automation, status, Boolean(bot?.busy));
      const botNodeId = `bot:${botId}`;
      edges.push(
        { id: `e:${triggerId}->${botNodeId}`, from: triggerId, to: botNodeId, ...wire, automationId: automation.id },
        { id: `e:${botNodeId}->${jobId}`, from: botNodeId, to: jobId, ...wire, automationId: automation.id },
      );

      for (const sys of systems) {
        const entry = systemJobs.get(sys.key) ?? { meta: sys, ys: [], jobIds: [] };
        entry.ys.push(rowCenterY);
        entry.jobIds.push({ jobId, automation, status, botBusy: Boolean(bot?.busy) });
        systemJobs.set(sys.key, entry);
      }

      jobYs.push(rowCenterY);
      cursorY += ROW_STEP;
    }

    if (bot) {
      const botNodeId = `bot:${bot.id}`;
      const size = NODE_SIZES.bot;
      const avgY = jobYs.reduce((sum, y) => sum + y, 0) / Math.max(1, jobYs.length);
      const defaultY = Math.round(Math.max(groupStartY, avgY - size.height / 2));
      const saved = positions[botNodeId];
      nodes.push({
        kind: "bot",
        id: botNodeId,
        botId: bot.id,
        bot,
        supervisorOnly: false,
        automationCount: group.length,
        runningCount: group.filter(isRunningAutomation).length,
        x: saved?.x ?? COLUMN_X.bot,
        y: saved?.y ?? defaultY,
        ...size,
      });
      botCenters.push({ botId: bot.id, y: defaultY + size.height / 2 });

      if (includeChiefSupervisor && chief && chief.id !== bot.id) {
        edges.push({
          id: `e:oversight:${chief.id}->${bot.id}`,
          from: `bot:${chief.id}`,
          to: botNodeId,
          tone: "oversight",
          animated: Boolean(chief.busy || bot.busy),
          dashed: true,
        });
      }
    }

    cursorY += GROUP_GAP;
  }

  // Place shared system nodes sorted by their average connected job Y so wires stay untangled.
  const sortedSystems = [...systemJobs.values()].sort((a, b) => {
    const avgA = a.ys.reduce((s, y) => s + y, 0) / a.ys.length;
    const avgB = b.ys.reduce((s, y) => s + y, 0) / b.ys.length;
    return avgA - avgB;
  });

  const sysSize = NODE_SIZES.system;
  let prevSysBottom = TOP_PAD - 24;
  for (const entry of sortedSystems) {
    const sysId = `system:${entry.meta.key}`;
    const avgY = entry.ys.reduce((s, y) => s + y, 0) / entry.ys.length;
    const idealY = Math.round(avgY - sysSize.height / 2);
    const defaultY = Math.max(prevSysBottom + 24, idealY);
    prevSysBottom = defaultY + sysSize.height;
    const saved = positions[sysId];

    nodes.push({
      kind: "system",
      id: sysId,
      systemKey: entry.meta.key,
      label: entry.meta.label,
      detail: entry.meta.detail,
      icon: entry.meta.icon,
      connectedCount: entry.jobIds.length,
      x: saved?.x ?? COLUMN_X.system,
      y: saved?.y ?? defaultY,
      ...sysSize,
    });

    for (const ref of entry.jobIds) {
      const wire = edgeToneFor(ref.automation, ref.status, ref.botBusy);
      edges.push({
        id: `e:${ref.jobId}->${sysId}`,
        from: ref.jobId,
        to: sysId,
        ...wire,
        automationId: ref.automation.id,
      });
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  if (!Number.isFinite(minX)) {
    return { nodes, edges, bounds: { minX: 0, minY: 0, maxX: 900, maxY: 480 } };
  }
  return { nodes, edges, bounds: { minX, minY, maxX, maxY } };
}

/** Smooth horizontal cubic Bezier connecting the right port of `from` to the left port of `to` (or bottom->top for oversight). */
export function wirePath(from: CanvasNode, to: CanvasNode, isOversight = false): { d: string; x1: number; y1: number; x2: number; y2: number } {
  if (isOversight) {
    const x1 = from.x + from.width * 0.18;
    const y1 = from.y + from.height;
    const x2 = to.x + to.width * 0.18;
    const y2 = to.y;
    const bend = Math.max(36, Math.abs(y2 - y1) * 0.4);
    const outX = Math.min(x1, x2) - 34;
    return { d: `M ${x1} ${y1} C ${outX} ${y1 + bend * 0.35}, ${outX} ${y2 - bend * 0.35}, ${x2} ${y2}`, x1, y1, x2, y2 };
  }
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const dx = Math.max(44, Math.abs(x2 - x1) * 0.45);
  return { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, x1, y1, x2, y2 };
}

/** Every node and edge upstream or downstream of `focusId`, so hovering/selecting illuminates the whole flow. */
export function connectedSubgraph(focusId: string | null, edges: readonly CanvasEdge[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const edgeIds = new Set<string>();
  if (!focusId) return { nodes, edges: edgeIds };
  nodes.add(focusId);

  // Walk downstream
  const forward = [focusId];
  while (forward.length > 0) {
    const current = forward.pop()!;
    for (const edge of edges) {
      if (edge.from === current && !edgeIds.has(edge.id)) {
        edgeIds.add(edge.id);
        if (!nodes.has(edge.to)) {
          nodes.add(edge.to);
          forward.push(edge.to);
        }
      }
    }
  }
  // Walk upstream
  const backward = [focusId];
  while (backward.length > 0) {
    const current = backward.pop()!;
    for (const edge of edges) {
      if (edge.to === current && !edgeIds.has(edge.id)) {
        edgeIds.add(edge.id);
        if (!nodes.has(edge.from)) {
          nodes.add(edge.from);
          backward.push(edge.from);
        }
      }
    }
  }
  return { nodes, edges: edgeIds };
}

const POSITIONS_STORAGE_KEY = "omb-automations-canvas-positions-v1";

export function loadCanvasPositions(): Record<string, CanvasPoint> {
  try {
    const raw = localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, CanvasPoint> = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (val && typeof val === "object" && typeof (val as CanvasPoint).x === "number" && typeof (val as CanvasPoint).y === "number") {
        out[key] = { x: Math.round((val as CanvasPoint).x), y: Math.round((val as CanvasPoint).y) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCanvasPositions(positions: Record<string, CanvasPoint>): void {
  try {
    if (Object.keys(positions).length === 0) localStorage.removeItem(POSITIONS_STORAGE_KEY);
    else localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // ignore storage errors
  }
}
