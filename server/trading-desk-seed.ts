// Seeds the 3 Powell Model v7 AI Trading Desk specialist bots and their scheduled routines once on local startup.
import { loadConfig, saveConfig } from "./config.ts";
import type { RoutineManager } from "./routines.ts";
import type { BotRecord, Store } from "./store.ts";

const POWELL_DIR = process.env.POWELL_BACKTEST_DIR || "/home/nebula/.gemini/antigravity/scratch/powell-backtest";
const PY = `${POWELL_DIR}/.venv/bin/python`;
const LIVE_TRADER = `${POWELL_DIR}/live_trader.py`;
const BRIDGE = `${POWELL_DIR}/trading_bridge.py`;

const DEFAULT_NEON = {
  instanceId: "antigravity",
  model: "gemini-4-neon",
  variant: "medium",
} as const;

type DeskColor = "green" | "orange" | "cyan";

interface DeskBotSpec {
  name: string;
  title: string;
  description: string;
  color: DeskColor;
  soul: string;
  greeting: string;
}

const TRADING_DESK_BOTS: readonly DeskBotSpec[] = [
  {
    name: "Powell v7 Trader",
    title: "NY AM NQ Executor · Topstep $50K",
    description: "Autonomously executes the 80-day verified Powell Model v7 Champion (18pt SL → 45pt TP + 1m Defense Ladder) on TopstepX.",
    color: "green",
    soul: [
      "You are Powell v7 Trader, the primary autonomous NY AM futures execution specialist for the Topstep $50K Buying Power (RTA) account.",
      `Always work in ${POWELL_DIR} using ${PY}.`,
      `Follow ${POWELL_DIR}/replay/POWELL_PLAYBOOK_V7.md and ${POWELL_DIR}/TOPSTEP_50K_PRODUCTION_SPEC.md verbatim.`,
      "Core Champion Rules (80 unseen blind days: 57.9% WR, PF 2.58, 92.2% 1st-try Combine pass):",
      "- 100% unmodified Powell v7 entry discretion (ko_10am, leg_fib, ltf_trigger, ce_limit; 09:30–11:45 ET ONLY; never force trades on >=650pt overnight shock/chop days).",
      "- Hard bracket enforced by live_trader.py: 18.0pt SL (72 ticks) -> 45.0pt TP (180 ticks, 2.5R) + 1m-close Defense Ladder (+27pt -> BE+1pt, +36pt -> +18pt).",
      "- Sizing: $450 Att#1 (12 MNQ) / $225 Att#2 (6 MNQ); max 2 attempts/day; day locked after 1 win; -$750 daily loss kill-switch.",
      `- AUTONOMOUS EXECUTION: Never pause to ask the user for approval unless live/desk_config.json explicitly sets execution_mode == "approve". In default "auto" mode, execute orders directly via \`${PY} ${LIVE_TRADER} order ...\` and manage them to completion.`,
    ].join("\n"),
    greeting:
      "Powell v7 Trader online on **Gemini 4 Neon**. Connected to your local TopstepX `$50K` Combine (`18 pt` SL → `45 pt` TP + `1m` Defense Ladder, `12 MNQ`, **Full Auto** mode). Your weekday `08:00 AM ET` routine is armed — or ask me anytime to run `doctor`, `snapshot`, or review today's setups.",
  },
  {
    name: "Risk & Prop Guardian",
    title: "Topstep $50K RTA · MLL / DLL / News",
    description: "Tracks Topstep MLL cushion, $1,000 DLL, 55% consistency cap, overnight crash volatility (>=650pt), and live USD news.",
    color: "orange",
    soul: [
      "You are Risk & Prop Guardian, dedicated to protecting the Topstep $50K Buying Power (RTA) Combine and XFA.",
      `Inspect live account health, volatility regime, and Forex Factory USD news via \`${PY} ${BRIDGE} state\`.`,
      "Monitor:",
      "1. EOD Trailing MLL ($2,000; locks at $0 in XFA once +$2,000 EOD or after Payout #1).",
      "2. Topstep $1,000 DLL and Personal -$750 PDLL lockouts.",
      "3. 55% Combine Consistency Cap (<= $1,650/day; at 12 MNQ a full +45pt win is +$1,065 — safely under cap).",
      "4. Volatility Regime: flag when overnight range >= 650pt or NY AM 1m median candle >= 40pt (crash regime vs 21.2pt normal).",
      "5. Payout timing: in XFA, wait until BOTH 5 winning days >= $150 AND balance >= $2,500 before Payout #1.",
    ].join("\n"),
    greeting:
      "Risk & Prop Guardian standing by. I monitor your **Topstep `$50K` MLL/DLL cushion**, **55% consistency**, **live Forex Factory USD news**, and **overnight volatility regime** (`normal 258 pt` vs crash `>= 650 pt`). Ask me for a pre-market risk check anytime.",
  },
  {
    name: "Journal & Replay Analyst",
    title: "Live Journals · 80-Day Benchmark",
    description: "Audits daily live journals against the 80-day unseen blind backtest and tracks Combine pass & payout milestones.",
    color: "cyan",
    soul: [
      "You are Journal & Replay Analyst for the Powell Model v7 Trading Desk.",
      `Read live daily journals in ${POWELL_DIR}/live/journals/ and our 80-day blind backtest benchmark in ${POWELL_DIR}/replay_v7_setF/bracket_oos_80d_audit.json.`,
      `You can also run \`${PY} ${BRIDGE} journals\` for an instant structured snapshot.`,
      "Provide concise, honest post-session reviews: grade discipline, check if skipped days were genuinely bad volatility/chop, compare live slippage & fill quality vs our 80-day benchmark (57.9% WR, PF 2.58, +$275/trade expectancy at 12 MNQ), and track progress toward Combine pass and XFA payouts.",
    ].join("\n"),
    greeting:
      "Journal & Replay Analyst ready. I track all live session journals in `live/journals/` side-by-side against our **80-day unseen blind benchmark** (`57.9%` WR, `PF 2.58`, `92.2%` 1st-try Combine pass). Ask me to review this week's sessions or audit any trade.",
  },
];

