import { describe, expect, it } from "vitest";

import type { Automation } from "@/lib/automations";
import {
  buildAutomationCanvasGraph,
  connectedSubgraph,
  inferAutomationSystems,
  summarizeJobInstructions,
  triggerHeadline,
  wirePath,
} from "@/lib/automation-canvas";
import type { Bot } from "@/state/store";

const makeBot = (overrides: Partial<Bot> & { id: string; name: string }): Bot => ({
  color: "emerald",
  threadId: `t-${overrides.id}`,
  messages: [],
  busy: false,
  modelSelection: { instanceId: "antigravity", model: "gemini-4-neon" },
  ...overrides,
} as Bot);

const makeAutomation = (overrides: Partial<Automation> & { id: string; name: string; botId: string }): Automation => ({
  kind: "schedule",
  instructions: "",
  enabled: true,
  nextRunAt: Date.now() + 3600_000,
  runs: [],
  ...overrides,
});

describe("automation-canvas graph builder", () => {
  const chief = makeBot({ id: "chief", name: "Head of Desk", chiefOfStaff: true, title: "Trading Desk PM · Powell v7" });
  const riskBot = makeBot({ id: "risk", name: "Risk & Prop Guardian", title: "Topstep $50K RTA · MLL / DLL / News" });
  const traderBot = makeBot({ id: "trader", name: "Powell v7 Trader", title: "NY AM NQ Executor · Topstep $50K" });
  const journalBot = makeBot({ id: "journal", name: "Journal & Replay Analyst", title: "Live Journals · 80-Day Benchmark" });

  const automations: Automation[] = [
    makeAutomation({
      id: "r1",
      name: "Pre-Market Risk & News Check",
      botId: "risk",
      schedule: { type: "cron", expression: "55 7 * * 1-5", timeZone: "America/New_York" },
      instructions: "Run trading_bridge.py state to check TopstepX MLL cushion, volatility regime (>=650pt crash), and Forex Factory USD news.",
    }),
    makeAutomation({
      id: "r2",
      name: "Powell v7 NY AM Execution",
      botId: "trader",
      schedule: { type: "cron", expression: "0 8 * * 1-5", timeZone: "America/New_York" },
      instructions: "Run live_trader.py on MNQ/ES through 12:00 ET / 15:55 ET flatten and save live journal.",
    }),
    makeAutomation({
      id: "r3",
      name: "EOD Discipline Audit",
      botId: "journal",
      schedule: { type: "cron", expression: "15 12 * * 1-5", timeZone: "America/New_York" },
      instructions: "Run trading_bridge.py journals and compare today's EOD journal vs the 80-day blind benchmark toward $53,000.",
    }),
  ];

  it("formats weekday NY cron schedules cleanly for Trigger nodes", () => {
    expect(triggerHeadline(automations[0]!)).toBe("07:55 AM ET · Mon–Fri");
    expect(triggerHeadline(automations[1]!)).toBe("08:00 AM ET · Mon–Fri");
    expect(triggerHeadline(automations[2]!)).toBe("12:15 PM ET · Mon–Fri");
  });

  it("infers deduplicated connected systems from automation instructions", () => {
    expect(inferAutomationSystems(automations[0]!).map((s) => s.key)).toEqual(["topstep", "news"]);
    expect(inferAutomationSystems(automations[1]!).map((s) => s.key)).toEqual(["tape", "journals"]);
    expect(inferAutomationSystems(automations[2]!).map((s) => s.key)).toEqual(["journals", "benchmark"]);
  });

  it("wires triggers -> bots -> jobs -> shared systems plus Head of Desk oversight", () => {
    const graph = buildAutomationCanvasGraph({ automations, bots: [chief, riskBot, traderBot, journalBot] });
    const triggers = graph.nodes.filter((n) => n.kind === "trigger");
    const botNodes = graph.nodes.filter((n) => n.kind === "bot");
    const jobs = graph.nodes.filter((n) => n.kind === "job");
    const systems = graph.nodes.filter((n) => n.kind === "system");

    expect(triggers).toHaveLength(3);
    expect(botNodes).toHaveLength(4); // 3 specialists + Head of Desk supervisor
    expect(jobs).toHaveLength(3);
    expect(systems.map((s) => s.systemKey).sort()).toEqual(["benchmark", "journals", "news", "tape", "topstep"]);

    // Oversight wires from Head of Desk to all 3 specialists
    const oversight = graph.edges.filter((e) => e.tone === "oversight");
    expect(oversight).toHaveLength(3);

    // Highlighting r2's job traces upstream to its trigger & bot and downstream to tape & journals
    const chain = connectedSubgraph("job:r2", graph.edges);
    expect(chain.nodes.has("trigger:r2")).toBe(true);
    expect(chain.nodes.has("bot:trader")).toBe(true);
    expect(chain.nodes.has("bot:chief")).toBe(true);
    expect(chain.nodes.has("system:tape")).toBe(true);
    expect(chain.nodes.has("system:journals")).toBe(true);
    expect(chain.nodes.has("job:r3")).toBe(false);

    const path = wirePath(triggers[0]!, botNodes[1]!);
    expect(path.d.startsWith("M ")).toBe(true);
  });

  it("summarizes verbose prompt instructions cleanly", () => {
    const summary = summarizeJobInstructions("1. Run `/abs/path/trading_bridge.py state`.\n2. Keep it concise.\nDo not ask questions.");
    expect(summary).toContain("trading_bridge.py state");
    expect(summary).not.toContain("Keep it concise");
  });
});
