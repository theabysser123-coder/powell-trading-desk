import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useStore } from "@/state/store";
import { TradingDeskCanvas } from "./TradingDeskCanvas.tsx";
import type { TradingChartData, TradingJournalsData, TradingState } from "./types.ts";

export function TradingDeskPanel() {
  const { dispatch } = useStore();
  const [tf, setTf] = useState<number>(5);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [tradingState, setTradingState] = useState<TradingState | null>(null);
  const [chartData, setChartData] = useState<TradingChartData | null>(null);
  const [journalsData, setJournalsData] = useState<TradingJournalsData | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const stateBusyRef = useRef(false);
  const chartBusyRef = useRef(false);

  const closeDesk = useCallback(() => {
    dispatch({ type: "toggleTradingDesk", open: false });
  }, [dispatch]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (chartExpanded) setChartExpanded(false);
      else closeDesk();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartExpanded, closeDesk]);

  const fetchState = useCallback(async (force = false) => {
    if (stateBusyRef.current && !force) return;
    stateBusyRef.current = true;
    try {
      const r = await fetch(`/api/trading/state${force ? "?refresh=1" : ""}`);
      if (r.ok) setTradingState((await r.json()) as TradingState);
    } catch {
      // keep last snapshot
    } finally {
      stateBusyRef.current = false;
    }
  }, []);

  const fetchChart = useCallback(async (targetTf: number, force = false, silent = false) => {
    if (chartBusyRef.current && !force) return;
    chartBusyRef.current = true;
    if (!silent) setLoadingChart(true);
    try {
      const r = await fetch(`/api/trading/chart?tf=${targetTf}&bars=180${force ? "&refresh=1" : ""}`);
      if (r.ok) setChartData((await r.json()) as TradingChartData);
    } catch {
      // keep last chart
    } finally {
      chartBusyRef.current = false;
      if (!silent) setLoadingChart(false);
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

  const hasOpenPosition = (tradingState?.positions.length ?? 0) > 0;

  useEffect(() => {
    void fetchState(false);
    void fetchJournals();
  }, [fetchState, fetchJournals]);

  useEffect(() => {
    void fetchChart(tf, false, false);
  }, [fetchChart, tf]);

  useEffect(() => {
    const stateIntervalMs = hasOpenPosition ? 5_000 : 12_000;
    const chartIntervalMs = hasOpenPosition ? 5_000 : 15_000;
    const stateId = window.setInterval(() => {
      void fetchState(false);
    }, stateIntervalMs);
    const chartId = window.setInterval(() => {
      void fetchChart(tf, false, true);
    }, chartIntervalMs);
    return () => {
      window.clearInterval(stateId);
      window.clearInterval(chartId);
    };
  }, [fetchState, fetchChart, tf, hasOpenPosition]);

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

  const volRegime = tradingState?.market.volatility.regime;

  return (
    <section
      data-look="trading-desk"
      aria-label="Trading Desk Canvas"
      className="fixed inset-0 z-40 flex flex-col bg-[#0d0d10] text-ink"
    >
      {/* Top Mission Control Bar */}
      <header className="flex items-center justify-between gap-4 border-b border-edge bg-panel/95 px-5 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${tradingState?.broker_connected ? "bg-success" : "bg-danger"}`} />
              <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Trading Desk</span>
              {volRegime && (
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                  volRegime === "CRASH" ? "bg-danger/15 text-danger" : volRegime === "ELEVATED" ? "bg-warning/15 text-warning" : "bg-inset text-ink-tertiary"
                }`}>
                  {volRegime === "CRASH" ? "High Vol" : volRegime === "ELEVATED" ? "Elevated" : "Normal"}
                </span>
              )}
              {hasOpenPosition && tradingState && (
                <span className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold ${
                  tradingState.account.unrealized_usd >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
                }`}>
                  {tradingState.positions.length} LIVE · {tradingState.account.unrealized_usd >= 0 ? "+" : ""}${tradingState.account.unrealized_usd.toFixed(0)}
                </span>
              )}
            </div>
            <div className="mt-0.5 pl-4 font-mono text-[11px] text-ink-tertiary">
              {tradingState?.market.mnq_contract ?? "MNQZ6"} {tradingState?.market.last_nq?.toFixed(2) ?? "—"} ·{" "}
              {tradingState ? `$${tradingState.account.balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "Syncing…"}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={closeDesk}
          className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-inset px-3 py-1.5 text-[12px] font-medium text-ink-secondary transition hover:bg-raised hover:text-ink"
          title="Close Trading Desk (Esc)"
        >
          <span>Back to chat</span>
          <X size={14} />
        </button>
      </header>

      {banner && (
        <div className="mx-5 mt-3 flex items-center justify-between rounded-xl border border-edge bg-card px-3.5 py-2 text-[12px] text-ink-secondary">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-ink-tertiary hover:text-ink">×</button>
        </div>
      )}

      {/* Full-Screen Live Desk Canvas */}
      <TradingDeskCanvas
        state={tradingState}
        chart={chartData}
        journals={journalsData}
        loadingChart={loadingChart}
        tf={tf}
        busyAction={busyAction}
        chartExpanded={chartExpanded}
        onToggleChartExpanded={() => setChartExpanded((v) => !v)}
        onTfChange={(nextTf) => {
          setTf(nextTf);
          void fetchChart(nextTf, false, false);
        }}
        onRefresh={() => {
          void fetchChart(tf, true, false);
          void fetchState(true);
          void fetchJournals();
        }}
        onFlatten={() => void handleFlatten()}
        onUpdateConfig={(patch) => void handleUpdateConfig(patch)}
        onDecideApproval={(id, action) => void handleDecideApproval(id, action)}
        onClose={closeDesk}
      />
    </section>
  );
}