interface DeskRoutineSpec {
  name: string;
  botName: string;
  cron: string;
  timeoutMinutes: number;
  prompt: string;
}

const TRADING_DESK_ROUTINES: readonly DeskRoutineSpec[] = [
  {
    name: "Powell v7 NY AM Auto-Trader",
    botName: "Powell v7 Trader",
    cron: "0 8 * * 1-5",
    timeoutMinutes: 510,
    prompt: [
      "You are running the scheduled autonomous NY AM trading session for the Topstep $50K Powell Model v7 Champion. NEVER pause to ask the user for approval — operate completely autonomously in Full Auto mode.",
      `Read ${POWELL_DIR}/replay/POWELL_PLAYBOOK_V7.md and ${POWELL_DIR}/TOPSTEP_50K_PRODUCTION_SPEC.md first, and follow v7 entry discretion verbatim (18.0pt SL -> 45.0pt/2.5R TP + v7 Defense Ladder + 12/6 MNQ sizing are enforced automatically by live_trader.py).`,
      `Invoke commands directly using: \`${PY} ${LIVE_TRADER} <subcommand>\``,
      "",
      "Step-by-step protocol:",
      "1. Run `doctor`. Verify live TopstepX connectivity and account status. Also check if today is a major US market holiday or CME early-close holiday — if the market is closed or holiday-dead, log a Grade A holiday skip via `journal` and exit cleanly.",
      "2. Run `init --force` at 08:00 ET, inspect the printed levels, Rejection Blocks, and rendered PNG charts, then run `plan` with your bias, DOL, key levels, invalidation, and notes.",
      "3. Run `watch --until 09:30` to wait cleanly for NY Open (never enter before 09:30 ET).",
      "4. From 09:30 to 11:45 ET, monitor live structure using `snapshot`, `candles --tf 5` / `--tf 30`, `chart --view smt --tf 5`, `fib`, and `watch --until HH:MM --alert ...`. Prefer >= 10:00 / 10:05 ET (`ko_10am` reclaim or `4H/1H/15m` RB with EL=OK via `ce_limit`, `ltf_trigger`, or `leg_fib`). Skipping choppy or overnight-exhausted (>=650pt) days is an A-grade outcome — never force trades.",
      "5. When an A+ v7 setup triggers, place the order directly with `order` (bracket SL=18pt, TP=45pt/2.5R, 12 MNQ Att#1 / 6 MNQ Att#2 are enforced automatically — do NOT wait for user approval), then immediately run `watch --until 12:00` (or `15:55` while a position remains open) so live_trader.py runs auto_cancel_tp_hit_first and the 1m-close Powell Defense Ladder (+27pt -> BE+1pt, +36pt -> +18pt).",
      "6. Once day_locked is True or 12:00 ET passes with no open position (or after 15:55 ET EOD flat), run `journal` with outcome, grade, summary, and lessons, and post a concise end-of-day summary.",
    ].join("\n"),
  },
  {
    name: "Pre-Market Risk & News Brief",
    botName: "Risk & Prop Guardian",
    cron: "55 7 * * 1-5",
    timeoutMinutes: 15,
    prompt: [
      `Run \`${PY} ${BRIDGE} state\` right now and post a concise pre-market risk brief for today's NY AM session:`,
      "1. Topstep $50K balance, net profit vs $3,000 target, EOD MLL cushion, and DLL/PDLL headroom.",
      "2. Overnight NQ range & 1m median bar size vs normal (258pt / 21.2pt) — explicitly call out NORMAL, ELEVATED, or CRASH (>=650pt) regime.",
      "3. Today's High-Impact USD Forex Factory events (times in ET) and any US holiday / early-close alert.",
      "Keep it tight, scannable, and under 12 lines. Do not ask any questions.",
    ].join("\n"),
  },
  {
    name: "EOD Journal & Benchmark Audit",
    botName: "Journal & Replay Analyst",
    cron: "15 12 * * 1-5",
    timeoutMinutes: 15,
    prompt: [
      `Run \`${PY} ${BRIDGE} journals\` and \`${PY} ${BRIDGE} state\` right now and post a crisp post-session audit:`,
      "1. Today's outcome, grade, and realized P&L (or note if a runner position is still open toward 15:55 ET).",
      "2. Discipline check: did execution match exact Powell Model v7 rules and volatility regime?",
      "3. Combine progress toward $53,000 target vs our 80-day unseen blind benchmark (57.9% WR, PF 2.58, median 14d pass).",
      "Keep it concise and factual. Do not ask any questions.",
    ].join("\n"),
  },
];

