import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { RefreshCw } from "lucide-react";
import type { TradingChartData, TradingPosition } from "./types.ts";

interface Props {
  chart: TradingChartData | null;
  loading: boolean;
  tf: number;
  onTfChange: (tf: number) => void;
  onRefresh: () => void;
  positions: TradingPosition[];
}

const CORE_LEVELS: Array<{ key: string; label: string; color: string; style: LineStyle }> = [
  { key: "10:00 Open", label: "10:00", color: "rgba(255, 196, 61, 0.78)", style: LineStyle.Solid },
  { key: "00:00 MO", label: "MO", color: "rgba(245, 245, 245, 0.42)", style: LineStyle.Dashed },
  { key: "PDH", label: "PDH", color: "rgba(245, 245, 245, 0.24)", style: LineStyle.Dotted },
  { key: "PDL", label: "PDL", color: "rgba(245, 245, 245, 0.24)", style: LineStyle.Dotted },
];

const EXTRA_LEVELS: Array<{ key: string; label: string; color: string; style: LineStyle }> = [
  { key: "09:30 Open", label: "09:30", color: "rgba(168, 162, 158, 0.32)", style: LineStyle.Dotted },
  { key: "London H", label: "Lon H", color: "rgba(127, 192, 255, 0.38)", style: LineStyle.Dotted },
  { key: "London L", label: "Lon L", color: "rgba(127, 192, 255, 0.38)", style: LineStyle.Dotted },
  { key: "Data H", label: "Data H", color: "rgba(255, 152, 0, 0.42)", style: LineStyle.SparseDotted },
  { key: "Data L", label: "Data L", color: "rgba(255, 152, 0, 0.42)", style: LineStyle.SparseDotted },
];

