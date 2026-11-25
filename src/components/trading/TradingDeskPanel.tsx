import { useCallback, useEffect, useState } from "react";
import { Activity, BookOpen, CandlestickChart, Maximize2, Minimize2, Shield, X } from "lucide-react";
import { useStore } from "@/state/store";
import { TradingChartTab } from "./TradingChartTab.tsx";
import { TradingHudTab } from "./TradingHudTab.tsx";
import { TradingJournalTab } from "./TradingJournalTab.tsx";
import type { TradingChartData, TradingJournalsData, TradingState } from "./types.ts";

type DeskTab = "chart" | "hud" | "journals";

export function TradingDeskPanel() {
  const { dispatch } = useStore();
  const [tab, setTab] = useState<DeskTab>("chart");
  const [wide, setWide] = useState(false);
  const [tf, setTf] = useState<number>(5);
  const [tradingState, setTradingState] = useState<TradingState | null>(null);
  const [chartData, setChartData] = useState<TradingChartData | null>(null);
  const [journalsData, setJournalsData] = useState<TradingJournalsData | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const fetchState = useCallback(async (force = false) => {
    try {
      const r = await fetch(`/api/trading/state${force ? "?refresh=1" : ""}`);
      if (r.ok) setTradingState((await r.json()) as TradingState);
    } catch {
      // keep last known snapshot
    }
  }, []);

  const fetchChart = useCallback(async (targetTf: number, force = false) => {
    setLoadingChart(true);
    try {
      const r = await fetch(`/api/trading/chart?tf=${targetTf}&bars=180${force ? "&refresh=1" : ""}`);
      if (r.ok) setChartData((await r.json()) as TradingChartData);
    } catch {
      // keep last known chart
    } finally {
      setLoadingChart(false);
    }
  }, []);

  const fetchJournals = useCallback(async () => {
    try {
      const r = await fetch("/api/trading/journals");
      if (r.ok) setJournalsData((await r.json()) as TradingJournalsData);
    } catch {
      // keep last known journals
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
      setBanner(d.ok ? `Flattened cleanly (cancelled ${d.cancelled_orders ?? 0} orders).` : `Flatten error: ${d.error}`);
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
      if (r.ok) {
        await fetchState(true);
      }
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
      setBanner(d.ok ? `Approval ${id}: ${action === "approve" ? "EXECUTED on TopstepX" : "rejected"}.` : `Error: ${d.error}`);
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
          setup: "Demo Practice Approval Card",
          reason: "Far-away practice limit (-150pt) to preview 1-click Approval Card flow.",
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
      data-look="trading-desk"
      className={`flex h-full shrink-0 flex-col border-l border-hairline/40 bg-panel transition-all ${
        wide ? "w-[min(860px,64vw)]" : "w-[min(540px,46vw)]"
      }`}
    >
      {/* Top Header Strip */}
      <div className="flex items-center justify-between border-b border-hairline/40 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${tradingState?.broker_connected ? "bg-emerald-400" : "bg-rose-400"}`} />
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <span>Powell v7 Trading Desk</span>
              {volRegime && (
                <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                  volRegime === "CRASH" ? "bg-rose-500/20 text-rose-300"
                    : volRegime === "ELEVATED" ? "bg-amber-400/20 text-amber-300"
                      : "bg-emerald-500/20 text-emerald-300"
                }`}>
                  {volRegime}
                </span>
              )}
            </div>
            <div className="font-mono text-[10px] text-ink-secondary">
              {tradingState?.market.mnq_contract ?? "MNQZ6"} {tradingState?.market.last_nq?.toFixed(2) ?? "—"} ·{" "}
              {tradingState ? `$${tradingState.account.balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "Syncing..."}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWide((w) => !w)}
            className="flex size-7 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
            title={wide ? "Compact width" : "Expand Trading Desk"}
          >
            {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleTradingDesk", open: false })}
            className="flex size-7 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink"
            title="Close Trading Desk"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Tab Strip */}
      <div className="grid grid-cols-3 gap-1 border-b border-hairline/30 bg-inset/50 p-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => setTab("chart")}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition ${
            tab === "chart" ? "bg-card text-ink shadow-sm" : "text-ink-secondary hover:text-ink"
          }`}
        >
          <CandlestickChart size={13} /> Live Chart
        </button>
        <button
          type="button"
          onClick={() => setTab("hud")}
          className={`relative flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition ${
            tab === "hud" ? "bg-card text-ink shadow-sm" : "text-ink-secondary hover:text-ink"
          }`}
        >
          <Shield size={13} /> Risk HUD
          {pendingCount > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[9px] font-bold text-white">{pendingCount}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => { setTab("journals"); void fetchJournals(); }}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition ${
            tab === "journals" ? "bg-card text-ink shadow-sm" : "text-ink-secondary hover:text-ink"
          }`}
        >
          <BookOpen size={13} /> Journals
        </button>
      </div>

      {banner && (
        <div className="flex items-center justify-between border-b border-hairline/30 bg-accent/15 px-3 py-1.5 font-mono text-[11px] text-accent">
          <span className="flex items-center gap-1.5"><Activity size={12} /> {banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-ink-secondary hover:text-ink">×</button>
        </div>
      )}

      {/* Scrollable Active Tab Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
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
