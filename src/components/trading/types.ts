export interface VolatilityMetrics {
  overnight_range_pt: number;
  ny_am_range_pt: number;
  m1_median_pt: number;
  regime: "NORMAL" | "ELEVATED" | "CRASH";
  normal_overnight_median_pt: number;
  normal_m1_median_pt: number;
}

export interface TradingPosition {
  id: number | string;
  contract: string;
  side: "long" | "short";
  size: number;
  avg_price: number;
  last_price: number | null;
  unrealized_usd: number;
  sl_price: number;
  tp_price: number;
  be_trigger: number;
  lock_1r_trigger: number;
}

export interface TradingOpenOrder {
  id: number | string;
  type: number;
  side: "long" | "short";
  size: number;
  limitPrice: number | null;
  stopPrice: number | null;
  customTag: string | null;
}

export interface NewsItem {
  id?: string;
  time: string;
  event: string;
  impact: string;
  forecast: string | null;
  previous: string | null;
}

export interface MorningPlan {
  logged_at: string;
  bias: string;
  dol: string;
  levels: string;
  invalidation: string;
  notes: string;
}

export interface ApprovalCardItem {
  id: string;
  created_at: string;
  status: "pending" | "executed" | "rejected";
  account_id: number;
  mode: string;
  side: "long" | "short";
  order_type: "market" | "limit";
  entry: number;
  sl: number;
  tp: number;
  qty: number;
  risk_usd: number;
  reward_usd: number;
  entry_type: string;
  rb_id: string | null;
  setup: string;
  reason: string;
}

export interface TradingState {
  ok: boolean;
  timestamp_et: string;
  date: string;
  broker_connected: boolean;
  broker_error: string | null;
  desk: {
    execution_mode: "auto" | "approve";
    topstep_mode: "practice" | "live" | "dry_run";
    base_risk: number;
    att1_mnq: number;
    att2_mnq: number;
    sl_pts: number;
    tp_pts: number;
    tp_r: number;
    automation_installed: boolean;
  };
  account: {
    id: number;
    name: string;
    is_practice: boolean;
    balance: number;
    start_balance: number;
    net_profit: number;
    target_profit: number;
    progress_pct: number;
    mll_floor: number;
    mll_cushion: number;
    dll_limit: number;
    dll_remaining: number;
    pdll_limit: number;
    pdll_remaining: number;
    consistency_cap: number;
    realized_today: number;
    unrealized_usd: number;
    today_net: number;
    all_accounts: Array<{ id: number; name: string; balance: number; is_practice: boolean }>;
  };
  market: {
    mnq_contract: string;
    es_contract: string;
    last_nq: number | null;
    last_es: number | null;
    last_bar_et: string;
    volatility: VolatilityMetrics;
  };
  positions: TradingPosition[];
  open_orders: TradingOpenOrder[];
  session: {
    initialized: boolean;
    attempts: number;
    day_locked: boolean;
    lock_reason: string | null;
    plan: MorningPlan | null;
    cur_t: string | null;
  };
  news: NewsItem[];
  approvals: ApprovalCardItem[];
}

export interface LwcCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface RejectionBlockItem {
  id: string;
  tf: number;
  side: "long" | "short";
  ce: number;
  fib62: number;
  fib705: number;
  fib79: number;
  tip: number;
  wick: number;
  status: string;
  el_status: string;
  el_price: number | null;
  big: boolean;
  swept: string | null;
  pda: string | null;
}

export interface Ko10AmTracker {
  open: number;
  max_above: number;
  max_below: number;
  bull_5m_closes: number;
  bear_5m_closes: number;
  bull_reclaim: boolean;
  bear_reclaim: boolean;
}

export interface TradingChartData {
  ok: boolean;
  date: string;
  tf: number;
  cur_t_et: string;
  contracts: { mnq_id: string; mnq_name: string; es_id: string; es_name: string };
  last_nq: number;
  nq_candles: LwcCandle[];
  es_candles: LwcCandle[];
  levels: Record<string, number>;
  nwog: { lo: number; hi: number; ce: number; size: number; filled: boolean } | null;
  ko_10am: Ko10AmTracker | null;
  rbs: RejectionBlockItem[];
  volatility: VolatilityMetrics;
}

export interface LiveJournalEntry {
  date: string;
  mode: string;
  outcome: string;
  grade: string;
  realized_pnl_usd: number;
  trades: Array<Record<string, unknown>>;
  plan: MorningPlan | null;
  summary: string;
  lessons: string;
}

export interface BacktestStatBlock {
  n_trades: number;
  wins: number;
  real_wins: number;
  be_scratches: number;
  losses: number;
  wr_pct: number;
  total_R: number;
  total_usd: number;
  pf: number;
  max_dd_eod: number;
  exp_usd?: number;
}

export interface TradingJournalsData {
  ok: boolean;
  live_journals: LiveJournalEntry[];
  backtest: {
    champion_80d: BacktestStatBlock | null;
    baseline_80d: BacktestStatBlock | null;
    champion_setF_oos: BacktestStatBlock | null;
    baseline_setF_oos: BacktestStatBlock | null;
  } | null;
  equity_curve_80d: Array<{
    date: string;
    set: string;
    day_usd: number;
    cum_v7_base_usd: number;
    n_trades: number;
  }>;
}
