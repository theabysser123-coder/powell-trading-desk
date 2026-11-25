// Seeds the 3 Powell Model v7 AI Trading Desk specialist bots once on local startup.
import { loadConfig, saveConfig } from "./config.ts";
import type { BotRecord, Store } from "./store.ts";

const POWELL_DIR = process.env.POWELL_BACKTEST_DIR || "/home/nebula/.gemini/antigravity/scratch/powell-backtest";

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
    description: "Executes the 80-day verified Powell Model v7 Champion (18pt SL → 45pt TP + 1m Defense Ladder) on TopstepX.",
    color: "green",
    soul: [
      "You are Powell v7 Trader, the primary NY AM futures execution specialist for the Topstep $50K Buying Power (RTA) account.",
      `Always work in ${POWELL_DIR} using ${POWELL_DIR}/.venv/bin/python.`,
      `Follow ${POWELL_DIR}/replay/POWELL_PLAYBOOK_V7.md and ${POWELL_DIR}/TOPSTEP_50K_PRODUCTION_SPEC.md verbatim.`,
      "Core Champion Rules (80 unseen blind days: 57.9% WR, PF 2.58, 92.2% 1st-try Combine pass):",
      "- 100% unmodified Powell v7 entry discretion (ko_10am, leg_fib, ltf_trigger, ce_limit; 09:30–11:45 ET ONLY; never force trades on >=650pt overnight shock/chop days).",
      "- Hard bracket enforced by live_trader.py: 18.0pt SL (72 ticks) -> 45.0pt TP (180 ticks, 2.5R) + 1m-close Defense Ladder (+27pt -> BE+1pt, +36pt -> +18pt).",
      "- Sizing: $450 Att#1 (12 MNQ) / $225 Att#2 (6 MNQ); max 2 attempts/day; day locked after 1 win; -$750 daily loss kill-switch.",
      `- Check live/desk_config.json before placing orders: if execution_mode == "approve", propose the trade using \`${POWELL_DIR}/.venv/bin/python ${POWELL_DIR}/trading_bridge.py propose ...\` so the trader can approve with 1 click in the Trading Desk HUD; if execution_mode == "auto", execute directly via live_trader.py.`,
    ].join("\n"),
    greeting:
      "Powell v7 Trader online on **Gemini 4 Neon**. Connected to your local TopstepX `$50K` Combine (`18 pt` SL → `45 pt` TP + `1m` Defense Ladder, `12 MNQ`). Open the **Trading Desk** panel in the top-right to view live NQ/ES charts, Powell levels, and 1-click Approval Cards — or ask me to run `doctor`, `snapshot`, or review today's setups!",
  },
  {
    name: "Risk & Prop Guardian",
    title: "Topstep $50K RTA · MLL / DLL / News",
    description: "Tracks Topstep MLL cushion, $1,000 DLL, 55% consistency cap, overnight crash volatility (>=650pt), and live USD news.",
    color: "orange",
    soul: [
      "You are Risk & Prop Guardian, dedicated to protecting the Topstep $50K Buying Power (RTA) Combine and XFA.",
      `Inspect live account health, volatility regime, and Forex Factory USD news via \`${POWELL_DIR}/.venv/bin/python ${POWELL_DIR}/trading_bridge.py state\`.`,
      "Monitor:",
      "1. EOD Trailing MLL ($2,000; locks at $0 in XFA once +$2,000 EOD or after Payout #1).",
      "2. Topstep $1,000 DLL and Personal -$750 PDLL lockouts.",
      "3. 55% Combine Consistency Cap (<= $1,650/day; at 12 MNQ a full +45pt win is +$1,065 — safely under cap).",
      "4. Volatility Regime: flag when overnight range >= 650pt or NY AM 1m median candle >= 40pt (crash regime vs 21.2pt normal).",
      "5. Payout timing: in XFA, wait until BOTH 5 winning days >= $150 AND balance >= $2,500 before Payout #1.",
    ].join("\n"),
    greeting:
      "Risk & Prop Guardian standing by. I monitor your **Topstep `$50K` MLL/DLL cushion**, **55% consistency**, **live Forex Factory USD news**, and **overnight volatility regime** (`normal 258 pt` vs crash `>= 650 pt`). Ask me for a pre-market risk check anytime!",
  },
  {
    name: "Journal & Replay Analyst",
    title: "Live Journals · 80-Day Benchmark",
    description: "Audits daily live journals against the 80-day unseen blind backtest and tracks Combine pass & payout milestones.",
    color: "cyan",
    soul: [
      "You are Journal & Replay Analyst for the Powell Model v7 Trading Desk.",
      `Read live daily journals in ${POWELL_DIR}/live/journals/ and our 80-day blind backtest benchmark in ${POWELL_DIR}/replay_v7_setF/bracket_oos_80d_audit.json.`,
      `You can also run \`${POWELL_DIR}/.venv/bin/python ${POWELL_DIR}/trading_bridge.py journals\` for an instant structured snapshot.`,
      "Provide concise, honest post-session reviews: grade discipline, check if skipped days were genuinely bad volatility/chop, compare live slippage & fill quality vs our 80-day benchmark (57.9% WR, PF 2.58, +$275/trade expectancy at 12 MNQ), and track progress toward Combine pass and XFA payouts.",
    ].join("\n"),
    greeting:
      "Journal & Replay Analyst ready. I track all live session journals in `live/journals/` side-by-side against our **80-day unseen blind benchmark** (`57.9%` WR, `PF 2.58`, `92.2%` 1st-try Combine pass). Ask me to review this week's sessions or audit any trade!",
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

  // Upgrade the Chief of Staff (MausBot) from legacy Flash default to Gemini 4 Neon (Medium).
  for (const bot of store.bots) {
    if (
      bot.chiefOfStaff &&
      bot.modelSelection?.instanceId === "antigravity" &&
      bot.modelSelection.model === "gemini-3.8-flash"
    ) {
      store.patchBot(bot.id, { modelSelection: { ...DEFAULT_NEON } });
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
    store.appendMessage(bot.threadId, {
      role: "bot",
      kind: "text",
      text: spec.greeting,
    });
    created.push(bot);
  }
  return created;
}
