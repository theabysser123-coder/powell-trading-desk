// Trading-hours & live-position safety guard for fork updates and server restarts.
// Prevents accidental server restarts or background merges while a live TopstepX trade is open
// or during the NY AM Powell v7 execution window (Mon–Fri 09:15–12:15 America/New_York).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TradingGuardStatus {
  blocked: boolean;
  reason: string | null;
  inTradingWindow: boolean;
  hasOpenTrade: boolean;
  nyTimeEt: string;
}

const DEFAULT_POWELL_DIR = process.env.POWELL_BACKTEST_DIR || "/home/nebula/.gemini/antigravity/scratch/powell-backtest";
const WINDOW_START_MIN = 9 * 60 + 15; // 09:15 ET
const WINDOW_END_MIN = 12 * 60 + 15;  // 12:15 ET

interface NyClock {
  weekday: string;
  dateStr: string;
  minutesOfDay: number;
  label: string;
}

export function nyClockFor(nowMs: number): NyClock {
  const date = new Date(nowMs);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const rawHour = Number(get("hour"));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(get("minute"));
  const dateStr = `${year}-${month}-${day}`;
  const label = `${weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`;
  return { weekday, dateStr, minutesOfDay: hour * 60 + minute, label };
}

export function isWeekday(weekday: string): boolean {
  return weekday === "Mon" || weekday === "Tue" || weekday === "Wed" || weekday === "Thu" || weekday === "Fri";
}

/** Fast, synchronous read of today's local live_trader state file to detect open positions or resting orders. */
export function hasActiveLocalTrade(dateStr: string, powellDir = DEFAULT_POWELL_DIR): boolean {
  const statePath = join(powellDir, "live", `state_${dateStr}.json`);
  if (!existsSync(statePath)) return false;
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as {
      position?: unknown;
      pending_order?: unknown;
    };
    return Boolean(raw?.position || raw?.pending_order);
  } catch {
    return false;
  }
}

export function evaluateTradingGuard(input?: {
  nowMs?: number;
  powellDir?: string;
  cachedOpenTrade?: boolean;
}): TradingGuardStatus {
  const nowMs = input?.nowMs ?? Date.now();
  const clock = nyClockFor(nowMs);
  const inTradingWindow = isWeekday(clock.weekday)
    && clock.minutesOfDay >= WINDOW_START_MIN
    && clock.minutesOfDay < WINDOW_END_MIN;
  const hasOpenTrade = Boolean(input?.cachedOpenTrade) || hasActiveLocalTrade(clock.dateStr, input?.powellDir);

  if (hasOpenTrade) {
    return {
      blocked: true,
      reason: "Live TopstepX position or resting order is active — updates & restarts are locked to protect execution.",
      inTradingWindow,
      hasOpenTrade: true,
      nyTimeEt: clock.label,
    };
  }

  if (inTradingWindow) {
    return {
      blocked: true,
      reason: `NY AM trading window active (${clock.label}, 09:15–12:15 ET) — updates & restarts are paused until 12:15 ET.`,
      inTradingWindow: true,
      hasOpenTrade: false,
      nyTimeEt: clock.label,
    };
  }

  return {
    blocked: false,
    reason: null,
    inTradingWindow: false,
    hasOpenTrade: false,
    nyTimeEt: clock.label,
  };
}
