import { useState } from "react";
import { AlertTriangle, Check, ShieldAlert, X } from "lucide-react";
import type { TradingState } from "./types.ts";

interface Props {
  state: TradingState | null;
  busyAction: string | null;
  onFlatten: () => Promise<void>;
  onUpdateConfig: (patch: { execution_mode?: "auto" | "approve"; topstep_mode?: "practice" | "live"; base_risk?: number }) => Promise<void>;
  onDecideApproval: (id: string, action: "approve" | "reject") => Promise<void>;
  onTestProposal: () => Promise<void>;
}

function GaugeRow({ label, rightText, pct, accent }: { label: string; rightText: string; pct: number; accent: "success" | "warning" | "danger" | "neutral" }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill =
    accent === "success" ? "bg-success"
      : accent === "warning" ? "bg-warning"
        : accent === "danger" ? "bg-danger"
          : "bg-ink-secondary";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-ink-secondary">{label}</span>
        <span className="font-mono text-[11.5px] text-ink">{rightText}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-inset">
        <div className={`h-full rounded-full transition-all ${fill}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function TradingHudTab({ state, busyAction, onFlatten, onUpdateConfig, onDecideApproval, onTestProposal }: Props) {
  const [confirmFlatten, setConfirmFlatten] = useState(false);

  if (!state) {
    return <div className="p-6 text-center text-[12px] text-ink-tertiary">Connecting to TopstepX…</div>;
  }

  const { account, desk, market, positions, open_orders, session, news, approvals } = state;
  const vol = market.volatility;
  const volDot = vol.regime === "CRASH" ? "bg-danger" : vol.regime === "ELEVATED" ? "bg-warning" : "bg-success";

  return (
    <div className="flex flex-col gap-3.5 p-4">
      {/* Account Summary Card */}
      <div className="rounded-xl border border-edge bg-card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-[11px] text-ink-tertiary">
              {account.is_practice ? "Practice Account" : "Topstep $50K Combine"}
            </div>
            <div className="mt-0.5 font-mono text-[22px] font-semibold tracking-tight text-ink">
              ${account.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="text-right font-mono">
            <div className={`text-[13px] font-medium ${account.today_net >= 0 ? "text-success" : "text-danger"}`}>
              {account.today_net >= 0 ? "+" : ""}${account.today_net.toFixed(2)}
            </div>
            <div className="mt-0.5 text-[10.5px] text-ink-tertiary">Today</div>
          </div>
        </div>

        {/* Clean Monochrome Control Pills */}
        <div className="mt-4 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onUpdateConfig({ topstep_mode: desk.topstep_mode === "live" ? "practice" : "live" })}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-edge bg-inset px-2.5 py-2 text-[11.5px] font-medium text-ink transition hover:bg-raised disabled:opacity-50"
          >
            <span className={`size-1.5 rounded-full ${desk.topstep_mode === "live" ? "bg-success" : "bg-warning"}`} />
            {desk.topstep_mode === "live" ? "Live $50K" : "Practice"}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onUpdateConfig({ execution_mode: desk.execution_mode === "auto" ? "approve" : "auto" })}
            className="rounded-lg border border-edge bg-inset px-2.5 py-2 text-[11.5px] font-medium text-ink transition hover:bg-raised disabled:opacity-50"
          >
            {desk.execution_mode === "auto" ? "Auto Execute" : "1-Click Approve"}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onUpdateConfig({ base_risk: desk.base_risk >= 450 ? 400 : 450 })}
            className="rounded-lg border border-edge bg-inset px-2.5 py-2 font-mono text-[11.5px] font-medium text-ink transition hover:bg-raised disabled:opacity-50"
          >
            {desk.att1_mnq} MNQ · ${desk.base_risk}
          </button>
        </div>
      </div>

      {/* Topstep Risk Limits */}
      <div className="flex flex-col gap-3 rounded-xl border border-edge bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-ink">Risk Limits</span>
          <span className="font-mono text-[11px] text-ink-tertiary">
            {desk.sl_pts}pt SL → {desk.tp_pts}pt TP
          </span>
        </div>

        {!account.is_practice && (
          <GaugeRow
            label="Combine target"
            rightText={`$${account.net_profit.toFixed(0)} / $3,000`}
            pct={account.progress_pct}
            accent="success"
          />
        )}
        <GaugeRow
          label="EOD MLL cushion"
          rightText={`$${account.mll_cushion.toFixed(0)} left`}
          pct={(account.mll_cushion / 2000) * 100}
          accent={account.mll_cushion < 800 ? "danger" : account.mll_cushion < 1300 ? "warning" : "neutral"}
        />
        <GaugeRow
          label="Personal DLL"
          rightText={`$${account.pdll_remaining.toFixed(0)} / $750`}
          pct={(account.pdll_remaining / 750) * 100}
          accent={account.pdll_remaining < 250 ? "danger" : "success"}
        />

        <div className="flex items-center justify-between border-t border-edge pt-2.5 text-[11px] text-ink-tertiary">
          <span>55% consistency cap ≤ $1,650/day</span>
          <span className="font-mono text-ink-secondary">1 win = +$1,065</span>
        </div>
      </div>

      {/* Volatility Regime Row */}
      <div className="flex items-center justify-between rounded-xl border border-edge bg-card px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`size-2 rounded-full ${volDot}`} />
          <div>
            <div className="text-[12px] font-medium text-ink">
              Volatility · {vol.regime === "CRASH" ? "Crash regime" : vol.regime === "ELEVATED" ? "Elevated" : "Normal"}
            </div>
            <div className="font-mono text-[11px] text-ink-tertiary">
              Overnight {vol.overnight_range_pt}pt (norm 258) · 1m med {vol.m1_median_pt}pt (norm 21)
            </div>
          </div>
        </div>
      </div>

      {/* Trade Approval Queue */}
      <div className="rounded-xl border border-edge bg-card p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[12px] font-medium text-ink">Trade Approvals</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-ink-tertiary">{approvals.length} pending</span>
            {account.is_practice && (
              <button
                type="button"
                onClick={onTestProposal}
                disabled={busyAction !== null}
                className="rounded-full border border-edge bg-inset px-2.5 py-0.5 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink"
              >
                Demo
              </button>
            )}
          </div>
        </div>

        {approvals.length === 0 ? (
          <div className="text-[12px] text-ink-tertiary">
            {desk.execution_mode === "auto"
              ? "Auto-execute is active — verified v7 setups route directly with 18pt / 45pt OCO brackets."
              : "1-click approval is active — proposed setups will appear here before routing."}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {approvals.map((a) => (
              <div key={a.id} className="rounded-xl border border-edge bg-inset p-3">
                <div className="flex items-center justify-between font-mono text-[12px]">
                  <span className={`font-medium ${a.side === "long" ? "text-success" : "text-danger"}`}>
                    {a.side.toUpperCase()} {a.qty} MNQ @ {a.entry.toFixed(2)}
                  </span>
                  <span className="text-[11px] text-ink-tertiary">{a.entry_type}</span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-ink-secondary">
                  SL {a.sl.toFixed(2)} (-${a.risk_usd.toFixed(0)}) · TP {a.tp.toFixed(2)} (+${a.reward_usd.toFixed(0)})
                </div>
                <div className="mt-1.5 text-[11.5px] text-ink-secondary">{a.setup} — {a.reason}</div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => onDecideApproval(a.id, "approve")}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-app transition hover:opacity-90 disabled:opacity-40"
                  >
                    <Check size={13} /> Approve & Execute
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => onDecideApproval(a.id, "reject")}
                    className="flex items-center justify-center gap-1 rounded-full border border-edge bg-raised px-3.5 py-1.5 text-[12px] text-ink-secondary hover:text-ink disabled:opacity-40"
                  >
                    <X size={13} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live Position & Flatten */}
      <div className="rounded-xl border border-edge bg-card p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[12px] font-medium text-ink">Position</span>
          <span className="font-mono text-[11px] text-ink-tertiary">
            Attempts {session.attempts}/2{session.day_locked ? " · Locked" : ""}
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="mb-3 rounded-lg bg-inset px-3 py-2.5 text-[12px] text-ink-tertiary">
            Flat · {open_orders.length} working orders
          </div>
        ) : (
          <div className="mb-3 flex flex-col gap-2">
            {positions.map((p) => (
              <div key={String(p.id)} className="rounded-lg bg-inset px-3 py-2.5 font-mono text-[11.5px]">
                <div className="flex items-center justify-between">
                  <span className={p.side === "long" ? "text-success" : "text-danger"}>
                    {p.side.toUpperCase()} {p.size} {p.contract} @ {p.avg_price.toFixed(2)}
                  </span>
                  <span className={p.unrealized_usd >= 0 ? "text-success" : "text-danger"}>
                    {p.unrealized_usd >= 0 ? "+" : ""}${p.unrealized_usd.toFixed(2)}
                  </span>
                </div>
                <div className="mt-1 text-[10.5px] text-ink-tertiary">
                  SL {p.sl_price.toFixed(2)} · TP {p.tp_price.toFixed(2)} · BE {p.be_trigger.toFixed(1)} · +1R {p.lock_1r_trigger.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        )}

        {!confirmFlatten ? (
          <button
            type="button"
            onClick={() => setConfirmFlatten(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-full border border-edge bg-inset px-3 py-2 text-[12px] font-medium text-danger transition hover:bg-raised"
          >
            <ShieldAlert size={13} /> Flatten & Cancel All
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
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-danger px-3 py-2 text-[12px] font-medium text-danger-ink hover:opacity-90"
            >
              <AlertTriangle size={13} /> Confirm Flatten
            </button>
            <button
              type="button"
              onClick={() => setConfirmFlatten(false)}
              className="rounded-full border border-edge bg-raised px-4 py-2 text-[12px] text-ink-secondary hover:text-ink"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Morning Plan */}
      {session.plan && (
        <div className="rounded-xl border border-edge bg-card p-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-medium text-ink">Morning Plan</span>
            <span className="font-mono text-[11px] capitalize text-ink-tertiary">
              {session.plan.bias} · {session.plan.logged_at.slice(11)} ET
            </span>
          </div>
          <div className="text-[12px] text-ink-secondary">{session.plan.dol}</div>
          <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink-tertiary">{session.plan.notes}</div>
        </div>
      )}

      {/* USD Economic Calendar */}
      <div className="rounded-xl border border-edge bg-card">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <span className="text-[12px] font-medium text-ink">USD Calendar</span>
          <span className="font-mono text-[11px] text-ink-tertiary">{state.date}</span>
        </div>
        {news.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-ink-tertiary">No USD events listed today.</div>
        ) : (
          <div className="divide-y divide-edge">
            {news.map((ev, i) => {
              const imp = ev.impact.toLowerCase();
              const dot =
                imp === "high" ? "bg-danger"
                  : imp === "holiday" ? "bg-accent"
                    : imp === "medium" ? "bg-warning"
                      : "bg-ink-tertiary/40";
              return (
                <div key={`${ev.time}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2 text-[12px]">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
                    <span className="truncate text-ink-secondary">{ev.event}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-ink-tertiary">{ev.time}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
