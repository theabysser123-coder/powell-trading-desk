import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { RefreshCw, Scan } from "lucide-react";
import type { LwcCandle, TradingChartData, TradingOpenOrder, TradingPosition } from "./types.ts";

interface Props {
  chart: TradingChartData | null;
  loading: boolean;
  tf: number;
  onTfChange: (tf: number) => void;
  onRefresh: () => void;
  positions: TradingPosition[];
  openOrders?: TradingOpenOrder[];
}

const NQ_HEIGHT_KEY = "omb-trading-nq-height";
const ES_HEIGHT_KEY = "omb-trading-es-height";
const NQ_DEFAULT_HEIGHT = 336;
const ES_DEFAULT_HEIGHT = 156;

const CHART_BG = "#101012";
const BULL = "#26c485";
const BULL_WICK = "rgba(38, 196, 133, 0.7)";
const BEAR = "#e54d5d";
const BEAR_WICK = "rgba(229, 77, 93, 0.7)";

function readStoredHeight(key: string, min: number, max: number, fallback: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    if (Number.isFinite(n) && n >= min && n <= max) return Math.round(n);
  } catch {
    // ignore storage failures
  }
  return fallback;
}

function saveStoredHeight(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // ignore storage failures
  }
}

function formatOhlcHtml(c: LwcCandle): string {
  const diff = c.close - c.open;
  const up = diff >= 0;
  const tone = up ? "#26c485" : "#e54d5d";
  const sign = up ? "+" : "";
  return (
    `<span style="color:#6e6e73">O</span> <span>${c.open.toFixed(2)}</span>` +
    `<span style="color:#6e6e73;margin-left:8px">H</span> <span>${c.high.toFixed(2)}</span>` +
    `<span style="color:#6e6e73;margin-left:8px">L</span> <span>${c.low.toFixed(2)}</span>` +
    `<span style="color:#6e6e73;margin-left:8px">C</span> <span style="color:${tone}">${c.close.toFixed(2)}</span>` +
    `<span style="color:${tone};margin-left:8px">${sign}${diff.toFixed(2)}</span>`
  );
}

const CORE_LEVELS: Array<{ key: string; label: string; color: string; style: LineStyle; axis: boolean }> = [
  { key: "10:00 Open", label: "10:00 KO", color: "rgba(226, 179, 76, 0.65)", style: LineStyle.Solid, axis: true },
  { key: "00:00 MO", label: "00:00 MO", color: "rgba(212, 212, 216, 0.34)", style: LineStyle.Dashed, axis: false },
  { key: "PDH", label: "PDH", color: "rgba(255, 255, 255, 0.16)", style: LineStyle.Dotted, axis: false },
  { key: "PDL", label: "PDL", color: "rgba(255, 255, 255, 0.16)", style: LineStyle.Dotted, axis: false },
];

const EXTRA_LEVELS: Array<{ key: string; label: string; color: string; style: LineStyle; axis: boolean }> = [
  { key: "09:30 Open", label: "09:30", color: "rgba(161, 161, 170, 0.28)", style: LineStyle.Dotted, axis: false },
  { key: "London H", label: "Lon H", color: "rgba(125, 185, 255, 0.34)", style: LineStyle.Dotted, axis: false },
  { key: "London L", label: "Lon L", color: "rgba(125, 185, 255, 0.34)", style: LineStyle.Dotted, axis: false },
  { key: "Data H", label: "Data H", color: "rgba(245, 158, 11, 0.36)", style: LineStyle.SparseDotted, axis: false },
  { key: "Data L", label: "Data L", color: "rgba(245, 158, 11, 0.36)", style: LineStyle.SparseDotted, axis: false },
];

