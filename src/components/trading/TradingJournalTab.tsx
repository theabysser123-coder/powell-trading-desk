import { useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { Award, ChevronDown, ChevronRight, TrendingUp } from "lucide-react";
import type { TradingJournalsData } from "./types.ts";

interface Props {
  data: TradingJournalsData | null;
}

export function TradingJournalTab({ data }: Props) {
  const eqRef = useRef<HTMLDivElement | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.equity_curve_80d?.length || !eqRef.current) return;
    const chart = createChart(eqRef.current, {
      width: eqRef.current.clientWidth,
      height: 175,
      layout: {
        background: { type: ColorType.Solid, color: "#0c1017" },
        textColor: "#94a3b8",
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.06)" },
        horzLines: { color: "rgba(148,163,184,0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.16)" },
      timeScale: { borderColor: "rgba(148,163,184,0.16)" },
    });

    const area = chart.addSeries(AreaSeries, {
      lineColor: "#10b981",
      topColor: "rgba(16, 185, 129, 0.35)",
      bottomColor: "rgba(16, 185, 129, 0.02)",
      lineWidth: 2,
    });

    // Deduplicate ascending unix dates for lightweight-charts
    const seen = new Set<number>();
    const pts = data.equity_curve_80d
      .map((row) => ({
        time: Math.floor(new Date(`${row.date}T16:00:00Z`).getTime() / 1000) as UTCTimestamp,
        value: row.cum_v7_base_usd,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time))
      .filter((p) => {
        const k = Number(p.time);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

    area.setData(pts);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (eqRef.current) chart.applyOptions({ width: eqRef.current.clientWidth });
    });
    ro.observe(eqRef.current);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data]);

  const champ80 = data?.backtest?.champion_80d;
  const champOos = data?.backtest?.champion_setF_oos;

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* 80-Day Champion Verified Benchmark */}
      {champ80 && (
        <div className="rounded-xl border border-hairline/40 bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
              <TrendingUp size={13} /> 80-Day Blind Champion (18pt → 45pt + Ladder)
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 font-mono">
            <div className="rounded-lg bg-inset p-2">
              <div className="text-[10px] text-ink-tertiary">80d Net ($500)</div>
              <div className="text-[13px] font-bold text-success">+${champ80.total_usd.toLocaleString()}</div>
              <div className="text-[10px] text-ink-secondary">PF {champ80.pf} · {champ80.wr_pct}% WR</div>
            </div>
            <div className="rounded-lg bg-inset p-2">
              <div className="text-[10px] text-ink-tertiary">Strict OOS (20d)</div>
              <div className="text-[13px] font-bold text-success">
                +${(champOos?.total_usd ?? 4999).toLocaleString()}
              </div>
              <div className="text-[10px] text-ink-secondary">PF {champOos?.pf ?? 2.72} · DD -${Math.abs(champOos?.max_dd_eod ?? 1204).toFixed(0)}</div>
            </div>
            <div className="rounded-lg bg-inset p-2">
              <div className="text-[10px] text-ink-tertiary">Topstep $50K MC</div>
              <div className="text-[13px] font-bold text-sky-300">92.2% Pass</div>
              <div className="text-[10px] text-ink-secondary">86.4% 0-Reset P1</div>
            </div>
          </div>
        </div>
      )}

      {/* 80-Day Equity Curve */}
      <div className="overflow-hidden rounded-xl border border-hairline/40 bg-[#0c1017]">
        <div className="flex items-center justify-between border-b border-hairline/25 px-3 py-1.5 font-mono text-[10px] text-ink-secondary">
          <span className="font-semibold text-ink">80 Unseen Days Baseline Equity Curve</span>
          <span>Set E + Bulk40 + Set F</span>
        </div>
        <div ref={eqRef} className="w-full" />
      </div>

      {/* Topstep Payout Roadmap */}
      <div className="rounded-xl border border-hairline/40 bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
          <Award size={13} className="text-amber-300" /> Scaling & Payout Roadmap (DE Eligible)
        </div>
        <div className="flex flex-col gap-1.5 font-mono text-[11px]">
          <div className="flex items-center justify-between rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1.5">
            <span className="font-semibold text-emerald-300">1. Active: $50K Combine (12 MNQ)</span>
            <span className="text-ink-secondary">Med 14d · Target +$3,000</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-inset px-2.5 py-1.5 text-ink-secondary">
            <span>2. XFA Payout #1 (5d ≥ $150 &amp; ≥ $2,500)</span>
            <span>Med ~$1,527 net</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-inset px-2.5 py-1.5 text-ink-secondary">
            <span>3. Scale to 5× Topstep XFAs (Copy)</span>
            <span>$10K–$35K/mo (up to $200K)</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-inset px-2.5 py-1.5 text-ink-secondary">
            <span>4. Personal CME Account (100% split)</span>
            <span>5–20 NQ · No Caps</span>
          </div>
        </div>
      </div>

      {/* Live Daily Journals */}
      <div className="rounded-xl border border-hairline/40 bg-card p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
          Live Session Journals ({data?.live_journals.length ?? 0})
        </div>
        {!data?.live_journals.length ? (
          <div className="text-[11px] text-ink-tertiary">No live journals archived yet.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.live_journals.map((j) => {
              const open = expandedDate === j.date;
              return (
                <div key={j.date} className="rounded-lg border border-hairline/30 bg-inset">
                  <button
                    type="button"
                    onClick={() => setExpandedDate(open ? null : j.date)}
                    className="flex w-full items-center justify-between px-2.5 py-2 text-left font-mono text-[11px]"
                  >
                    <div className="flex items-center gap-1.5">
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span className="font-semibold text-ink">{j.date}</span>
                      <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-ink-secondary uppercase">{j.outcome}</span>
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">Grade {j.grade}</span>
                    </div>
                    <span className={j.realized_pnl_usd >= 0 ? "text-success" : "text-danger"}>
                      {j.realized_pnl_usd >= 0 ? "+" : ""}${j.realized_pnl_usd.toFixed(2)}
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-hairline/25 px-3 py-2 text-[11px] text-ink-secondary">
                      <p className="mb-1.5 text-ink">{j.summary}</p>
                      <p className="text-[10px] text-ink-tertiary"><strong>Lessons:</strong> {j.lessons}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
