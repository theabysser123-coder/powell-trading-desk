import { useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, CrosshairMode, LineStyle, LineType, createChart, type UTCTimestamp } from "lightweight-charts";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TradingJournalsData } from "./types.ts";

interface Props {
  data: TradingJournalsData | null;
}

export function TradingJournalTab({ data }: Props) {
  const eqRef = useRef<HTMLDivElement | null>(null);
  const eqLegendRef = useRef<HTMLSpanElement | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.equity_curve_80d?.length || !eqRef.current) return;
    const chart = createChart(eqRef.current, {
      width: eqRef.current.clientWidth,
      height: 184,
      layout: {
        background: { type: ColorType.Solid, color: "#101012" },
        textColor: "#7c7c82",
        fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(255, 255, 255, 0.028)", style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: "rgba(255, 255, 255, 0.18)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#242428",
        },
        horzLine: {
          color: "rgba(255, 255, 255, 0.14)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#242428",
        },
      },
      rightPriceScale: {
        borderVisible: false,
        ticksVisible: false,
        entireTextOnly: true,
        scaleMargins: { top: 0.14, bottom: 0.12 },
      },
      timeScale: {
        borderVisible: false,
        ticksVisible: false,
        rightOffset: 3,
      },
      kineticScroll: { mouse: true, touch: true },
    });

    const area = chart.addSeries(AreaSeries, {
      lineColor: "#26c485",
      topColor: "rgba(38, 196, 133, 0.24)",
      bottomColor: "rgba(38, 196, 133, 0.0)",
      lineWidth: 2,
      lineType: LineType.Curved,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#101012",
      crosshairMarkerBackgroundColor: "#26c485",
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: {
        type: "custom",
        formatter: (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      },
    });

    const seen = new Set<number>();
    const metaByTime = new Map<number, { date: string; cum: number; day: number }>();
    const pts = data.equity_curve_80d
      .map((row) => ({
        time: Math.floor(new Date(`${row.date}T16:00:00Z`).getTime() / 1000) as UTCTimestamp,
        value: row.cum_v7_base_usd,
        date: row.date,
        day: row.day_usd,
      }))
      .sort((a, b) => Number(a.time) - Number(b.time))
      .filter((p) => {
        const k = Number(p.time);
        if (seen.has(k)) return false;
        seen.add(k);
        metaByTime.set(k, { date: p.date, cum: p.value, day: p.day });
        return true;
      });

    area.setData(pts.map(({ time, value }) => ({ time, value })));
    chart.timeScale().fitContent();

    const lastPt = pts[pts.length - 1];
    const renderLegend = (entry: { date: string; cum: number; day: number } | undefined) => {
      if (!eqLegendRef.current || !entry) return;
      const sign = entry.cum >= 0 ? "+" : "-";
      eqLegendRef.current.textContent = `${entry.date} · ${sign}$${Math.abs(entry.cum).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    };
    renderLegend(lastPt ? { date: lastPt.date, cum: lastPt.value, day: lastPt.day } : undefined);

    chart.subscribeCrosshairMove((param) => {
      const t = typeof param.time === "number" ? param.time : null;
      const entry = t !== null ? metaByTime.get(t) : lastPt ? { date: lastPt.date, cum: lastPt.value, day: lastPt.day } : undefined;
      renderLegend(entry);
    });

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
    <div className="flex flex-col gap-3.5 p-4">
      {/* 80-Day Benchmark KPIs */}
      {champ80 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-edge bg-card p-3">
            <div className="text-[11px] text-ink-tertiary">80d Champion</div>
            <div className="mt-1 font-mono text-[14px] font-semibold text-success">
              +${champ80.total_usd.toLocaleString()}
            </div>
            <div className="mt-0.5 font-mono text-[10.5px] text-ink-tertiary">
              PF {champ80.pf} · {champ80.wr_pct}%
            </div>
          </div>
          <div className="rounded-xl border border-edge bg-card p-3">
            <div className="text-[11px] text-ink-tertiary">Set F OOS</div>
            <div className="mt-1 font-mono text-[14px] font-semibold text-success">
              +${(champOos?.total_usd ?? 4999).toLocaleString()}
            </div>
            <div className="mt-0.5 font-mono text-[10.5px] text-ink-tertiary">
              PF {champOos?.pf ?? 2.72} · -${Math.abs(champOos?.max_dd_eod ?? 1204).toFixed(0)}
            </div>
          </div>
          <div className="rounded-xl border border-edge bg-card p-3">
            <div className="text-[11px] text-ink-tertiary">Topstep MC</div>
            <div className="mt-1 font-mono text-[14px] font-semibold text-ink">92.2%</div>
            <div className="mt-0.5 font-mono text-[10.5px] text-ink-tertiary">86.4% 0-reset P1</div>
          </div>
        </div>
      )}

      {/* Equity Curve */}
      <div className="overflow-hidden rounded-xl border border-edge bg-[#101012]">
        <div className="flex items-center justify-between border-b border-edge/60 px-3.5 py-2">
          <span className="text-[12px] font-medium text-ink">80-Day Blind Equity</span>
          <span ref={eqLegendRef} className="font-mono text-[11px] text-ink-secondary">Set E + Bulk40 + Set F</span>
        </div>
        <div ref={eqRef} className="w-full" />
      </div>

      {/* Scaling Roadmap */}
      <div className="rounded-xl border border-edge bg-card">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <span className="text-[12px] font-medium text-ink">Scaling Roadmap</span>
          <span className="text-[11px] text-ink-tertiary">DE Eligible</span>
        </div>
        <div className="divide-y divide-edge text-[12px]">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="flex items-center gap-2 font-medium text-ink">
              <span className="size-1.5 rounded-full bg-success" />
              1. $50K Combine (12 MNQ)
            </span>
            <span className="font-mono text-[11px] text-ink-secondary">Med 14d · +$3k</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 text-ink-secondary">
            <span>2. XFA Payout #1 (5d ≥ $150 &amp; ≥ $2.5k)</span>
            <span className="font-mono text-[11px] text-ink-tertiary">~$1,527 net</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 text-ink-secondary">
            <span>3. 5× Topstep XFAs (Copy)</span>
            <span className="font-mono text-[11px] text-ink-tertiary">$10k–$35k/mo</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 text-ink-secondary">
            <span>4. Personal CME Account</span>
            <span className="font-mono text-[11px] text-ink-tertiary">5–20 NQ · No caps</span>
          </div>
        </div>
      </div>

      {/* Live Journals */}
      <div className="rounded-xl border border-edge bg-card">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <span className="text-[12px] font-medium text-ink">Live Journals</span>
          <span className="font-mono text-[11px] text-ink-tertiary">{data?.live_journals.length ?? 0} days</span>
        </div>
        {!data?.live_journals.length ? (
          <div className="px-4 py-3 text-[12px] text-ink-tertiary">No live journals yet.</div>
        ) : (
          <div className="divide-y divide-edge">
            {data.live_journals.map((j) => {
              const open = expandedDate === j.date;
              return (
                <div key={j.date}>
                  <button
                    type="button"
                    onClick={() => setExpandedDate(open ? null : j.date)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[12px] transition hover:bg-raised/40"
                  >
                    <div className="flex items-center gap-2">
                      {open ? <ChevronDown size={13} className="text-ink-tertiary" /> : <ChevronRight size={13} className="text-ink-tertiary" />}
                      <span className="font-mono font-medium text-ink">{j.date}</span>
                      <span className="text-[11px] capitalize text-ink-tertiary">
                        {j.outcome} · {j.grade}
                      </span>
                    </div>
                    <span className={`font-mono text-[12px] ${j.realized_pnl_usd >= 0 ? "text-success" : "text-danger"}`}>
                      {j.realized_pnl_usd >= 0 ? "+" : ""}${j.realized_pnl_usd.toFixed(2)}
                    </span>
                  </button>
                  {open && (
                    <div className="border-t border-edge bg-inset/60 px-4 py-3 text-[12px] leading-relaxed text-ink-secondary">
                      <p className="text-ink">{j.summary}</p>
                      <p className="mt-2 text-[11px] text-ink-tertiary">{j.lessons}</p>
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