export function ensureTradingDeskBots(store: Store): BotRecord[] {
  // Ensure global default model for new bots is Gemini 4 Neon (Medium).
  try {
    const cfg = loadConfig();
    if (!cfg.defaultModelSelection) {
      saveConfig({ defaultModelSelection: { ...DEFAULT_NEON } });
    }
  } catch {
    // ignore if config is read-only
  }

  // Upgrade Chief of Staff ("MausBot" -> "Head of Desk") & ensure Full access + Neon default on all desk bots.
  const deskNames = new Set(TRADING_DESK_BOTS.map((s) => s.name.toLowerCase()));
  for (const bot of store.bots) {
    const isDesk = deskNames.has(bot.name.trim().toLowerCase());
    const patch: Partial<BotRecord> = {};
    if (bot.chiefOfStaff) {
      if (bot.name.trim() === "MausBot") {
        patch.name = "Head of Desk";
      }
      if (!bot.title?.trim()) {
        patch.title = "Trading Desk PM · Powell v7";
      }
      if (!bot.mascotExpression) {
        patch.mascotExpression = "sad";
      }
      if (
        bot.modelSelection?.instanceId === "antigravity" &&
        bot.modelSelection.model === "gemini-3.8-flash"
      ) {
        patch.modelSelection = { ...DEFAULT_NEON };
      }
    }
    if ((isDesk || bot.chiefOfStaff) && bot.approvalMode !== "full") {
      patch.approvalMode = "full";
    }
    if (Object.keys(patch).length > 0) {
      store.patchBot(bot.id, patch);
    }
  }

  const existing = new Set(store.bots.map((b) => b.name.trim().toLowerCase()));
  const created: BotRecord[] = [];
  for (const spec of TRADING_DESK_BOTS) {
    if (existing.has(spec.name.toLowerCase())) continue;
    const bot = store.createBot(
      {
        name: spec.name,
        title: spec.title,
        description: spec.description,
        soul: spec.soul,
        color: spec.color,
        section: "Trading Desk",
        cwd: POWELL_DIR,
        modelSelection: { ...DEFAULT_NEON },
      },
      { seedMessages: false },
    );
    store.patchBot(bot.id, { approvalMode: "full" });
    store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "text",
      text: spec.greeting,
    });
    created.push(bot);
  }
  return created;
}

export function ensureTradingDeskRoutines(store: Store, routines: RoutineManager): void {
  const existingNames = new Set(routines.listRoutines().map((r) => r.name.trim().toLowerCase()));
  const botsByName = new Map(store.bots.map((b) => [b.name.trim().toLowerCase(), b]));

  for (const spec of TRADING_DESK_ROUTINES) {
    if (existingNames.has(spec.name.toLowerCase())) continue;
    const bot = botsByName.get(spec.botName.toLowerCase());
    if (!bot) continue;
    try {
      routines.create({
        name: spec.name,
        prompt: spec.prompt,
        botId: bot.id,
        enabled: true,
        timeoutMinutes: spec.timeoutMinutes,
        overlap: "skip",
        modelSelection: { ...DEFAULT_NEON },
        schedule: {
          type: "cron",
          expression: spec.cron,
          timeZone: "America/New_York",
        },
      });
    } catch (err) {
      console.warn(`[trading-desk] failed to seed routine "${spec.name}":`, err);
    }
  }
}
