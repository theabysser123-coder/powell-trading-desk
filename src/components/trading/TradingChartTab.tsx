import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { RefreshCw, Layers } from "lucide-react";
import type { TradingChartData, TradingPosition } from "./types.ts";

interface Props {
  chart: TradingChartData | null;
  loading: boolean;
  tf: number;
  onTfChange: (tf: number) => void;
  onRefresh: () => void;
  positions: TradingPosition[];
}

const KEY_LEVEL_STYLES: Array<{ key: string; label: string; color: string; style: LineStyle }> = [
  { key: "00:00 MO", label: "00:00 MO", color: "#ec4899", style: LineStyle.Dashed },
  { key: "10:00 Open", label: "10:00 KO", color: "#facc15", style: LineStyle.Solid },
  { key: "09:30 Open", label: "09:30 Open", color: "#a855f7", style: LineStyle.Dotted },
  { key: "PDH", label: "PDH", color: "#38bdf8", style: LineStyle.Dashed },
  { key: "PDL", label: "PDL", color: "#38bdf8", style: LineStyle.Dashed },
  { key: "London H", label: "Lon H", color: "#60a5fa", style: LineStyle.Dotted },
  { key: "London L", label: "Lon L", color: "#60a5fa", style: LineStyle.Dotted },
  { key: "Data H", label: "Data H", color: "#fb923c", style: LineStyle.SparseDotted },
  { key: "Data L", label: "Data L", color: "#fb923c", style: LineStyle.SparseDotted },
];

