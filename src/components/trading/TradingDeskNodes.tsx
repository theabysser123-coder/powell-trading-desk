import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crown,
  Lock,
  MessageCircle,
  Newspaper,
  Shield,
  ShieldAlert,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { activityPreview, botEngine } from "@/lib/failed-turn";
import { computerStepLine } from "@/lib/computer-step";
import type { Bot, useStore } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { CombineRoadmapPanel, MultiAccountStrip } from "./TradingDeskRoadmap.tsx";
import type { MorningPlan, TradingJournalsData, TradingState } from "./types.ts";

export type DeskNodeId =
  | "bot:chief"
  | "bot:risk"
  | "bot:trader"
  | "bot:journal"
  | "mod:risk"
  | "mod:news"
  | "mod:chart"
  | "mod:journal";

type StoreInstances = ReturnType<typeof useStore>["state"]["instances"];

function currentBotStep(bot: Bot | undefined, instances: StoreInstances): string | undefined {
  if (!bot?.busy) return undefined;
  const open = bot.tasks?.find((task) => task.threadId === bot.threadId);
  const last = !open || open.busy ? bot.messages.findLast((message) => message.kind === "activity" && message.tool) : undefined;
  if (last?.tool) return computerStepLine(last.tool) ?? activityPreview(last.tool, botEngine(bot, instances), last.dataResult);
  return bot.tasks?.find((task) => task.busy && task.threadId !== bot.threadId && task.title.trim())?.title;
}

