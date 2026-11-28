import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateTradingGuard, nyClockFor } from "./trading-guard.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("trading-guard", () => {
  it("blocks during Mon–Fri 09:15–12:15 ET and allows outside that window", () => {
    const emptyDir = makeTempDir("guard-empty-");
    // Monday 2026-11-30 10:05 ET (EST = UTC-5 -> 15:05 UTC)
    const duringNyAm = Date.parse("2026-11-30T15:05:00Z");
    const blocked = evaluateTradingGuard({ nowMs: duringNyAm, powellDir: emptyDir });
    expect(blocked.blocked).toBe(true);
    expect(blocked.inTradingWindow).toBe(true);
    expect(blocked.hasOpenTrade).toBe(false);
    expect(blocked.reason).toContain("09:15–12:15 ET");

    // Monday 2026-11-30 12:20 ET (17:20 UTC)
    const afterNyAm = Date.parse("2026-11-30T17:20:00Z");
    const open = evaluateTradingGuard({ nowMs: afterNyAm, powellDir: emptyDir });
    expect(open.blocked).toBe(false);
    expect(open.inTradingWindow).toBe(false);

    // Saturday 2026-11-28 10:05 ET (15:05 UTC) -> weekend, not blocked
    const weekend = Date.parse("2026-11-28T15:05:00Z");
    const sat = evaluateTradingGuard({ nowMs: weekend, powellDir: emptyDir });
    expect(sat.blocked).toBe(false);
    expect(sat.inTradingWindow).toBe(false);
  });

  it("blocks whenever an open position or resting order exists in local state or cache", () => {
    const dir = makeTempDir("guard-live-");
    const liveDir = join(dir, "live");
    mkdirSync(liveDir, { recursive: true });
    // Monday 2026-11-30 14:00 ET (outside NY AM window)
    const afternoon = Date.parse("2026-11-30T19:00:00Z");
    const clock = nyClockFor(afternoon);
    writeFileSync(join(liveDir, `state_${clock.dateStr}.json`), JSON.stringify({ position: { side: "long", qty: 12 } }));

    const fromDisk = evaluateTradingGuard({ nowMs: afternoon, powellDir: dir });
    expect(fromDisk.blocked).toBe(true);
    expect(fromDisk.hasOpenTrade).toBe(true);
    expect(fromDisk.reason).toContain("Live TopstepX position");

    const emptyDir = makeTempDir("guard-cache-");
    const fromCache = evaluateTradingGuard({ nowMs: afternoon, powellDir: emptyDir, cachedOpenTrade: true });
    expect(fromCache.blocked).toBe(true);
    expect(fromCache.hasOpenTrade).toBe(true);
  });
});
