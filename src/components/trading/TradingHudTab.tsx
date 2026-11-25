import { useState } from "react";
import { AlertTriangle, CheckCircle2, Flame, ShieldAlert, XCircle, Zap } from "lucide-react";
import type { TradingState } from "./types.ts";

interface Props {
  state: TradingState | null;
  busyAction: string | null;
  onFlatten: () => Promise<void>;
  onUpdateConfig: (patch: { execution_mode?: "auto" | "approve"; topstep_mode?: "practice" | "live"; base_risk?: number }) => Promise<void>;
  onDecideApproval: (id: string, action: "approve" | "reject") => Promise<void>;
  onTestProposal: () => Promise<void>;
}

function MeterBar({ label, valueText, pct, tone }: { label: string; valueText: string; pct: number; tone: "emerald" | "amber" | "red" | "sky" }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill =
    tone === "emerald" ? "bg-emerald-500"
      : tone === "amber" ? "bg-amber-400"
        : tone === "red" ? "bg-rose-500"
          : "bg-sky-400";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-ink-secondary">{label}</span>
        <span className="font-mono font-medium text-ink">{valueText}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-inset">
        <div className={`h-full rounded-full transition-all ${fill}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function TradingHudTab({ state, busyAction, onFlatten, onUpdateConfig, onDecideApproval, onTestProposal }: Props) {
  const [confirmFlatten, setConfirmFlatten] = useState(false);

  if (!state) {
    return <div className="p-4 text-center text-[12px] text-ink-tertiary">Connecting to TopstepX bridge...</div>;
  }

  const { account, desk, market, positions, open_orders, session, news, approvals } = state;
  const vol = market.volatility;
  const volTone = vol.regime === "CRASH" ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
    : vol.regime === "ELEVATED" ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Account & Execution Controls */}
      <div className="rounded-xl border border-hairline/40 bg-card p-3">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
              {account.is_practice ? "Practice Sim Account" : "Topstep $50K RTA Combine"}
            </div>
            <div className="font-mono text-[18px] font-bold text-ink">
              ${account.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="text-right font-mono">
            <div className={`text-[13px] font-semibold ${account.today_net >= 0 ? "text-success" : "text-danger"}`}>
              {account.today_net >= 0 ? "+" : ""}${account.today_net.toFixed(2)} today
            </div>
            <div className="text-[10px] text-ink-tertiary">{account.name}</div>
          </div>
        </div>

        {/* Mode / Approval / Sizing Switches */}
        <div className="grid grid-cols-3 gap-1.5 text-[11px]">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onUpdateConfig({ topstep_mode: desk.topstep_mode === "live" ? "practice" : "live" })}
            className={`rounded-lg border px-2 py-1.5 font-medium transition ${
              desk.topstep_mode === "live"
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                : "border-amber-400/50 bg-amber-400/15 text-amber-300"
            }`}
          >
            {desk.topstep_mode === "live" ? "LIVE $50K" : "PRACTICE"}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onUpdateConfig({ execution_mode: desk.execution_mode === "auto" ? "approve" : "auto" })}
            className={`rounded-lg border px-2 py-1.5 font-medium transition ${
              desk.execution_mode === "auto"
                ? "border-sky-400/50 bg-sky-400/15 text-sky-300"
                : "border-purple-400/50 bg-purple-400/15 text-purple-300"
            }`}
          >
            {desk.execution_mode === "auto" ? "100% Auto" : "1-Click Approve"}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onUpdateConfig({ base_risk: desk.base_risk >= 450 ? 400 : 450 })}
            className="rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 font-mono font-medium text-ink hover:bg-raised"
          >
            ${desk.base_risk} ({desk.att1_mnq} MNQ)
          </button>
        </div>
      </div>

      {/* Topstep $50K Risk Gauges */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-hairline/40 bg-card p-3">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
          <span>Topstep $50K Risk HUD</span>
          <span className="font-mono text-[10px] text-ink-tertiary">
            SL {desk.sl_pts}pt → TP {desk.tp_pts}pt ({desk.tp_r}R)
          </span>
        </div>

        {!account.is_practice && (
          <MeterBar
            label="Combine Target ($50K → $53K)"
            valueText={`$${account.net_profit.toFixed(0)} / $3,000 (${account.progress_pct}%)`}
            pct={account.progress_pct}
            tone="emerald"
          />
        )}
        <MeterBar
          label="EOD MLL Cushion ($2,000 limit)"
          valueText={`$${account.mll_cushion.toFixed(0)} left (floor $${account.mll_floor.toLocaleString()})`}
          pct={(account.mll_cushion / 2000) * 100}
          tone={account.mll_cushion < 800 ? "red" : account.mll_cushion < 1300 ? "amber" : "sky"}
        />
        <MeterBar
          label="Personal DLL (-$750) / Topstep DLL (-$1,000)"
          valueText={`$${account.pdll_remaining.toFixed(0)} / $750`}
          pct={(account.pdll_remaining / 750) * 100}
          tone={account.pdll_remaining < 250 ? "red" : "emerald"}
        />
        <div className="flex items-center justify-between rounded-lg bg-inset px-2.5 py-1.5 font-mono text-[10px] text-ink-secondary">
          <span>55% Consistency Cap: ≤ $1,650/day</span>
          <span>1 Win = +$1,065 (Safe)</span>
        </div>
      </div>

      {/* Volatility Regime Banner */}
      <div className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${volTone}`}>
        <div className="flex items-center gap-2">
          {vol.regime === "CRASH" ? <Flame size={16} /> : <Zap size={16} />}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider">
              Volatility: {vol.regime}
            </div>
            <div className="font-mono text-[10px] opacity-90">
              Overnight {vol.overnight_range_pt}pt (norm 258pt) · 1m med {vol.m1_median_pt}pt (norm 21pt)
            </div>
          </div>
        </div>
        <span className="font-mono text-[10px] font-semibold">
          {vol.regime === "CRASH" ? "SKIP CAUTION" : "18pt SL FIT"}
        </span>
      </div>

      {/* Pending Trade Approval Cards */}
      <div className="rounded-xl border border-hairline/40 bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
            Trade Approval Queue ({approvals.length})
          </span>
          {account.is_practice && (
            <button
              type="button"
              onClick={onTestProposal}
              disabled={busyAction !== null}
              className="rounded border border-hairline/40 bg-inset px-2 py-0.5 text-[10px] text-ink-secondary hover:text-ink"
            >
              + Demo Card
            </button>
          )}
        </div>
        {approvals.length === 0 ? (
          <div className="text-[11px] text-ink-tertiary">
            {desk.execution_mode === "auto"
              ? "Auto-Execute mode active: verified v7 setups route directly to TopstepX with 18pt/45pt OCO brackets."
              : "1-Click Approve mode active: proposed setups from Powell v7 Trader appear here for instant Approve / Reject."}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {approvals.map((a) => (
              <div key={a.id} className="rounded-lg border border-accent/40 bg-inset p-2.5">
                <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                  <span className={`font-bold ${a.side === "long" ? "text-success" : "text-danger"}`}>
                    {a.side.toUpperCase()} {a.qty} MNQ · {a.order_type.toUpperCase()} @ {a.entry.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-ink-tertiary">{a.entry_type}</span>
                </div>
                <div className="mb-1.5 font-mono text-[10px] text-ink-secondary">
                  SL {a.sl.toFixed(2)} (-${a.risk_usd.toFixed(0)}) · TP {a.tp.toFixed(2)} (+${a.reward_usd.toFixed(0)})
                </div>
                <div className="mb-2 text-[11px] text-ink-secondary">{a.setup} — {a.reason}</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => onDecideApproval(a.id, "approve")}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <CheckCircle2 size={13} /> Approve & Execute
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => onDecideApproval(a.id, "reject")}
                    className="flex items-center justify-center gap-1 rounded-lg border border-hairline/50 bg-raised px-3 py-1.5 text-[11px] font-medium text-ink-secondary hover:text-danger disabled:opacity-50"
                  >
                    <XCircle size={13} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live Open Position + Emergency Kill Switch */}
      <div className="rounded-xl border border-hairline/40 bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
            Live Exposure ({positions.length} Pos · {open_orders.length} Orders)
          </span>
          <span className="font-mono text-[10px] text-ink-tertiary">
            Attempts {session.attempts}/2 {session.day_locked ? "· LOCKED" : ""}
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="mb-2.5 rounded-lg bg-inset px-3 py-2 font-mono text-[11px] text-ink-tertiary">
            FLAT — No open MNQ positions ({open_orders.length} working orders)
          </div>
        ) : (
          <div className="mb-2.5 flex flex-col gap-1.5">
            {positions.map((p) => (
              <div key={String(p.id)} className="rounded-lg border border-hairline/40 bg-inset p-2.5 font-mono text-[11px]">
                <div className="flex items-center justify-between">
                  <span className={`font-bold ${p.side === "long" ? "text-success" : "text-danger"}`}>
                    {p.side.toUpperCase()} {p.size} {p.contract} @ {p.avg_price.toFixed(2)}
                  </span>
                  <span className={`font-bold ${p.unrealized_usd >= 0 ? "text-success" : "text-danger"}`}>
                    {p.unrealized_usd >= 0 ? "+" : ""}${p.unrealized_usd.toFixed(2)}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-ink-secondary">
                  SL {p.sl_price.toFixed(2)} · TP {p.tp_price.toFixed(2)} · BE@{p.be_trigger.toFixed(1)} · +1R@{p.lock_1r_trigger.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        )}

        {!confirmFlatten ? (
          <button
            type="button"
            onClick={() => setConfirmFlatten(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20"
          >
            <ShieldAlert size={14} /> Emergency Flatten & Cancel All
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={async () => {
                setConfirmFlatten(false);
                await onFlatten();
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-rose-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-rose-500"
            >
              <AlertTriangle size={13} /> CONFIRM FLATTEN NOW
            </button>
            <button
              type="button"
              onClick={() => setConfirmFlatten(false)}
              className="rounded-lg border border-hairline/40 bg-raised px-3 py-2 text-[11px] text-ink-secondary"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Morning v7 Plan */}
      {session.plan && (
        <div className="rounded-xl border border-hairline/40 bg-card p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
              Today&apos;s Powell v7 Plan ({session.plan.logged_at})
            </span>
            <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
              session.plan.bias === "bull" ? "bg-success/20 text-success" : session.plan.bias === "bear" ? "bg-danger/20 text-danger" : "bg-raised text-ink-secondary"
            }`}>
              {session.plan.bias}
            </span>
          </div>
          <div className="text-[11px] text-ink"><strong>DOL:</strong> {session.plan.dol}</div>
          <div className="mt-1 text-[11px] text-ink-secondary">{session.plan.notes}</div>
        </div>
      )}

      {/* Today's Live Forex Factory USD News */}
      <div className="rounded-xl border border-hairline/40 bg-card p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
          Live USD Economic Calendar ({state.date})
        </div>
        {news.length === 0 ? (
          <div className="text-[11px] text-ink-tertiary">No USD macro events listed today.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {news.map((ev, i) => {
              const imp = ev.impact.toLowerCase();
              const badge =
                imp === "high" ? "bg-rose-500/20 text-rose-300"
                  : imp === "holiday" ? "bg-purple-500/20 text-purple-300"
                    : imp === "medium" ? "bg-amber-400/20 text-amber-300"
                      : "bg-raised text-ink-tertiary";
              return (
                <div key={`${ev.time}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-inset px-2.5 py-1.5 text-[11px]">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${badge}`}>
                      {ev.impact}
                    </span>
                    <span className="truncate text-ink">{ev.event}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-ink-secondary">{ev.time}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