export function TradingChartTab({ chart, loading, tf, onTfChange, onRefresh, positions }: Props) {
  const nqHostRef = useRef<HTMLDivElement | null>(null);
  const esHostRef = useRef<HTMLDivElement | null>(null);
  const [showLevels, setShowLevels] = useState(true);
  const [showRbs, setShowRbs] = useState(true);
  const [showSmt, setShowSmt] = useState(true);

  useEffect(() => {
    if (!chart || !chart.nq_candles.length || !nqHostRef.current) return;

    const baseOpts = (el: HTMLDivElement, height: number) => ({
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "#0c1017" },
        textColor: "#94a3b8",
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.16)" },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.16)",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const nqChart: IChartApi = createChart(nqHostRef.current, baseOpts(nqHostRef.current, showSmt ? 290 : 410));
    const nqSeries = nqChart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    nqSeries.setData(
      chart.nq_candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })),
    );

    // Draw Powell Key Levels
    if (showLevels) {
      for (const spec of KEY_LEVEL_STYLES) {
        const px = chart.levels[spec.key];
        if (typeof px === "number") {
          nqSeries.createPriceLine({
            price: px,
            color: spec.color,
            lineWidth: spec.key === "10:00 Open" || spec.key === "00:00 MO" ? 2 : 1,
            lineStyle: spec.style,
            axisLabelVisible: true,
            title: spec.label,
          });
        }
      }
      if (chart.nwog) {
        nqSeries.createPriceLine({
          price: chart.nwog.ce,
          color: "#f59e0b",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "NWOG CE",
        });
      }
    }

    // Draw Top EL=OK Rejection Block CEs
    if (showRbs) {
      const okRbs = chart.rbs.filter((r) => r.el_status === "OK").slice(0, 4);
      for (const rb of okRbs) {
        nqSeries.createPriceLine({
          price: rb.ce,
          color: rb.side === "long" ? "#34d399" : "#f87171",
          lineWidth: rb.big ? 2 : 1,
          lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: true,
          title: `${rb.tf}m RB ${rb.side === "long" ? "L" : "S"}`,
        });
      }
    }

    // Draw Active Position Entry / 18pt SL / 45pt TP / Defense Ladder (+27pt BE, +36pt +1R)
    for (const pos of positions) {
      nqSeries.createPriceLine({ price: pos.avg_price, color: "#ffffff", lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `ENTRY (${pos.size})` });
      nqSeries.createPriceLine({ price: pos.sl_price, color: "#ef4444", lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "SL -18pt" });
      nqSeries.createPriceLine({ price: pos.tp_price, color: "#10b981", lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "TP +45pt" });
      nqSeries.createPriceLine({ price: pos.be_trigger, color: "#facc15", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "BE @+27pt" });
      nqSeries.createPriceLine({ price: pos.lock_1r_trigger, color: "#38bdf8", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "+1R @+36pt" });
    }

    nqChart.timeScale().fitContent();

    let esChart: IChartApi | null = null;
    if (showSmt && esHostRef.current && chart.es_candles.length) {
      esChart = createChart(esHostRef.current, baseOpts(esHostRef.current, 145));
      const esSeries = esChart.addSeries(CandlestickSeries, {
        upColor: "#14b8a6",
        downColor: "#f43f5e",
        borderUpColor: "#14b8a6",
        borderDownColor: "#f43f5e",
        wickUpColor: "#14b8a6",
        wickDownColor: "#f43f5e",
      });
      esSeries.setData(
        chart.es_candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })),
      );
      esChart.timeScale().fitContent();

      // Sync pan/zoom between NQ and ES for instant SMT comparison
      let syncing = false;
      nqChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncing || !range || !esChart) return;
        syncing = true;
        esChart.timeScale().setVisibleLogicalRange(range);
        syncing = false;
      });
      esChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncing || !range) return;
        syncing = true;
        nqChart.timeScale().setVisibleLogicalRange(range);
        syncing = false;
      });
    }

    const ro = new ResizeObserver(() => {
      if (nqHostRef.current) nqChart.applyOptions({ width: nqHostRef.current.clientWidth });
      if (esChart && esHostRef.current) esChart.applyOptions({ width: esHostRef.current.clientWidth });
    });
    ro.observe(nqHostRef.current);
    if (esHostRef.current) ro.observe(esHostRef.current);

    return () => {
      ro.disconnect();
      nqChart.remove();
      esChart?.remove();
    };
  }, [chart, showLevels, showRbs, showSmt, positions]);

  const ko = chart?.ko_10am;
  const okRbs = (chart?.rbs ?? []).filter((r) => r.el_status === "OK");

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Chart Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-hairline/40 bg-inset p-0.5">
          {[1, 5, 15, 60].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onTfChange(v)}
              className={`rounded-md px-2 py-1 font-mono text-[11px] font-medium transition ${
                tf === v ? "bg-raised text-ink shadow-sm" : "text-ink-secondary hover:text-ink"
              }`}
            >
              {v === 60 ? "1H" : `${v}m`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowLevels((v) => !v)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
              showLevels ? "border-accent/50 bg-accent/15 text-accent" : "border-hairline/40 text-ink-secondary"
            }`}
          >
            <Layers size={11} /> Levels
          </button>
          <button
            type="button"
            onClick={() => setShowRbs((v) => !v)}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              showRbs ? "border-success/50 bg-success/15 text-success" : "border-hairline/40 text-ink-secondary"
            }`}
          >
            RBs
          </button>
          <button
            type="button"
            onClick={() => setShowSmt((v) => !v)}
            className={`rounded-md border px-2 py-1 text-[11px] ${
              showSmt ? "border-sky-400/50 bg-sky-400/15 text-sky-300" : "border-hairline/40 text-ink-secondary"
            }`}
          >
            ES SMT
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-hairline/40 bg-raised px-2 py-1 text-[11px] text-ink-secondary hover:text-ink disabled:opacity-50"
            title="Force refresh live TopstepX candles"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Live 10 AM KO Tracker Strip */}
      {ko && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline/40 bg-card px-3 py-2 font-mono text-[11px]">
          <span className="text-ink-secondary">
            10:00 KO <strong className="text-yellow-300">{ko.open.toFixed(2)}</strong>
          </span>
          <span className="text-ink-secondary">
            Hi <span className="text-success">+{ko.max_above.toFixed(1)}</span> · Lo <span className="text-danger">-{ko.max_below.toFixed(1)}</span>
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            ko.bull_reclaim ? "bg-success/20 text-success" : ko.bear_reclaim ? "bg-danger/20 text-danger" : "bg-raised text-ink-secondary"
          }`}>
            {ko.bull_reclaim ? "BULL RECLAIM READY" : ko.bear_reclaim ? "BEAR RECLAIM READY" : "NO RECLAIM"}
          </span>
        </div>
      )}

      {/* NQ Main Interactive Chart */}
      <div className="overflow-hidden rounded-xl border border-hairline/40 bg-[#0c1017]">
        <div className="flex items-center justify-between border-b border-hairline/25 px-3 py-1.5 font-mono text-[11px]">
          <span className="font-semibold text-ink">
            {chart?.contracts.mnq_name ?? "MNQZ6"} · {tf === 60 ? "1H" : `${tf}m`} (NY ET)
          </span>
          <span className="text-ink-secondary">{chart?.cur_t_et ?? "Loading..."}</span>
        </div>
        <div ref={nqHostRef} className="w-full" />
      </div>

      {/* Synchronized ES SMT Chart */}
      {showSmt && (
        <div className="overflow-hidden rounded-xl border border-hairline/40 bg-[#0c1017]">
          <div className="flex items-center justify-between border-b border-hairline/25 px-3 py-1 font-mono text-[10px] text-ink-secondary">
            <span className="font-semibold text-sky-300">{chart?.contracts.es_name ?? "ESZ6"} · Synchronized SMT</span>
            <span>Pan/zoom linked with NQ</span>
          </div>
          <div ref={esHostRef} className="w-full" />
        </div>
      )}

      {/* EL=OK Rejection Blocks Table */}
      <div className="rounded-xl border border-hairline/40 bg-card p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-secondary">
            Active Powell Rejection Blocks (EL=OK: {okRbs.length})
          </span>
          <span className="font-mono text-[10px] text-ink-tertiary">4H / 1H / 15m</span>
        </div>
        {okRbs.length === 0 ? (
          <div className="py-2 text-center text-[12px] text-ink-tertiary">No EL=OK Rejection Blocks near price right now.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {okRbs.slice(0, 6).map((rb) => (
              <div
                key={rb.id}
                className="flex items-center justify-between rounded-lg border border-hairline/30 bg-inset px-2.5 py-1.5 font-mono text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    rb.side === "long" ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
                  }`}>
                    {rb.tf}m {rb.side.toUpperCase()}
                  </span>
                  <span className="text-ink">CE {rb.ce.toFixed(2)}</span>
                  {rb.big && <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">BIG {rb.wick}pt</span>}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-ink-secondary">
                  <span>0.62: {rb.fib62.toFixed(1)}</span>
                  <span className={rb.status === "UNTAPPED" ? "text-accent" : "text-amber-300"}>{rb.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
