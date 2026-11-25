import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { useStore } from "@/state/store";
import { TradingChartTab } from "./TradingChartTab.tsx";
import { TradingHudTab } from "./TradingHudTab.tsx";
import { TradingJournalTab } from "./TradingJournalTab.tsx";
import type { TradingChartData, TradingJournalsData, TradingState } from "./types.ts";

type DeskTab = "chart" | "hud" | "journals";

const DESK_WIDTH_KEY = "omb-trading-desk-width";
const DESK_MIN_WIDTH = 360;
const DESK_DEFAULT_WIDTH = 540;
const CHAT_MIN_WIDTH = 300;
const KEYBOARD_STEP = 40;

function readStoredWidth(): number {
  try {
    const n = Number(localStorage.getItem(DESK_WIDTH_KEY));
    if (Number.isFinite(n) && n >= DESK_MIN_WIDTH) return Math.round(n);
  } catch {
    // ignore storage failures
  }
  return DESK_DEFAULT_WIDTH;
}

function saveStoredWidth(w: number) {
  try {
    localStorage.setItem(DESK_WIDTH_KEY, String(Math.round(w)));
  } catch {
    // ignore storage failures
  }
}

export function TradingDeskPanel() {
  const { dispatch } = useStore();
  const [tab, setTab] = useState<DeskTab>("chart");
  const [chosenWidth, setChosenWidth] = useState<number>(readStoredWidth);
  const [maxWidth, setMaxWidth] = useState<number>(1100);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number; latestWidth: number } | null>(null);
  const restoreWidthRef = useRef<number>(DESK_DEFAULT_WIDTH);
  const [tf, setTf] = useState<number>(5);
  const [tradingState, setTradingState] = useState<TradingState | null>(null);
  const [chartData, setChartData] = useState<TradingChartData | null>(null);
  const [journalsData, setJournalsData] = useState<TradingJournalsData | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const panelWidth = Math.max(DESK_MIN_WIDTH, Math.min(chosenWidth, maxWidth));
  const isMaximized = maxWidth - panelWidth <= 24 && maxWidth > DESK_DEFAULT_WIDTH + 60;

  useLayoutEffect(() => {
    const panel = asideRef.current;
    const row = panel?.parentElement;
    if (!panel || !row) return;

    const measure = () => {
      const chat = row.querySelector<HTMLElement>(":scope > main");
      if (chat && panel.offsetWidth > 0) {
        const available = panel.offsetWidth + chat.offsetWidth - CHAT_MIN_WIDTH;
        setMaxWidth(Math.max(DESK_MIN_WIDTH, Math.floor(available)));
      } else {
        setMaxWidth(Math.max(DESK_MIN_WIDTH, Math.floor(window.innerWidth * 0.78)));
      }
    };

    const ro = new ResizeObserver(measure);
    ro.observe(row);
    const mo = new MutationObserver(measure);
    mo.observe(row, { childList: true });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  const clampWidth = useCallback(
    (w: number) => Math.max(DESK_MIN_WIDTH, Math.min(maxWidth, Math.round(w))),
    [maxWidth],
  );

  const onResizeStart = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth, latestWidth: panelWidth };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizeMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const next = clampWidth(dragRef.current.startWidth + (dragRef.current.startX - e.clientX));
    dragRef.current.latestWidth = next;
    setChosenWidth(next);
  };

  const onResizeEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const finalWidth = dragRef.current.latestWidth;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    saveStoredWidth(finalWidth);
  };

  const onResizeDoubleClick = () => {
    const next = clampWidth(DESK_DEFAULT_WIDTH);
    setChosenWidth(next);
    saveStoredWidth(next);
  };

  const onResizeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowLeft" ? KEYBOARD_STEP : -KEYBOARD_STEP;
    const next = clampWidth(panelWidth + delta);
    setChosenWidth(next);
    saveStoredWidth(next);
  };

  const toggleMaximize = () => {
    if (isMaximized) {
      const target = clampWidth(restoreWidthRef.current);
      setChosenWidth(target);
      saveStoredWidth(target);
    } else {
      restoreWidthRef.current = panelWidth;
      setChosenWidth(maxWidth);
      saveStoredWidth(maxWidth);
    }
  };

  const fetchState = useCallback(async (force = false) => {
    try {
      const r = await fetch(`/api/trading/state${force ? "?refresh=1" : ""}`);
      if (r.ok) setTradingState((await r.json()) as TradingState);
    } catch {
      // keep last snapshot
    }
  }, []);

  const fetchChart = useCallback(async (targetTf: number, force = false) => {
    setLoadingChart(true);
    try {
      const r = await fetch(`/api/trading/chart?tf=${targetTf}&bars=180${force ? "&refresh=1" : ""}`);
      if (r.ok) setChartData((await r.json()) as TradingChartData);
    } catch {
      // keep last chart
    } finally {
      setLoadingChart(false);
    }
  }, []);

  const fetchJournals = useCallback(async () => {
    try {
      const r = await fetch("/api/trading/journals");
      if (r.ok) setJournalsData((await r.json()) as TradingJournalsData);
    } catch {
      // keep last journals
    }
  }, []);

  useEffect(() => {
    void fetchState(false);
    void fetchChart(tf, false);
    void fetchJournals();
    const id = window.setInterval(() => {
      void fetchState(false);
    }, 12_000);
    return () => window.clearInterval(id);
  }, [fetchState, fetchChart, fetchJournals, tf]);

  const handleFlatten = async () => {
    setBusyAction("flatten");
    setBanner(null);
    try {
      const r = await fetch("/api/trading/flatten", { method: "POST" });
      const d = (await r.json()) as { ok?: boolean; cancelled_orders?: number; error?: string };
      setBanner(d.ok ? `Flattened cleanly (${d.cancelled_orders ?? 0} orders cancelled).` : `Flatten error: ${d.error}`);
      await fetchState(true);
    } finally {
      setBusyAction(null);
    }
  };

  const handleUpdateConfig = async (patch: { execution_mode?: "auto" | "approve"; topstep_mode?: "practice" | "live"; base_risk?: number }) => {
    setBusyAction("config");
    setBanner(null);
    try {
      const r = await fetch("/api/trading/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (r.ok) await fetchState(true);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDecideApproval = async (id: string, action: "approve" | "reject") => {
    setBusyAction(id);
    setBanner(null);
    try {
      const r = await fetch(`/api/trading/approvals/${id}/${action}`, { method: "POST" });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      setBanner(d.ok ? `Approval ${id}: ${action === "approve" ? "executed on TopstepX" : "rejected"}.` : `Error: ${d.error}`);
      await fetchState(true);
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestProposal = async () => {
    const px = tradingState?.market.last_nq ?? 25500;
    setBusyAction("propose");
    try {
      await fetch("/api/trading/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          side: "long",
          type: "limit",
          price: Math.round((px - 150) * 4) / 4,
          attempt: 1,
          entry_type: "ko_10am",
          setup: "Practice Demo Card",
          reason: "Far-away practice limit (-150pt) to preview 1-click approval.",
        }),
      });
      await fetchState(true);
    } finally {
      setBusyAction(null);
    }
  };

  const pendingCount = tradingState?.approvals.length ?? 0;
  const volRegime = tradingState?.market.volatility.regime;

  return (
    <aside
      ref={asideRef}
      data-look="trading-desk"
      style={{ width: panelWidth }}
      className="relative flex h-full shrink-0 flex-col border-l border-edge bg-panel max-md:w-full!"
    >
      {/* Drag-to-resize handle on the left edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Trading Desk"
        aria-valuemin={DESK_MIN_WIDTH}
        aria-valuemax={maxWidth}
        aria-valuenow={panelWidth}
        tabIndex={0}
        title="Drag to resize · Double-click to reset"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={onResizeDoubleClick}
        onKeyDown={onResizeKeyDown}
        className="group absolute inset-y-0 -left-1 z-20 flex w-2.5 cursor-col-resize touch-none items-center justify-center outline-none max-md:hidden"
      >
        <div
          className={`h-full w-[2px] transition-colors ${
            dragging
              ? "bg-ink-secondary/70"
              : "bg-transparent group-hover:bg-ink-tertiary/45 group-focus-visible:bg-ink-secondary/60"
          }`}
        />
      </div>

      {/* Native-Style Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`size-1.5 rounded-full ${tradingState?.broker_connected ? "bg-success" : "bg-danger"}`} />
            <span className="text-[13.5px] font-medium tracking-[-0.01em] text-ink">Trading Desk</span>
            {volRegime && (
              <span className={`text-[11px] font-medium ${
                volRegime === "CRASH" ? "text-danger" : volRegime === "ELEVATED" ? "text-warning" : "text-ink-tertiary"
              }`}>
                · {volRegime === "CRASH" ? "High Vol" : volRegime === "ELEVATED" ? "Elevated" : "Normal"}
              </span>
            )}
          </div>
          <div className="mt-0.5 pl-3.5 font-mono text-[11px] text-ink-tertiary">
            {tradingState?.market.mnq_contract ?? "MNQZ6"} {tradingState?.market.last_nq?.toFixed(2) ?? "—"} ·{" "}
            {tradingState ? `$${tradingState.account.balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "Syncing…"}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleMaximize}
            className="flex size-8 items-center justify-center rounded-full text-ink-tertiary transition hover:bg-raised hover:text-ink"
            title={isMaximized ? "Restore width" : "Expand Trading Desk"}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleTradingDesk", open: false })}
            className="flex size-8 items-center justify-center rounded-full text-ink-tertiary transition hover:bg-raised hover:text-ink"
            title="Close Trading Desk"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Rounded-Full Native Segmented Control */}
      <div className="px-4 pb-3">
        <div className="grid grid-cols-3 rounded-full border border-edge bg-inset p-0.5 text-[12px]">
          <button
            type="button"
            onClick={() => setTab("chart")}
            className={`rounded-full py-1.5 font-medium transition ${
              tab === "chart" ? "bg-control text-ink" : "text-ink-tertiary hover:text-ink-secondary"
            }`}
          >
            Chart
          </button>
          <button
            type="button"
            onClick={() => setTab("hud")}
            className={`flex items-center justify-center gap-1.5 rounded-full py-1.5 font-medium transition ${
              tab === "hud" ? "bg-control text-ink" : "text-ink-tertiary hover:text-ink-secondary"
            }`}
          >
            Risk
            {pendingCount > 0 && (
              <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-ink">{pendingCount}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => { setTab("journals"); void fetchJournals(); }}
            className={`rounded-full py-1.5 font-medium transition ${
              tab === "journals" ? "bg-control text-ink" : "text-ink-tertiary hover:text-ink-secondary"
            }`}
          >
            Journal
          </button>
        </div>
      </div>

      {banner && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-lg border border-edge bg-card px-3 py-2 text-[11.5px] text-ink-secondary">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-ink-tertiary hover:text-ink">×</button>
        </div>
      )}

      {/* Scrollable Body */}
      <div className={`min-h-0 flex-1 overflow-y-auto border-t border-edge ${dragging ? "pointer-events-none" : ""}`}>
        {tab === "chart" && (
          <TradingChartTab
            chart={chartData}
            loading={loadingChart}
            tf={tf}
            onTfChange={(nextTf) => {
              setTf(nextTf);
              void fetchChart(nextTf, false);
            }}
            onRefresh={() => {
              void fetchChart(tf, true);
              void fetchState(true);
            }}
            positions={tradingState?.positions ?? []}
          />
        )}
        {tab === "hud" && (
          <TradingHudTab
            state={tradingState}
            busyAction={busyAction}
            onFlatten={handleFlatten}
            onUpdateConfig={handleUpdateConfig}
            onDecideApproval={handleDecideApproval}
            onTestProposal={handleTestProposal}
          />
        )}
        {tab === "journals" && <TradingJournalTab data={journalsData} />}
      </div>
    </aside>
  );
}