export function TradingChartTab({ chart, loading, tf, onTfChange, onRefresh, positions }: Props) {
  const nqHostRef = useRef<HTMLDivElement | null>(null);
  const esHostRef = useRef<HTMLDivElement | null>(null);
  const [showLevels, setShowLevels] = useState(true);
  const [showAllLevels, setShowAllLevels] = useState(false);
  const [showRbs, setShowRbs] = useState(false);
  const [showSmt, setShowSmt] = useState(true);

  useEffect(() => {
    if (!chart || !chart.nq_candles.length || !nqHostRef.current) return;

    const baseOpts = (el: HTMLDivElement, height: number) => ({
      width: el.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "#121212" },
        textColor: "#8a8a8e",
        fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
        fontSize: 10.5,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(245, 245, 245, 0.035)" },
        horzLines: { color: "rgba(245, 245, 245, 0.045)" },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "rgba(245, 245, 245, 0.18)", labelBackgroundColor: "#282828" },
        horzLine: { color: "rgba(245, 245, 245, 0.18)", labelBackgroundColor: "#282828" },
      },
      rightPriceScale: {
        borderColor: "rgba(245, 245, 245, 0.08)",
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "rgba(245, 245, 245, 0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const nqChart: IChartApi = createChart(nqHostRef.current, baseOpts(nqHostRef.current, showSmt ? 310 : 440));
    const nqSeries = nqChart.addSeries(CandlestickSeries, {
      upColor: "#38d591",
      downColor: "#ff5667",
      borderUpColor: "#38d591",
      borderDownColor: "#ff5667",
      wickUpColor: "#38d591",
      wickDownColor: "#ff5667",
    });
    nqSeries.setData(chart.nq_candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));

    if (showLevels) {
      const specs = showAllLevels ? [...CORE_LEVELS, ...EXTRA_LEVELS] : CORE_LEVELS;
      for (const spec of specs) {
        const px = chart.levels[spec.key];
        if (typeof px === "number") {
          nqSeries.createPriceLine({
            price: px,
            color: spec.color,
            lineWidth: 1,
            lineStyle: spec.style,
            axisLabelVisible: spec.key === "10:00 Open" || spec.key === "00:00 MO",
            title: spec.label,
          });
        }
      }
      if (showAllLevels && chart.nwog) {
        nqSeries.createPriceLine({
          price: chart.nwog.ce,
          color: "rgba(255, 152, 0, 0.45)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: "NWOG",
        });
      }
    }

    if (showRbs) {
      const nearest = chart.rbs.filter((r) => r.el_status === "OK").slice(0, 3);
      for (const rb of nearest) {
        nqSeries.createPriceLine({
          price: rb.ce,
          color: rb.side === "long" ? "rgba(56, 213, 145, 0.55)" : "rgba(255, 86, 103, 0.55)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${rb.tf}m RB`,
        });
      }
    }

    for (const pos of positions) {
      nqSeries.createPriceLine({ price: pos.avg_price, color: "#f5f5f5", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: `Entry ${pos.size}` });
      nqSeries.createPriceLine({ price: pos.sl_price, color: "#ff5667", lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "SL" });
      nqSeries.createPriceLine({ price: pos.tp_price, color: "#38d591", lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "TP" });
      nqSeries.createPriceLine({ price: pos.be_trigger, color: "rgba(255, 196, 61, 0.55)", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "BE +27" });
      nqSeries.createPriceLine({ price: pos.lock_1r_trigger, color: "rgba(127, 192, 255, 0.55)", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "+1R +36" });
    }

    nqChart.timeScale().fitContent();

    let esChart: IChartApi | null = null;
    if (showSmt && esHostRef.current && chart.es_candles.length) {
      esChart = createChart(esHostRef.current, baseOpts(esHostRef.current, 148));
      const esSeries = esChart.addSeries(CandlestickSeries, {
        upColor: "#38d591",
        downColor: "#ff5667",
        borderUpColor: "#38d591",
        borderDownColor: "#ff5667",
        wickUpColor: "#38d591",
        wickDownColor: "#ff5667",
      });
      esSeries.setData(chart.es_candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
      esChart.timeScale().fitContent();

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
  }, [chart, showLevels, showAllLevels, showRbs, showSmt, positions]);

  const ko = chart?.ko_10am;
  const okRbs = (chart?.rbs ?? []).filter((r) => r.el_status === "OK");

  const pillCls = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
      active
        ? "bg-control text-ink"
        : "text-ink-tertiary hover:bg-raised/60 hover:text-ink-secondary"
    }`;

  return (
    <div className="flex flex-col gap-3.5 p-4">
      {/* Minimal Pill Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-0.5 rounded-full border border-edge bg-inset p-0.5">
          {[1, 5, 15, 60].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onTfChange(v)}
              className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-medium transition ${
                tf === v ? "bg-control text-ink" : "text-ink-tertiary hover:text-ink-secondary"
              }`}
            >
              {v === 60 ? "1H" : `${v}m`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5 rounded-full border border-edge bg-inset p-0.5">
            <button type="button" onClick={() => setShowLevels((v) => !v)} className={pillCls(showLevels)}>
              Levels
            </button>
            {showLevels && (
              <button type="button" onClick={() => setShowAllLevels((v) => !v)} className={pillCls(showAllLevels)}>
                All
              </button>
            )}
            <button type="button" onClick={() => setShowRbs((v) => !v)} className={pillCls(showRbs)}>
              RBs
            </button>
            <button type="button" onClick={() => setShowSmt((v) => !v)} className={pillCls(showSmt)}>
              SMT
            </button>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex size-7 items-center justify-center rounded-full border border-edge bg-inset text-ink-tertiary transition hover:bg-raised hover:text-ink disabled:opacity-40"
            title="Refresh live candles"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Main NQ Chart Card */}
      <div className="overflow-hidden rounded-xl border border-edge bg-app">
        <div className="flex items-center justify-between border-b border-edge px-3.5 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-ink">{chart?.contracts.mnq_name ?? "MNQZ6"}</span>
            <span className="font-mono text-[11px] text-ink-tertiary">{tf === 60 ? "1H" : `${tf}m`}</span>
            {ko && (
              <span className="ml-1 flex items-center gap-1.5 border-l border-edge pl-2.5 font-mono text-[11px] text-ink-secondary">
                <span>KO {ko.open.toFixed(2)}</span>
                <span className="text-ink-tertiary">·</span>
                <span className={ko.bull_reclaim ? "text-success" : ko.bear_reclaim ? "text-danger" : "text-ink-tertiary"}>
                  {ko.bull_reclaim ? "Bull reclaim" : ko.bear_reclaim ? "Bear reclaim" : "Watching"}
                </span>
              </span>
            )}
          </div>
          <span className="font-mono text-[10.5px] text-ink-tertiary">{chart?.cur_t_et ?? "Loading…"}</span>
        </div>
        <div ref={nqHostRef} className="w-full" />
      </div>

      {/* Synchronized ES SMT Chart */}
      {showSmt && (
        <div className="overflow-hidden rounded-xl border border-edge bg-app">
          <div className="flex items-center justify-between border-b border-edge px-3.5 py-1.5">
            <span className="text-[11.5px] font-medium text-ink-secondary">{chart?.contracts.es_name ?? "ESZ6"}</span>
            <span className="text-[10.5px] text-ink-tertiary">Synchronized SMT</span>
          </div>
          <div ref={esHostRef} className="w-full" />
        </div>
      )}

      {/* Clean Hairline Rejection Blocks List */}
      <div className="rounded-xl border border-edge bg-card">
        <div className="flex items-center justify-between border-b border-edge px-3.5 py-2.5">
          <span className="text-[12px] font-medium text-ink">Rejection Blocks</span>
          <span className="font-mono text-[11px] text-ink-tertiary">{okRbs.length} EL=OK</span>
        </div>
        {okRbs.length === 0 ? (
          <div className="px-3.5 py-4 text-center text-[12px] text-ink-tertiary">
            No EL=OK rejection blocks near price
          </div>
        ) : (
          <div className="divide-y divide-edge">
            {okRbs.slice(0, 6).map((rb) => (
              <div
                key={rb.id}
                className="flex items-center justify-between px-3.5 py-2 text-[12px] transition hover:bg-raised/40"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`size-1.5 rounded-full ${rb.side === "long" ? "bg-success" : "bg-danger"}`}
                  />
                  <span className="font-mono text-[11px] text-ink-secondary">{rb.tf}m</span>
                  <span className="font-mono text-[12px] font-medium text-ink">{rb.ce.toFixed(2)}</span>
                  {rb.big && (
                    <span className="rounded-md bg-inset px-1.5 py-0.5 font-mono text-[10px] text-ink-tertiary">
                      {rb.wick}pt
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px] text-ink-tertiary">
                  <span>0.62 {rb.fib62.toFixed(1)}</span>
                  <span className={rb.status === "UNTAPPED" ? "text-ink-secondary" : "text-warning"}>
                    {rb.status === "UNTAPPED" ? "Untapped" : "Tapped"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
