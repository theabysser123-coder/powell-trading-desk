import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, CandlestickChart } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  detectDeskAlerts,
  isDeskAlertsMuted,
  playDeskAlertChime,
  setDeskAlertsMuted,
  snapshotTradingAlertState,
  type DeskAlertSnapshot,
} from "@/lib/desk-alerts";
import { ELEVATED_FLOAT, ELEVATED_HOVER } from "@/components/elevated";
import type { TradingState } from "./types.ts";

interface Props {
  open: boolean;
  onToggle: () => void;
}

/** Compact live MNQ / position status pill beside the Desk button in the chat header, with optional audio chimes. */
export function DeskStatusPill({ open, onToggle }: Props) {
  const [state, setState] = useState<TradingState | null>(null);
  const [muted, setMuted] = useState<boolean>(isDeskAlertsMuted);
  const prevSnapRef = useRef<DeskAlertSnapshot | null>(null);
  const busyRef = useRef(false);

  const hasPosition = (state?.positions.length ?? 0) > 0;

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (busyRef.current || document.visibilityState === "hidden") return;
      busyRef.current = true;
      try {
        const res = await fetch("/api/trading/state");
        if (!res.ok || !active) return;
        const data = (await res.json()) as TradingState;
        if (!active || !data?.ok) return;
        setState(data);
        const snap = snapshotTradingAlertState(data);
        const alerts = detectDeskAlerts(prevSnapRef.current, snap);
        prevSnapRef.current = snap;
        for (const kind of alerts) playDeskAlertChime(kind);
      } catch {
        // silent when bridge is offline or in unit tests
      } finally {
        busyRef.current = false;
      }
    };
    void poll();
    const intervalMs = hasPosition ? 5_000 : 18_000;
    const id = window.setInterval(() => void poll(), intervalMs);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [hasPosition]);

  const primaryPos = state?.positions[0] ?? null;
  const lastNq = state?.market.last_nq ?? null;
  const regime = state?.market.volatility.regime;

  let liveBadge: { text: string; tone: string } | null = null;
  if (primaryPos) {
    const px = primaryPos.last_price ?? lastNq ?? primaryPos.avg_price;
    const lock1r = primaryPos.side === "long" ? px >= primaryPos.lock_1r_trigger : px <= primaryPos.lock_1r_trigger;
    const be = primaryPos.side === "long" ? px >= primaryPos.be_trigger : px <= primaryPos.be_trigger;
    const ladder = lock1r ? " · +1R" : be ? " · BE+1" : "";
    const pnl = `${primaryPos.unrealized_usd >= 0 ? "+" : ""}$${primaryPos.unrealized_usd.toFixed(0)}`;
    liveBadge = {
      text: `${primaryPos.side === "long" ? "L" : "S"} ${primaryPos.size} ${pnl}${ladder}`,
      tone: primaryPos.unrealized_usd >= 0 ? "text-emerald-300" : "text-rose-300",
    };
  } else if (lastNq !== null) {
    const restingCount = state?.open_orders.length ?? 0;
    liveBadge = {
      text: restingCount > 0 ? `MNQ ${lastNq.toFixed(0)} · ${restingCount} LMT` : `MNQ ${lastNq.toFixed(0)}`,
      tone: regime === "CRASH" ? "text-rose-300" : "text-ink-tertiary",
    };
  }

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setDeskAlertsMuted(next);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-desk-status-pill
        onClick={onToggle}
        className={cn(
          "relative flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium",
          ELEVATED_FLOAT,
          ELEVATED_HOVER,
          open ? "text-ink" : "text-ink-secondary hover:text-ink",
        )}
        title={
          primaryPos
            ? `Open Trading Desk (${primaryPos.side.toUpperCase()} ${primaryPos.size} MNQ @ ${primaryPos.avg_price.toFixed(2)})`
            : "Toggle Trading Desk"
        }
        aria-label="Toggle Trading Desk"
      >
        <CandlestickChart size={15} className={primaryPos ? "text-emerald-400" : undefined} />
        <span className="@max-4xl/chathead:hidden">Desk</span>
        {liveBadge && (
          <span className={cn("hidden font-mono text-[11px] xl:inline", liveBadge.tone)}>
            {liveBadge.text}
          </span>
        )}
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            primaryPos ? "animate-pulse bg-emerald-400" : state?.broker_connected === false ? "bg-rose-400" : "bg-success",
          )}
        />
      </button>
      <button
        type="button"
        data-desk-alerts-toggle
        onClick={toggleMute}
        className={cn(
          "hidden size-9 items-center justify-center rounded-full lg:flex",
          ELEVATED_FLOAT,
          ELEVATED_HOVER,
          muted ? "text-ink-tertiary hover:text-ink" : "text-ink-secondary hover:text-ink",
        )}
        title={muted ? "Desk fill & Defense Ladder chimes muted (click to enable)" : "Desk fill & Defense Ladder chimes active (click to mute)"}
        aria-label={muted ? "Unmute desk trade chimes" : "Mute desk trade chimes"}
      >
        {muted ? <BellOff size={14} /> : <Bell size={14} />}
      </button>
    </div>
  );
}