export function TradingChartTab({ chart, loading, tf, onTfChange, onRefresh, positions, openOrders = [] }: Props) {
  const nqHostRef = useRef<HTMLDivElement | null>(null);
  const esHostRef = useRef<HTMLDivElement | null>(null);
  const nqLegendRef = useRef<HTMLDivElement | null>(null);
  const esLegendRef = useRef<HTMLDivElement | null>(null);
  const nqApiRef = useRef<IChartApi | null>(null);
  const esApiRef = useRef<IChartApi | null>(null);

  const [showLevels, setShowLevels] = useState(true);
  const [showAllLevels, setShowAllLevels] = useState(false);
  const [showRbs, setShowRbs] = useState(false);
  const [showSmt, setShowSmt] = useState(true);
  const [showTrades, setShowTrades] = useState(true);
  const [fittedAll, setFittedAll] = useState(false);
  const [nqHeight, setNqHeight] = useState<number>(() => readStoredHeight(NQ_HEIGHT_KEY, 180, 760, NQ_DEFAULT_HEIGHT));
  const [esHeight, setEsHeight] = useState<number>(() => readStoredHeight(ES_HEIGHT_KEY, 96, 420, ES_DEFAULT_HEIGHT));
  const [resizingChart, setResizingChart] = useState<"nq" | "es" | null>(null);
  const chartDragRef = useRef<{ target: "nq" | "es"; startY: number; startH: number; latestH: number } | null>(null);

  useEffect(() => {
    if (!resizingChart) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [resizingChart]);

  const startChartResize = (target: "nq" | "es") => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startH = target === "nq" ? nqHeight : esHeight;
    chartDragRef.current = { target, startY: e.clientY, startH, latestH: startH };
    setResizingChart(target);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveChartResize = (e: PointerEvent<HTMLDivElement>) => {
    const drag = chartDragRef.current;
    if (!drag) return;
    const [min, max] = drag.target === "nq" ? [180, 760] : [96, 420];
    const next = Math.max(min, Math.min(max, Math.round(drag.startH + (e.clientY - drag.startY))));
    drag.latestH = next;
    if (drag.target === "nq") setNqHeight(next);
    else setEsHeight(next);
  };

  const endChartResize = (e: PointerEvent<HTMLDivElement>) => {
    const drag = chartDragRef.current;
    if (!drag) return;
    chartDragRef.current = null;
    setResizingChart(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    saveStoredHeight(drag.target === "nq" ? NQ_HEIGHT_KEY : ES_HEIGHT_KEY, drag.latestH);
  };

  const applyRecentRange = useCallback((api: IChartApi | null, count: number) => {
    if (!api || count === 0) return;
    const visibleBars = Math.min(count, 96);
    api.timeScale().setVisibleLogicalRange({
      from: Math.max(0, count - visibleBars),
      to: count + 6,
    });
  }, []);

  const handleToggleFit = () => {
    if (!chart) return;
    if (fittedAll) {
      applyRecentRange(nqApiRef.current, chart.nq_candles.length);
      applyRecentRange(esApiRef.current, chart.es_candles.length);
      setFittedAll(false);
    } else {
      nqApiRef.current?.timeScale().fitContent();
      esApiRef.current?.timeScale().fitContent();
      setFittedAll(true);
    }
  };

  useEffect(() => {
    if (!chart || !chart.nq_candles.length || !nqHostRef.current) return;

    const baseOpts = (el: HTMLDivElement, fallbackHeight: number, compact = false) => ({
      width: el.clientWidth,
      height: el.clientHeight || fallbackHeight,
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: "#7c7c82",
        fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
        fontSize: 10.5,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "rgba(255, 255, 255, 0.028)", style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(255, 255, 255, 0.18)",
          width: 1 as const,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#242428",
        },
        horzLine: {
          color: "rgba(255, 255, 255, 0.16)",
          width: 1 as const,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#242428",
        },
      },
      rightPriceScale: {
        borderVisible: false,
        ticksVisible: false,
        entireTextOnly: true,
        scaleMargins: compact ? { top: 0.14, bottom: 0.12 } : { top: 0.14, bottom: 0.10 },
      },
      timeScale: {
        borderVisible: false,
        ticksVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 7.5,
        minBarSpacing: 2.5,
        fixRightEdge: false,
      },
      kineticScroll: { mouse: true, touch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
    });

    const nqChart: IChartApi = createChart(nqHostRef.current, baseOpts(nqHostRef.current, NQ_DEFAULT_HEIGHT, false));
    nqApiRef.current = nqChart;

    const lastNqBar = chart.nq_candles[chart.nq_candles.length - 1];
    const nqLastUp = lastNqBar ? lastNqBar.close >= lastNqBar.open : true;

    const nqSeries = nqChart.addSeries(CandlestickSeries, {
      upColor: BULL,
      downColor: BEAR,
      borderUpColor: BULL,
      borderDownColor: BEAR,
      wickUpColor: BULL_WICK,
      wickDownColor: BEAR_WICK,
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dotted,
      priceLineColor: nqLastUp ? "rgba(38, 196, 133, 0.45)" : "rgba(229, 77, 93, 0.45)",
      lastValueVisible: true,
      priceFormat: { type: "price", precision: 2, minMove: 0.25 },
    });

    const nqData = chart.nq_candles.map((c) => ({ ...c, time: c.time as UTCTimestamp }));
    const nqByTime = new Map<number, LwcCandle>();
    for (const c of chart.nq_candles) nqByTime.set(c.time, c);
    nqSeries.setData(nqData);

    if (nqLegendRef.current && lastNqBar) {
      nqLegendRef.current.innerHTML = formatOhlcHtml(lastNqBar);
    }

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
            axisLabelVisible: spec.axis,
            title: spec.label,
          });
        }
      }
      if (showAllLevels && chart.nwog) {
        nqSeries.createPriceLine({
          price: chart.nwog.ce,
          color: "rgba(245, 158, 11, 0.38)",
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
          color: rb.side === "long" ? "rgba(38, 196, 133, 0.45)" : "rgba(229, 77, 93, 0.45)",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `${rb.tf}m RB`,
        });
      }
    }

    if (showTrades) {
      for (const pos of positions) {
        const lastPx = pos.last_price ?? lastNqBar?.close ?? pos.avg_price;
        const beArmed = pos.side === "long" ? lastPx >= pos.be_trigger : lastPx <= pos.be_trigger;
        const lock1rArmed = pos.side === "long" ? lastPx >= pos.lock_1r_trigger : lastPx <= pos.lock_1r_trigger;
        const pnlTag = `${pos.unrealized_usd >= 0 ? "+" : ""}$${pos.unrealized_usd.toFixed(0)}`;
        const entryColor = pos.unrealized_usd >= 0 ? "#26c485" : "#e54d5d";
        const sideLabel = pos.side === "long" ? "LONG" : "SHORT";
        nqSeries.createPriceLine({
          price: pos.avg_price,
          color: entryColor,
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${sideLabel} ${pos.size} · ${pnlTag}`,
        });
        nqSeries.createPriceLine({
          price: pos.sl_price,
          color: BEAR,
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "SL -18pt",
        });
        nqSeries.createPriceLine({
          price: pos.tp_price,
          color: BULL,
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "TP +45pt (2.5R)",
        });
        nqSeries.createPriceLine({
          price: pos.be_trigger,
          color: beArmed ? "#26c485" : "rgba(226, 179, 76, 0.72)",
          lineWidth: beArmed ? 2 : 1,
          lineStyle: beArmed ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: beArmed ? "BE+1 ARMED" : "BE+1 (+27)",
        });
        nqSeries.createPriceLine({
          price: pos.lock_1r_trigger,
          color: lock1rArmed ? "#38bdf8" : "rgba(125, 185, 255, 0.72)",
          lineWidth: lock1rArmed ? 2 : 1,
          lineStyle: lock1rArmed ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: true,
          title: lock1rArmed ? "+1R ARMED" : "+1R (+36)",
        });
      }

      if (positions.length === 0) {
        for (const ord of openOrders) {
          const entryPx = ord.limitPrice ?? ord.stopPrice;
          if (typeof entryPx !== "number" || entryPx <= 0) continue;
          const mult = ord.side === "long" ? 1 : -1;
          const label = ord.side === "long" ? "LIMIT LONG" : "LIMIT SHORT";
          nqSeries.createPriceLine({
            price: entryPx,
            color: "rgba(250, 204, 21, 0.9)",
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${label} ${ord.size}`,
          });
          nqSeries.createPriceLine({
            price: Number((entryPx - mult * 18).toFixed(2)),
            color: "rgba(229, 77, 93, 0.5)",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: "Plan SL",
          });
          nqSeries.createPriceLine({
            price: Number((entryPx + mult * 45).toFixed(2)),
            color: "rgba(38, 196, 133, 0.5)",
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: false,
            title: "Plan TP",
          });
        }
      }
    }

    applyRecentRange(nqChart, nqData.length);
    setFittedAll(false);

    let esChart: IChartApi | null = null;
    let esSeries: ISeriesApi<"Candlestick"> | null = null;
    const esByTime = new Map<number, LwcCandle>();
    const lastEsBar = chart.es_candles[chart.es_candles.length - 1];

    if (showSmt && esHostRef.current && chart.es_candles.length) {
      esChart = createChart(esHostRef.current, baseOpts(esHostRef.current, ES_DEFAULT_HEIGHT, true));
      esApiRef.current = esChart;
      const esLastUp = lastEsBar ? lastEsBar.close >= lastEsBar.open : true;

      esSeries = esChart.addSeries(CandlestickSeries, {
        upColor: BULL,
        downColor: BEAR,
        borderUpColor: BULL,
        borderDownColor: BEAR,
        wickUpColor: BULL_WICK,
        wickDownColor: BEAR_WICK,
        priceLineVisible: true,
        priceLineWidth: 1,
        priceLineStyle: LineStyle.Dotted,
        priceLineColor: esLastUp ? "rgba(38, 196, 133, 0.45)" : "rgba(229, 77, 93, 0.45)",
        lastValueVisible: true,
        priceFormat: { type: "price", precision: 2, minMove: 0.25 },
      });

      const esData = chart.es_candles.map((c) => ({ ...c, time: c.time as UTCTimestamp }));
      for (const c of chart.es_candles) esByTime.set(c.time, c);
      esSeries.setData(esData);
      applyRecentRange(esChart, esData.length);

      if (esLegendRef.current && lastEsBar) {
        esLegendRef.current.innerHTML = formatOhlcHtml(lastEsBar);
      }

      let syncingRange = false;
      nqChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRange || !range || !esChart) return;
        syncingRange = true;
        esChart.timeScale().setVisibleLogicalRange(range);
        syncingRange = false;
      });
      esChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncingRange || !range) return;
        syncingRange = true;
        nqChart.timeScale().setVisibleLogicalRange(range);
        syncingRange = false;
      });
    } else {
      esApiRef.current = null;
    }

    // Live 60fps OHLC legend + synchronized dual-chart crosshair for SMT inspection
    let syncingCrosshair = false;

    nqChart.subscribeCrosshairMove((param) => {
      const t = typeof param.time === "number" ? param.time : null;
      const bar = t !== null ? nqByTime.get(t) : lastNqBar;
      if (nqLegendRef.current && bar) {
        nqLegendRef.current.innerHTML = formatOhlcHtml(bar);
      }
      if (!esChart || !esSeries || syncingCrosshair) return;
      syncingCrosshair = true;
      if (t !== null) {
        const esBar = esByTime.get(t);
        if (esBar) {
          esChart.setCrosshairPosition(esBar.close, t as UTCTimestamp, esSeries);
          if (esLegendRef.current) esLegendRef.current.innerHTML = formatOhlcHtml(esBar);
        }
      } else {
        esChart.clearCrosshairPosition();
        if (esLegendRef.current && lastEsBar) esLegendRef.current.innerHTML = formatOhlcHtml(lastEsBar);
      }
      syncingCrosshair = false;
    });

    if (esChart) {
      esChart.subscribeCrosshairMove((param) => {
        const t = typeof param.time === "number" ? param.time : null;
        const esBar = t !== null ? esByTime.get(t) : lastEsBar;
        if (esLegendRef.current && esBar) {
          esLegendRef.current.innerHTML = formatOhlcHtml(esBar);
        }
        if (syncingCrosshair) return;
        syncingCrosshair = true;
        if (t !== null) {
          const nqBar = nqByTime.get(t);
          if (nqBar) {
            nqChart.setCrosshairPosition(nqBar.close, t as UTCTimestamp, nqSeries);
            if (nqLegendRef.current) nqLegendRef.current.innerHTML = formatOhlcHtml(nqBar);
          }
        } else {
          nqChart.clearCrosshairPosition();
          if (nqLegendRef.current && lastNqBar) nqLegendRef.current.innerHTML = formatOhlcHtml(lastNqBar);
        }
        syncingCrosshair = false;
      });
    }

    const ro = new ResizeObserver(() => {
      if (nqHostRef.current && nqHostRef.current.clientWidth > 0 && nqHostRef.current.clientHeight > 0) {
        nqChart.applyOptions({ width: nqHostRef.current.clientWidth, height: nqHostRef.current.clientHeight });
      }
      if (esChart && esHostRef.current && esHostRef.current.clientWidth > 0 && esHostRef.current.clientHeight > 0) {
        esChart.applyOptions({ width: esHostRef.current.clientWidth, height: esHostRef.current.clientHeight });
      }
    });
    ro.observe(nqHostRef.current);
    if (esHostRef.current) ro.observe(esHostRef.current);

    return () => {
      ro.disconnect();
      nqApiRef.current = null;
      esApiRef.current = null;
      nqChart.remove();
      esChart?.remove();
    };
  }, [chart, showLevels, showAllLevels, showRbs, showSmt, showTrades, positions, openOrders, applyRecentRange]);

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
            <button type="button" onClick={() => setShowTrades((v) => !v)} className={pillCls(showTrades)}>
              Trades
            </button>
          </div>
          <button
            type="button"
            onClick={handleToggleFit}
            className={`flex size-7 items-center justify-center rounded-full border border-edge transition ${
              fittedAll ? "bg-control text-ink" : "bg-inset text-ink-tertiary hover:bg-raised hover:text-ink"
            }`}
            title={fittedAll ? "Zoom to recent candles" : "Fit full session"}
          >
            <Scan size={12} />
          </button>
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
      <div className="overflow-hidden rounded-xl border border-edge bg-[#101012]">
        <div className="flex items-center justify-between border-b border-edge/60 px-3.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[12px] font-medium tracking-[-0.01em] text-ink">{chart?.contracts.mnq_name ?? "MNQZ6"}</span>
            <span className="font-mono text-[11px] text-ink-tertiary">{tf === 60 ? "1H" : `${tf}m`}</span>
            {ko && (
              <span className="ml-0.5 flex items-center gap-1.5 border-l border-edge pl-2.5 font-mono text-[11px] text-ink-secondary">
                <span>KO {ko.open.toFixed(2)}</span>
                <span className="text-ink-tertiary">·</span>
                <span className={ko.bull_reclaim ? "text-success" : ko.bear_reclaim ? "text-danger" : "text-ink-tertiary"}>
                  {ko.bull_reclaim ? "Bull reclaim" : ko.bear_reclaim ? "Bear reclaim" : "Watching"}
                </span>
              </span>
            )}
          </div>
          <span className="shrink-0 font-mono text-[10.5px] text-ink-tertiary">{chart?.cur_t_et ?? "Loading…"}</span>
        </div>

        <div className="relative">
          <div
            ref={nqLegendRef}
            className="pointer-events-none absolute top-2 left-3 z-10 rounded-md bg-[#101012]/80 px-2 py-0.5 font-mono text-[10.5px] text-ink-secondary backdrop-blur-[2px]"
          />
          <div ref={nqHostRef} style={{ height: nqHeight }} className={`w-full ${resizingChart ? "pointer-events-none" : ""}`} />
        </div>

        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize MNQ chart height"
          title="Drag to resize chart height · Double-click to reset"
          onPointerDown={startChartResize("nq")}
          onPointerMove={moveChartResize}
          onPointerUp={endChartResize}
          onPointerCancel={endChartResize}
          onDoubleClick={() => {
            setNqHeight(NQ_DEFAULT_HEIGHT);
            saveStoredHeight(NQ_HEIGHT_KEY, NQ_DEFAULT_HEIGHT);
          }}
          className="group flex h-2.5 cursor-row-resize touch-none items-center justify-center border-t border-edge/40 bg-[#101012] transition hover:bg-raised/35"
        >
          <span
            className={`h-[2px] w-8 rounded-full transition-colors ${
              resizingChart === "nq" ? "bg-ink-secondary/70" : "bg-edge/80 group-hover:bg-ink-tertiary/60"
            }`}
          />
        </div>
      </div>

      {/* Synchronized ES SMT Chart */}
      {showSmt && (
        <div className="overflow-hidden rounded-xl border border-edge bg-[#101012]">
          <div className="flex items-center justify-between border-b border-edge/60 px-3.5 py-1.5">
            <span className="text-[11.5px] font-medium tracking-[-0.01em] text-ink-secondary">{chart?.contracts.es_name ?? "ESZ6"}</span>
            <span className="text-[10.5px] text-ink-tertiary">Synchronized SMT</span>
          </div>
          <div className="relative">
            <div
              ref={esLegendRef}
              className="pointer-events-none absolute top-1.5 left-3 z-10 rounded-md bg-[#101012]/80 px-2 py-0.5 font-mono text-[10px] text-ink-secondary backdrop-blur-[2px]"
            />
            <div ref={esHostRef} style={{ height: esHeight }} className={`w-full ${resizingChart ? "pointer-events-none" : ""}`} />
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize ES SMT chart height"
            title="Drag to resize SMT height · Double-click to reset"
            onPointerDown={startChartResize("es")}
            onPointerMove={moveChartResize}
            onPointerUp={endChartResize}
            onPointerCancel={endChartResize}
            onDoubleClick={() => {
              setEsHeight(ES_DEFAULT_HEIGHT);
              saveStoredHeight(ES_HEIGHT_KEY, ES_DEFAULT_HEIGHT);
            }}
            className="group flex h-2.5 cursor-row-resize touch-none items-center justify-center border-t border-edge/40 bg-[#101012] transition hover:bg-raised/35"
          >
            <span
              className={`h-[2px] w-8 rounded-full transition-colors ${
                resizingChart === "es" ? "bg-ink-secondary/70" : "bg-edge/80 group-hover:bg-ink-tertiary/60"
              }`}
            />
          </div>
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
