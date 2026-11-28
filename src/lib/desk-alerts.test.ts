import { describe, expect, it } from "vitest";
import { detectDeskAlerts, snapshotTradingAlertState } from "./desk-alerts";
import type { TradingState } from "@/components/trading/types";

function makeState(overrides: {
  positions?: TradingState["positions"];
  lastNq?: number;
  realizedToday?: number;
} = {}): TradingState {
  return {
    ok: true,
    timestamp_et: "2026-11-30 10:05:00 ET",
    date: "2026-11-30",
    broker_connected: true,
    broker_error: null,
    desk: {
      execution_mode: "auto",
      topstep_mode: "live",
      base_risk: 450,
      att1_mnq: 12,
      att2_mnq: 6,
      sl_pts: 18,
      tp_pts: 45,
      tp_r: 2.5,
      automation_installed: true,
    },
    account: {
      id: 30004963,
      name: "50KTC-V2",
      is_practice: false,
      balance: 50000,
      start_balance: 50000,
      net_profit: 0,
      target_profit: 3000,
      progress_pct: 0,
      mll_floor: 48000,
      mll_cushion: 2000,
      dll_limit: 1000,
      dll_remaining: 1000,
      pdll_limit: 750,
      pdll_remaining: 750,
      consistency_cap: 1650,
      realized_today: overrides.realizedToday ?? 0,
      unrealized_usd: 0,
      today_net: overrides.realizedToday ?? 0,
      all_accounts: [],
    },
    market: {
      mnq_contract: "MNQZ6",
      es_contract: "ESZ6",
      last_nq: overrides.lastNq ?? 26000,
      last_es: 7200,
      last_bar_et: "2026-11-30 10:05 ET",
      volatility: {
        overnight_range_pt: 250,
        ny_am_range_pt: 120,
        m1_median_pt: 18,
        regime: "NORMAL",
        normal_overnight_median_pt: 258,
        normal_m1_median_pt: 21.2,
      },
    },
    positions: overrides.positions ?? [],
    open_orders: [],
    session: { initialized: true, attempts: 1, day_locked: false, lock_reason: null, plan: null, cur_t: null },
    news: [],
    approvals: [],
  };
}

describe("desk-alerts transition detector", () => {
  it("detects fill, BE+1 arm, +1R arm, and profitable/losing close transitions", () => {
    const flat = snapshotTradingAlertState(makeState());
    expect(detectDeskAlerts(null, flat)).toEqual([]);

    const posBase = {
      id: 101,
      contract: "MNQZ6",
      side: "long" as const,
      size: 12,
      avg_price: 26000,
      last_price: 26005,
      unrealized_usd: 120,
      sl_price: 25982,
      tp_price: 26045,
      be_trigger: 26027,
      lock_1r_trigger: 26036,
    };

    const filled = snapshotTradingAlertState(makeState({ positions: [posBase], lastNq: 26005 }));
    expect(detectDeskAlerts(flat, filled)).toEqual(["fill"]);

    const beArmed = snapshotTradingAlertState(makeState({ positions: [{ ...posBase, last_price: 26028 }], lastNq: 26028 }));
    expect(detectDeskAlerts(filled, beArmed)).toEqual(["be_armed"]);

    const lock1r = snapshotTradingAlertState(makeState({ positions: [{ ...posBase, last_price: 26037 }], lastNq: 26037 }));
    expect(detectDeskAlerts(beArmed, lock1r)).toEqual(["lock_1r"]);

    const closedWin = snapshotTradingAlertState(makeState({ positions: [], realizedToday: 1065 }));
    expect(detectDeskAlerts(lock1r, closedWin)).toEqual(["close_win"]);

    const filled2 = snapshotTradingAlertState(makeState({ positions: [{ ...posBase, id: 102 }], realizedToday: 1065 }));
    const closedLoss = snapshotTradingAlertState(makeState({ positions: [], realizedToday: 615 }));
    expect(detectDeskAlerts(filled2, closedLoss)).toEqual(["close_loss"]);
  });
});