export function BotDeskNode({
  id,
  bot,
  fallbackName,
  fallbackRole,
  schedule,
  accent,
  instances,
  style,
  highlighted,
  onDragStart,
  onHover,
  onChat,
}: {
  id: DeskNodeId;
  bot: Bot | undefined;
  fallbackName: string;
  fallbackRole: string;
  schedule: string;
  accent: string;
  instances: StoreInstances;
  style: CSSProperties;
  highlighted: boolean;
  onDragStart: (e: ReactPointerEvent<HTMLElement>) => void;
  onHover: (id: DeskNodeId | null) => void;
  onChat: () => void;
}) {
  const liveStep = currentBotStep(bot, instances);
  const instance = bot ? instances.find((i) => i.instanceId === bot.modelSelection.instanceId) : undefined;
  const model = bot ? (instance?.models.options.find((o) => o.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model) : "Gemini 4 Neon";

  return (
    <article
      data-desk-node={id}
      style={style}
      onPointerDown={onDragStart}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "absolute flex cursor-grab flex-col justify-between rounded-2xl border bg-[#16161c]/95 p-3.5 shadow-xl backdrop-blur-md active:cursor-grabbing",
        highlighted ? accent : "border-hairline/55 hover:border-ink-secondary/45",
      )}
    >
      <div className="flex items-center gap-2.5">
        {bot ? (
          <BotAvatar bot={bot} size={36} motion="none" motionKey={0} animated={false} />
        ) : (
          <div className="flex size-9 items-center justify-center rounded-full bg-inset text-[12px] font-bold text-ink">
            {fallbackName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-ink">{bot?.name ?? fallbackName}</span>
            {bot?.chiefOfStaff && <Crown size={12} className="shrink-0 text-amber-400" />}
          </div>
          <div className="truncate text-[11px] text-ink-secondary">{bot?.title || fallbackRole}</div>
        </div>
        {bot && (
          <button
            type="button"
            onClick={onChat}
            title={`Open chat with ${bot.name}`}
            aria-label={`Open chat with ${bot.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink"
          >
            <MessageCircle size={13} />
          </button>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-hairline/30 pt-2 text-[10.5px]">
        <span className="flex min-w-0 items-center gap-1.5 text-ink-secondary">
          <span className={cn("size-2 shrink-0 rounded-full", bot?.busy ? "animate-pulse bg-emerald-400" : "bg-emerald-500/65")} />
          <span className="truncate">{liveStep ?? schedule}</span>
        </span>
        <span className="shrink-0 rounded-md bg-inset px-1.5 py-0.5 text-[10px] text-ink-tertiary">{model}</span>
      </div>
    </article>
  );
}

export function MorningPlanStrip({
  plan,
  dayLocked,
  lockReason,
  expanded = false,
}: {
  plan: MorningPlan | null;
  dayLocked: boolean;
  lockReason: string | null;
  expanded?: boolean;
}) {
  if (!plan && !dayLocked) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center border-b border-hairline/30 bg-inset/60 py-1.5",
        expanded ? "gap-x-4 gap-y-1 px-4 text-[11.5px]" : "gap-x-3 gap-y-1 px-3.5 text-[11px]",
      )}
    >
      {plan && (
        <>
          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
            <Compass size={expanded ? 12 : 11} className="text-emerald-400" />
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                /bull|long/i.test(plan.bias)
                  ? "bg-emerald-500/15 text-emerald-300"
                  : /bear|short/i.test(plan.bias)
                    ? "bg-rose-500/15 text-rose-300"
                    : "bg-control text-ink-secondary",
              )}
            >
              {plan.bias}
            </span>
          </span>
          {plan.dol && (
            <span className={cn("text-ink-secondary", !expanded && "truncate")}>
              <span className="text-ink-tertiary">DOL </span>
              <span className="font-mono text-ink">{plan.dol}</span>
            </span>
          )}
          {expanded && plan.levels && (
            <span className="text-ink-secondary">
              <span className="text-ink-tertiary">Levels </span>
              <span className="font-mono text-ink">{plan.levels}</span>
            </span>
          )}
          {plan.invalidation && (
            <span className={cn("text-ink-secondary", !expanded && "truncate")}>
              <span className="text-ink-tertiary">Inv </span>
              <span className="font-mono text-ink">{plan.invalidation}</span>
            </span>
          )}
        </>
      )}
      {dayLocked && (
        <span className="ml-auto inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
          <Lock size={10} />
          {lockReason || "Day locked"}
        </span>
      )}
    </div>
  );
}

export function RiskModuleCard({
  trading,
  busyAction,
  style,
  highlighted,
  onDragStart,
  onHover,
  onFlatten,
  onUpdateConfig,
  onDecideApproval,
}: {
  trading: TradingState | null;
  busyAction: string | null;
  style: CSSProperties;
  highlighted: boolean;
  onDragStart: (e: ReactPointerEvent<HTMLElement>) => void;
  onHover: (id: DeskNodeId | null) => void;
  onFlatten: () => void;
  onUpdateConfig: (patch: { execution_mode?: "auto" | "approve"; topstep_mode?: "practice" | "live"; base_risk?: number }) => void;
  onDecideApproval: (id: string, action: "approve" | "reject") => void;
}) {
  const [confirmFlatten, setConfirmFlatten] = useState(false);

  useEffect(() => {
    if (!confirmFlatten) return;
    const id = window.setTimeout(() => setConfirmFlatten(false), 4_000);
    return () => window.clearTimeout(id);
  }, [confirmFlatten]);

  const acct = trading?.account;
  const openPositions = trading?.positions ?? [];
  const openOrders = trading?.open_orders ?? [];
  const pendingApprovals = trading?.approvals ?? [];

  return (
    <section
      data-desk-node="mod:risk"
      style={style}
      onMouseEnter={() => onHover("mod:risk")}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-2xl border bg-[#141418]/95 shadow-xl backdrop-blur-md",
        highlighted ? "border-amber-400/70" : "border-hairline/55",
      )}
    >
      <div
        onPointerDown={onDragStart}
        className="flex cursor-grab items-center justify-between border-b border-hairline/35 px-3.5 py-2.5 active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-amber-400" />
          <span className="text-[12.5px] font-semibold text-ink">TopstepX · $50K Risk</span>
        </div>
        <div className="flex items-center gap-1.5">
          {trading && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide",
                trading.account.is_practice ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300",
              )}
            >
              {trading.account.is_practice ? "Practice" : "Live $50K"}
            </span>
          )}
          {trading?.session.day_locked && (
            <span
              title={trading.session.lock_reason ?? "Day locked"}
              className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase text-rose-300"
            >
              <Lock size={9} />
              Locked
            </span>
          )}
          <span className={cn("size-2 rounded-full", trading?.broker_connected ? "bg-emerald-400" : "bg-rose-500")} />
        </div>
      </div>

      <div data-card-scroll className="flex flex-1 flex-col justify-between gap-2.5 overflow-y-auto p-3.5 text-[12px]">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[20px] font-semibold tracking-tight text-ink">
              {acct ? `$${acct.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Syncing…"}
            </span>
            <span className={cn("font-mono text-[12px] font-medium", (acct?.today_net ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {acct ? `${acct.today_net >= 0 ? "+" : ""}$${acct.today_net.toFixed(0)} today` : "—"}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-inset">
            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.max(2, Math.min(100, acct?.progress_pct ?? 0))}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10.5px] text-ink-tertiary">
            <span>Target +$3,000</span>
            <span>{(acct?.progress_pct ?? 0).toFixed(1)}%</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-hairline/35 bg-inset/70 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-tertiary">MLL Cushion</div>
            <div className="mt-0.5 font-mono text-[13px] font-semibold text-ink">
              {acct ? `$${acct.mll_cushion.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "$2,000"}
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-card">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  (acct?.mll_cushion ?? 2000) < 800 ? "bg-rose-400" : (acct?.mll_cushion ?? 2000) < 1300 ? "bg-amber-400" : "bg-emerald-400",
                )}
                style={{ width: `${Math.max(4, Math.min(100, ((acct?.mll_cushion ?? 2000) / 2000) * 100))}%` }}
              />
            </div>
          </div>
          <div className="rounded-xl border border-hairline/35 bg-inset/70 px-2.5 py-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-tertiary">Personal DLL</div>
            <div className="mt-0.5 font-mono text-[13px] font-semibold text-ink">
              {acct ? `$${acct.pdll_remaining.toFixed(0)}` : "$750"}
              <span className="text-[10px] font-normal text-ink-tertiary"> / 750</span>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-card">
              <div
                className={cn("h-full rounded-full transition-all", (acct?.pdll_remaining ?? 750) < 250 ? "bg-rose-400" : "bg-emerald-400")}
                style={{ width: `${Math.max(4, Math.min(100, ((acct?.pdll_remaining ?? 750) / 750) * 100))}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between font-mono text-[10.5px] text-ink-tertiary">
          <span>{trading ? `${openPositions.length} open · ${trading.session.attempts}/2 att` : "—"}</span>
          <span>{trading ? `${trading.desk.att1_mnq}/${trading.desk.att2_mnq} MNQ · 18→45pt` : "12/6 MNQ · 18→45pt"}</span>
        </div>

        <MultiAccountStrip multi={trading?.multi_account} />

        {openPositions.length > 0 && (
          <div className="space-y-1.5">
            {openPositions.map((pos) => {
              const lastPx = pos.last_price ?? trading?.market.last_nq ?? pos.avg_price;
              const beArmed = pos.side === "long" ? lastPx >= pos.be_trigger : lastPx <= pos.be_trigger;
              const lock1rArmed = pos.side === "long" ? lastPx >= pos.lock_1r_trigger : lastPx <= pos.lock_1r_trigger;
              return (
                <div key={String(pos.id)} className="rounded-xl border border-emerald-400/35 bg-emerald-500/8 p-2.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-mono font-semibold text-ink">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9.5px] uppercase",
                          pos.side === "long" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300",
                        )}
                      >
                        {pos.side}
                      </span>
                      {pos.size} {pos.contract} @ {pos.avg_price.toFixed(2)}
                    </span>
                    <span className={cn("font-mono font-semibold", pos.unrealized_usd >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {pos.unrealized_usd >= 0 ? "+" : ""}${pos.unrealized_usd.toFixed(0)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-ink-secondary">
                    <span>SL {pos.sl_price.toFixed(2)}</span>
                    <span>TP {pos.tp_price.toFixed(2)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[9.5px]">
                    <span className={cn("rounded px-1.5 py-0.5", beArmed ? "bg-emerald-500/25 font-semibold text-emerald-200" : "bg-inset text-ink-tertiary")}>
                      BE+1 @ {pos.be_trigger.toFixed(2)}
                    </span>
                    <span className={cn("rounded px-1.5 py-0.5", lock1rArmed ? "bg-emerald-500/25 font-semibold text-emerald-200" : "bg-inset text-ink-tertiary")}>
                      +1R @ {pos.lock_1r_trigger.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {openPositions.length === 0 && openOrders.length > 0 && (
          <div className="space-y-1 rounded-xl border border-hairline/35 bg-inset/60 p-2 font-mono text-[10.5px]">
            {openOrders.slice(0, 2).map((ord) => (
              <div key={String(ord.id)} className="flex items-center justify-between text-ink-secondary">
                <span className="uppercase">{ord.side} {ord.size}</span>
                <span>@ {(ord.limitPrice ?? ord.stopPrice ?? 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {pendingApprovals.length > 0 && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-2 text-[11px]">
            <div className="font-semibold text-amber-300">{pendingApprovals.length} pending approval</div>
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => onDecideApproval(pendingApprovals[0]!.id, "approve")}
                className="flex-1 rounded-lg bg-emerald-500/20 py-1 font-semibold text-emerald-300 hover:bg-emerald-500/30"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => onDecideApproval(pendingApprovals[0]!.id, "reject")}
                className="flex-1 rounded-lg bg-rose-500/20 py-1 font-semibold text-rose-300 hover:bg-rose-500/30"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <div className="flex flex-1 rounded-lg border border-hairline/40 bg-inset p-0.5 text-[11px]">
            {(["auto", "approve"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={busyAction === "config"}
                onClick={() => onUpdateConfig({ execution_mode: mode })}
                className={cn(
                  "flex-1 rounded-md py-1 font-medium capitalize transition",
                  trading?.desk.execution_mode === mode ? "bg-control text-ink" : "text-ink-tertiary hover:text-ink-secondary",
                )}
              >
                {mode === "auto" ? "Full Auto" : "Approve"}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busyAction === "flatten"}
            onClick={() => {
              if (!confirmFlatten) {
                setConfirmFlatten(true);
                return;
              }
              setConfirmFlatten(false);
              onFlatten();
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-50",
              confirmFlatten
                ? "border-rose-400 bg-rose-600 text-white shadow-md shadow-rose-950/50"
                : "border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25",
            )}
            title={confirmFlatten ? "Click again to market-flatten all positions & orders" : "Emergency Flatten (2-click confirm)"}
          >
            <ShieldAlert size={12} />
            {busyAction === "flatten"
              ? "Flattening…"
              : confirmFlatten
                ? "Confirm?"
                : (trading?.multi_account?.active_live_count ?? 0) > 1
                  ? `Flatten All (${trading!.multi_account!.active_live_count})`
                  : "Flatten"}
          </button>
        </div>
      </div>
    </section>
  );
}

export function NewsModuleCard({
  trading,
  style,
  highlighted,
  onDragStart,
  onHover,
}: {
  trading: TradingState | null;
  style: CSSProperties;
  highlighted: boolean;
  onDragStart: (e: ReactPointerEvent<HTMLElement>) => void;
  onHover: (id: DeskNodeId | null) => void;
}) {
  const vol = trading?.market.volatility;
  return (
    <section
      data-desk-node="mod:news"
      style={style}
      onMouseEnter={() => onHover("mod:news")}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-2xl border bg-[#141418]/95 shadow-xl backdrop-blur-md",
        highlighted ? "border-amber-400/70" : "border-hairline/55",
      )}
    >
      <div
        onPointerDown={onDragStart}
        className="flex cursor-grab items-center justify-between border-b border-hairline/35 px-3.5 py-2.5 active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          <Newspaper size={14} className="text-amber-400" />
          <span className="text-[12.5px] font-semibold text-ink">Regime &amp; USD News</span>
        </div>
        {vol && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              vol.regime === "CRASH"
                ? "bg-rose-500/20 text-rose-300"
                : vol.regime === "ELEVATED"
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-emerald-500/15 text-emerald-300",
            )}
          >
            {vol.regime}
          </span>
        )}
      </div>
      <div data-card-scroll className="flex-1 space-y-2.5 overflow-y-auto p-3.5 text-[11.5px]">
        <div className="flex items-center justify-between rounded-xl border border-hairline/35 bg-inset/70 px-2.5 py-2 font-mono">
          <div>
            <div className="text-[10px] text-ink-tertiary">Overnight Range</div>
            <div className="text-[13px] font-semibold text-ink">{vol ? `${vol.overnight_range_pt.toFixed(0)} pt` : "—"}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-ink-tertiary">Filter / 1m Med</div>
            <div className="text-[11.5px] text-ink-secondary">
              {vol ? `650 pt · ${vol.m1_median_pt.toFixed(1)} pt` : "650 pt"}
            </div>
          </div>
        </div>

        {trading?.news?.length ? (
          <div className="space-y-1.5">
            {trading.news.slice(0, 4).map((item, idx) => (
              <div key={`${item.time}-${idx}`} className="flex items-center justify-between gap-2 rounded-lg bg-inset/50 px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("size-1.5 shrink-0 rounded-full", /high/i.test(item.impact) ? "bg-rose-400" : "bg-amber-400")} />
                  <span className="truncate text-ink">{item.event}</span>
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-ink-tertiary">{item.time}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-inset/50 px-2.5 py-2 text-ink-tertiary">
            <AlertTriangle size={12} className="shrink-0" />
            <span>No high-impact USD events listed today.</span>
          </div>
        )}
      </div>
    </section>
  );
}

export function JournalModuleCard({
  journals,
  trading,
  style,
  highlighted,
  onDragStart,
  onHover,
}: {
  journals: TradingJournalsData | null;
  trading?: TradingState | null;
  style: CSSProperties;
  highlighted: boolean;
  onDragStart: (e: ReactPointerEvent<HTMLElement>) => void;
  onHover: (id: DeskNodeId | null) => void;
}) {
  const [journalIdx, setJournalIdx] = useState(0);
  const eqCurve = journals?.equity_curve_80d ?? [];
  const liveJournals = journals?.live_journals ?? [];
  const safeIdx = Math.min(journalIdx, Math.max(0, liveJournals.length - 1));
  const activeJournal = liveJournals[safeIdx] ?? null;

  const sparkPath = useMemo(() => {
    if (eqCurve.length < 2) return null;
    const vals = eqCurve.map((d) => d.cum_v7_base_usd);
    const min = Math.min(0, ...vals);
    const max = Math.max(1000, ...vals);
    const span = Math.max(1, max - min);
    const w = 280;
    const h = 88;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 12) - 6;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const zeroY = h - ((0 - min) / span) * (h - 12) - 6;
    return {
      line: `M ${pts.join(" L ")}`,
      area: `M 0,${h} L ${pts.join(" L ")} L ${w},${h} Z`,
      zeroY,
    };
  }, [eqCurve]);

  return (
    <section
      data-desk-node="mod:journal"
      style={style}
      onMouseEnter={() => onHover("mod:journal")}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-2xl border bg-[#141418]/95 shadow-xl backdrop-blur-md",
        highlighted ? "border-sky-400/70" : "border-hairline/55",
      )}
    >
      <div
        onPointerDown={onDragStart}
        className="flex cursor-grab items-center justify-between border-b border-hairline/35 px-3.5 py-2.5 active:cursor-grabbing"
      >
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-sky-400" />
          <span className="text-[12.5px] font-semibold text-ink">80d Benchmark &amp; Journals</span>
        </div>
      </div>

      <div data-card-scroll className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5 text-[12px]">
        <div className="rounded-xl border border-hairline/35 bg-inset/70 p-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-medium text-ink-secondary">80-Day Blind Equity</span>
            <span className="font-mono font-semibold text-emerald-400">+$17,324 · PF 2.58</span>
          </div>
          {sparkPath ? (
            <svg viewBox="0 0 280 88" className="h-[88px] w-full overflow-visible">
              <defs>
                <linearGradient id="ombDeskEqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#26c485" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#26c485" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <line x1="0" y1={sparkPath.zeroY} x2="280" y2={sparkPath.zeroY} stroke="rgba(148,163,184,0.22)" strokeDasharray="3 3" />
              <path d={sparkPath.area} fill="url(#ombDeskEqGrad)" />
              <path d={sparkPath.line} fill="none" stroke="#26c485" strokeWidth="2" />
            </svg>
          ) : (
            <div className="flex h-[88px] items-center justify-center text-[11px] text-ink-tertiary">Loading benchmark…</div>
          )}
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-center font-mono text-[10.5px]">
            <div className="rounded-lg bg-card/80 py-1"><div className="text-ink-tertiary">WR</div><div className="font-semibold text-ink">57.9%</div></div>
            <div className="rounded-lg bg-card/80 py-1"><div className="text-ink-tertiary">1st Pass</div><div className="font-semibold text-emerald-400">92.2%</div></div>
            <div className="rounded-lg bg-card/80 py-1"><div className="text-ink-tertiary">Payout #1</div><div className="font-semibold text-sky-400">86.4%</div></div>
          </div>
        </div>

        <CombineRoadmapPanel trading={trading ?? null} liveJournals={liveJournals} />

        <div className="flex flex-1 flex-col rounded-xl border border-hairline/35 bg-inset/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
              <BookOpen size={12} className="text-sky-400" />
              {safeIdx === 0 ? "Latest Session" : "Session Log"}
            </span>
            {liveJournals.length > 1 && (
              <div className="flex items-center gap-1 font-mono text-[10.5px] text-ink-secondary">
                <button
                  type="button"
                  disabled={safeIdx >= liveJournals.length - 1}
                  onClick={() => setJournalIdx((i) => Math.min(liveJournals.length - 1, i + 1))}
                  title="Older session"
                  aria-label="Older session"
                  className="rounded p-0.5 hover:bg-control hover:text-ink disabled:opacity-30"
                >
                  <ChevronLeft size={12} />
                </button>
                <span>{liveJournals.length - safeIdx}/{liveJournals.length}</span>
                <button
                  type="button"
                  disabled={safeIdx <= 0}
                  onClick={() => setJournalIdx((i) => Math.max(0, i - 1))}
                  title="Newer session"
                  aria-label="Newer session"
                  className="rounded p-0.5 hover:bg-control hover:text-ink disabled:opacity-30"
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            )}
          </div>
          {activeJournal ? (
            <>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                  {activeJournal.date} · Grade {activeJournal.grade}
                </span>
                <span className={cn("font-mono text-[11px] font-semibold", activeJournal.realized_pnl_usd >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {activeJournal.realized_pnl_usd >= 0 ? "+" : ""}${activeJournal.realized_pnl_usd.toFixed(2)}
                </span>
              </div>
              <div className="mt-1.5 font-mono text-[10.5px] capitalize text-ink-tertiary">
                {activeJournal.outcome} · {activeJournal.mode}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-secondary">{activeJournal.summary}</p>
              {activeJournal.lessons && (
                <div className="mt-2 border-t border-hairline/30 pt-2 text-[11px] leading-relaxed text-ink-tertiary">
                  <span className="font-medium text-ink-secondary">Lesson: </span>
                  {activeJournal.lessons}
                </div>
              )}
            </>
          ) : (
            <p className="mt-2 text-[11.5px] text-ink-tertiary">No live sessions logged yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
