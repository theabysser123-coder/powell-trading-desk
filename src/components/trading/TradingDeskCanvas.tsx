import { useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Activity, Maximize2, Minimize2, Minus, Plus, RefreshCw, RotateCcw } from "lucide-react";

import { cn } from "@/lib/cn";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot, useStore, type Bot } from "@/state/store";
import { TradingChartTab } from "./TradingChartTab.tsx";
import {
  BotDeskNode,
  JournalModuleCard,
  MorningPlanStrip,
  NewsModuleCard,
  RiskModuleCard,
  type DeskNodeId,
} from "./TradingDeskNodes.tsx";
import type { TradingChartData, TradingJournalsData, TradingState } from "./types.ts";

interface Point {
  x: number;
  y: number;
}

interface View {
  x: number;
  y: number;
  scale: number;
}

interface NodeBox {
  id: DeskNodeId;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DeskWire {
  id: string;
  from: DeskNodeId;
  to: DeskNodeId;
  tone: "command" | "risk" | "trade" | "journal";
  animated: boolean;
  dashed: boolean;
}

type Gesture =
  | { kind: "pan"; pointerId: number; startX: number; startY: number; origin: View }
  | { kind: "node"; pointerId: number; nodeId: DeskNodeId; startX: number; startY: number; origin: Point };

const POS_STORAGE_KEY = "omb-trading-desk-canvas-pos-v1";
const MIN_SCALE = 0.42;
const MAX_SCALE = 1.45;

const DEFAULT_LAYOUT: Record<DeskNodeId, { x: number; y: number; width: number; height: number }> = {
  "bot:chief": { x: 560, y: 24, width: 296, height: 112 },

  "bot:risk": { x: 48, y: 204, width: 280, height: 110 },
  "bot:trader": { x: 568, y: 204, width: 280, height: 110 },
  "bot:journal": { x: 1088, y: 204, width: 280, height: 110 },

  "mod:risk": { x: 32, y: 380, width: 324, height: 324 },
  "mod:news": { x: 32, y: 726, width: 324, height: 194 },
  "mod:chart": { x: 396, y: 380, width: 628, height: 540 },
  "mod:journal": { x: 1066, y: 380, width: 328, height: 540 },
};

function loadPositions(): Partial<Record<DeskNodeId, Point>> {
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Partial<Record<DeskNodeId, Point>> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (k in DEFAULT_LAYOUT && v && typeof v === "object" && typeof (v as Point).x === "number" && typeof (v as Point).y === "number") {
        out[k as DeskNodeId] = { x: Math.round((v as Point).x), y: Math.round((v as Point).y) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function savePositions(positions: Partial<Record<DeskNodeId, Point>>): void {
  try {
    if (Object.keys(positions).length === 0) localStorage.removeItem(POS_STORAGE_KEY);
    else localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // ignore storage errors
  }
}

function verticalWire(from: NodeBox, to: NodeBox): { d: string; x1: number; y1: number; x2: number; y2: number } {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height;
  const x2 = to.x + to.width / 2;
  const y2 = to.y;
  const dy = Math.max(42, Math.abs(y2 - y1) * 0.48);
  return { d: `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`, x1, y1, x2, y2 };
}

function wireStroke(tone: DeskWire["tone"], highlighted: boolean): string {
  if (tone === "command") return highlighted ? "#a78bfa" : "rgba(167, 139, 250, 0.45)";
  if (tone === "risk") return highlighted ? "#f59e0b" : "rgba(245, 158, 11, 0.48)";
  if (tone === "trade") return highlighted ? "#26c485" : "rgba(38, 196, 133, 0.55)";
  return highlighted ? "#38bdf8" : "rgba(56, 189, 248, 0.48)";
}

export interface TradingDeskCanvasProps {
  state: TradingState | null;
  chart: TradingChartData | null;
  journals: TradingJournalsData | null;
  loadingChart: boolean;
  tf: number;
  busyAction: string | null;
  chartExpanded: boolean;
  onToggleChartExpanded: () => void;
  onTfChange: (tf: number) => void;
  onRefresh: () => void;
  onFlatten: () => void;
  onUpdateConfig: (patch: { execution_mode?: "auto" | "approve"; topstep_mode?: "practice" | "live"; base_risk?: number }) => void;
  onDecideApproval: (id: string, action: "approve" | "reject") => void;
  onClose: () => void;
}

export function TradingDeskCanvas({
  state: trading,
  chart,
  journals,
  loadingChart,
  tf,
  busyAction,
  chartExpanded,
  onToggleChartExpanded,
  onTfChange,
  onRefresh,
  onFlatten,
  onUpdateConfig,
  onDecideApproval,
  onClose,
}: TradingDeskCanvasProps) {
  const { state: appState, dispatch } = useStore();
  const showThreads = useShowThreads();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [positions, setPositions] = useState<Partial<Record<DeskNodeId, Point>>>(loadPositions);
  const [view, setView] = useState<View>({ x: 30, y: 24, scale: 0.85 });
  const [hovered, setHovered] = useState<DeskNodeId | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const fittedRef = useRef(false);

  const deskBots = useMemo(() => {
    const bots = appState.bots.filter((b) => !b.hidden);
    const find = (match: RegExp) => bots.find((b) => match.test(b.name));
    return {
      chief: bots.find((b) => b.chiefOfStaff) ?? find(/head of desk/i),
      risk: find(/risk|guardian/i),
      trader: find(/powell|trader/i),
      journal: find(/journal|replay/i),
    };
  }, [appState.bots]);

  const nodes = useMemo(() => {
    const out = {} as Record<DeskNodeId, NodeBox>;
    for (const id of Object.keys(DEFAULT_LAYOUT) as DeskNodeId[]) {
      const def = DEFAULT_LAYOUT[id];
      const pos = positions[id];
      out[id] = { id, x: pos?.x ?? def.x, y: pos?.y ?? def.y, width: def.width, height: def.height };
    }
    return out;
  }, [positions]);

  const wires = useMemo<DeskWire[]>(() => [
    { id: "w:chief-risk", from: "bot:chief", to: "bot:risk", tone: "command", animated: Boolean(deskBots.chief?.busy || deskBots.risk?.busy), dashed: true },
    { id: "w:chief-trader", from: "bot:chief", to: "bot:trader", tone: "command", animated: Boolean(deskBots.chief?.busy || deskBots.trader?.busy), dashed: true },
    { id: "w:chief-journal", from: "bot:chief", to: "bot:journal", tone: "command", animated: Boolean(deskBots.chief?.busy || deskBots.journal?.busy), dashed: true },
    { id: "w:risk-account", from: "bot:risk", to: "mod:risk", tone: "risk", animated: Boolean(deskBots.risk?.busy || trading?.broker_connected), dashed: false },
    { id: "w:risk-news", from: "mod:risk", to: "mod:news", tone: "risk", animated: Boolean(deskBots.risk?.busy), dashed: false },
    { id: "w:trader-chart", from: "bot:trader", to: "mod:chart", tone: "trade", animated: Boolean(deskBots.trader?.busy || trading?.broker_connected), dashed: false },
    { id: "w:journal-eq", from: "bot:journal", to: "mod:journal", tone: "journal", animated: Boolean(deskBots.journal?.busy), dashed: false },
  ], [deskBots, trading?.broker_connected]);

  const highlightedSet = useMemo(() => {
    const ids = new Set<DeskNodeId>();
    const edgeIds = new Set<string>();
    if (!hovered) return { ids, edgeIds };
    ids.add(hovered);
    const frontier: DeskNodeId[] = [hovered];
    while (frontier.length > 0) {
      const curr = frontier.pop()!;
      for (const w of wires) {
        if (w.from === curr && !edgeIds.has(w.id)) {
          edgeIds.add(w.id);
          if (!ids.has(w.to)) { ids.add(w.to); frontier.push(w.to); }
        }
        if (w.to === curr && !edgeIds.has(w.id)) {
          edgeIds.add(w.id);
          if (!ids.has(w.from)) { ids.add(w.from); frontier.push(w.from); }
        }
      }
    }
    return { ids, edgeIds };
  }, [hovered, wires]);

  const fitToViewport = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of Object.values(nodes)) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    const padX = 48;
    const padY = 48;
    const contentW = Math.max(400, maxX - minX + padX * 2);
    const contentH = Math.max(300, maxY - minY + padY * 2);
    const scale = Math.max(MIN_SCALE, Math.min(1.02, Math.min(rect.width / contentW, rect.height / contentH)));
    const x = Math.round((rect.width - (maxX - minX) * scale) / 2 - minX * scale);
    const y = Math.round((rect.height - (maxY - minY) * scale) / 2 - minY * scale);
    setView({ x, y, scale });
  }, [nodes]);

  useLayoutEffect(() => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    fitToViewport();
  }, [fitToViewport]);

  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const el = viewportRef.current;
    setView((current) => {
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number((current.scale * factor).toFixed(3))));
      if (!el || clientX === undefined || clientY === undefined) {
        const cx = (el?.clientWidth ?? 1200) / 2;
        const cy = (el?.clientHeight ?? 760) / 2;
        const wx = (cx - current.x) / current.scale;
        const wy = (cy - current.y) / current.scale;
        return { scale: nextScale, x: Math.round(cx - wx * nextScale), y: Math.round(cy - wy * nextScale) };
      }
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const wx = (px - current.x) / current.scale;
      const wy = (py - current.y) / current.scale;
      return { scale: nextScale, x: Math.round(px - wx * nextScale), y: Math.round(py - wy * nextScale) };
    });
  }, []);

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey && (event.target as HTMLElement).closest("[data-card-scroll]")) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.09 : 1 / 1.09;
    zoomBy(factor, event.clientX, event.clientY);
  }, [zoomBy]);

  const onBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-desk-node],[data-desk-hud]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ kind: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: view });
  };

  const startNodeDrag = (event: ReactPointerEvent<HTMLElement>, nodeId: DeskNodeId) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a, input, [data-no-drag]")) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const n = nodes[nodeId];
    setGesture({ kind: "node", pointerId: event.pointerId, nodeId, startX: event.clientX, startY: event.clientY, origin: { x: n.x, y: n.y } });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (gesture.kind === "pan") {
      setView({ ...gesture.origin, x: Math.round(gesture.origin.x + dx), y: Math.round(gesture.origin.y + dy) });
    } else {
      setPositions((prev) => ({
        ...prev,
        [gesture.nodeId]: { x: Math.round(gesture.origin.x + dx / view.scale), y: Math.round(gesture.origin.y + dy / view.scale) },
      }));
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.kind === "node") savePositions(positions);
    setGesture(null);
  };

  const resetLayout = () => {
    setPositions({});
    savePositions({});
    fittedRef.current = false;
    requestAnimationFrame(() => fitToViewport());
  };

  const openBotChat = (bot: Bot | undefined) => {
    if (!bot) return;
    openBot(dispatch, bot, showThreads);
    onClose();
  };

  const openPositions = trading?.positions ?? [];
  const sessionPlan = trading?.session.plan ?? null;
  const hasHover = hovered !== null;

  const nodeStyle = (id: DeskNodeId) => {
    const box = nodes[id];
    const dimmed = hasHover && !highlightedSet.ids.has(id);
    return {
      left: box.x,
      top: box.y,
      width: box.width,
      minHeight: box.height,
      opacity: dimmed ? 0.35 : 1,
      transition: gesture?.kind === "node" && gesture.nodeId === id ? "none" : "opacity 160ms ease, box-shadow 160ms ease",
    };
  };

  return (
    <div
      ref={viewportRef}
      data-testid="trading-desk-canvas"
      onWheel={onWheel}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setGesture(null)}
      className={cn(
        "relative min-h-0 flex-1 overflow-hidden select-none bg-[#0d0d10]",
        gesture?.kind === "pan" ? "cursor-grabbing" : "cursor-grab",
      )}
      style={{
        backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.16) 1px, transparent 1px)",
        backgroundSize: `${Math.max(12, Math.round(24 * view.scale))}px ${Math.max(12, Math.round(24 * view.scale))}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <style>{`
        @keyframes ombDeskFlow {
          from { stroke-dashoffset: 24; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      <div className="absolute inset-0 origin-top-left" style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}>
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {wires.map((wire) => {
            const from = nodes[wire.from];
            const to = nodes[wire.to];
            const lit = highlightedSet.edgeIds.has(wire.id);
            const dimmed = hasHover && !lit;
            const { d, x1, y1, x2, y2 } = verticalWire(from, to);
            const stroke = wireStroke(wire.tone, lit || !hasHover);
            return (
              <g key={wire.id} style={{ opacity: dimmed ? 0.16 : 1, transition: "opacity 160ms ease" }}>
                <path
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={lit ? 2.6 : 1.9}
                  strokeDasharray={wire.animated ? "6 6" : wire.dashed ? "5 5" : undefined}
                  style={wire.animated ? { animation: "ombDeskFlow 0.9s linear infinite" } : undefined}
                />
                <circle cx={x1} cy={y1} r={3.5} fill={stroke} />
                <circle cx={x2} cy={y2} r={3.5} fill={stroke} />
              </g>
            );
          })}
        </svg>

        <BotDeskNode
          id="bot:chief"
          bot={deskBots.chief}
          fallbackName="Head of Desk"
          fallbackRole="Portfolio Manager · Powell v7"
          schedule="Always On · PM Oversight"
          accent="border-violet-400/45"
          instances={appState.instances}
          style={nodeStyle("bot:chief")}
          highlighted={highlightedSet.ids.has("bot:chief")}
          onDragStart={(e) => startNodeDrag(e, "bot:chief")}
          onHover={setHovered}
          onChat={() => openBotChat(deskBots.chief)}
        />
        <BotDeskNode
          id="bot:risk"
          bot={deskBots.risk}
          fallbackName="Risk & Prop Guardian"
          fallbackRole="Topstep $50K · MLL / DLL / News"
          schedule="07:55 AM ET · Mon–Fri"
          accent="border-amber-400/45"
          instances={appState.instances}
          style={nodeStyle("bot:risk")}
          highlighted={highlightedSet.ids.has("bot:risk")}
          onDragStart={(e) => startNodeDrag(e, "bot:risk")}
          onHover={setHovered}
          onChat={() => openBotChat(deskBots.risk)}
        />
        <BotDeskNode
          id="bot:trader"
          bot={deskBots.trader}
          fallbackName="Powell v7 Trader"
          fallbackRole="NY AM NQ Executor · Full Auto"
          schedule="08:00 AM ET · Mon–Fri"
          accent="border-emerald-400/45"
          instances={appState.instances}
          style={nodeStyle("bot:trader")}
          highlighted={highlightedSet.ids.has("bot:trader")}
          onDragStart={(e) => startNodeDrag(e, "bot:trader")}
          onHover={setHovered}
          onChat={() => openBotChat(deskBots.trader)}
        />
        <BotDeskNode
          id="bot:journal"
          bot={deskBots.journal}
          fallbackName="Journal & Replay Analyst"
          fallbackRole="Live Journals · 80-Day Benchmark"
          schedule="12:15 PM ET · Mon–Fri"
          accent="border-sky-400/45"
          instances={appState.instances}
          style={nodeStyle("bot:journal")}
          highlighted={highlightedSet.ids.has("bot:journal")}
          onDragStart={(e) => startNodeDrag(e, "bot:journal")}
          onHover={setHovered}
          onChat={() => openBotChat(deskBots.journal)}
        />

        <RiskModuleCard
          trading={trading}
          busyAction={busyAction}
          style={nodeStyle("mod:risk")}
          highlighted={highlightedSet.ids.has("mod:risk")}
          onDragStart={(e) => startNodeDrag(e, "mod:risk")}
          onHover={setHovered}
          onFlatten={onFlatten}
          onUpdateConfig={onUpdateConfig}
          onDecideApproval={onDecideApproval}
        />

        <NewsModuleCard
          trading={trading}
          style={nodeStyle("mod:news")}
          highlighted={highlightedSet.ids.has("mod:news")}
          onDragStart={(e) => startNodeDrag(e, "mod:news")}
          onHover={setHovered}
        />

        <section
          data-desk-node="mod:chart"
          style={nodeStyle("mod:chart")}
          onMouseEnter={() => setHovered("mod:chart")}
          onMouseLeave={() => setHovered((c) => (c === "mod:chart" ? null : c))}
          className={cn(
            "absolute flex flex-col overflow-hidden rounded-2xl border bg-[#121216]/95 shadow-xl backdrop-blur-md",
            highlightedSet.ids.has("mod:chart") ? "border-emerald-400/70" : "border-hairline/55",
          )}
        >
          <div
            onPointerDown={(e) => startNodeDrag(e, "mod:chart")}
            className="flex cursor-grab items-center justify-between border-b border-hairline/35 px-3.5 py-2.5 active:cursor-grabbing"
          >
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-emerald-400" />
              <span className="text-[12.5px] font-semibold text-ink">
                Live Tape · {trading?.market.mnq_contract ?? "MNQZ6"} / {trading?.market.es_contract ?? "ESZ6"} SMT
              </span>
              {trading?.market.last_nq && (
                <span className="rounded-md bg-inset px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
                  {trading.market.last_nq.toFixed(2)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onToggleChartExpanded}
              title="Expand chart fullscreen"
              aria-label="Expand chart fullscreen"
              className="rounded-md p-1 text-ink-tertiary hover:bg-control hover:text-ink"
            >
              <Maximize2 size={12} />
            </button>
          </div>
          <MorningPlanStrip
            plan={sessionPlan}
            dayLocked={Boolean(trading?.session.day_locked)}
            lockReason={trading?.session.lock_reason ?? null}
          />
          {!chartExpanded ? (
            <div data-card-scroll data-no-drag className="min-h-0 flex-1 overflow-y-auto" style={{ height: 492 }}>
              <TradingChartTab
                chart={chart}
                loading={loadingChart}
                tf={tf}
                onTfChange={onTfChange}
                onRefresh={onRefresh}
                positions={openPositions}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-ink-tertiary">
              Expanded fullscreen…
            </div>
          )}
        </section>

        <JournalModuleCard
          journals={journals}
          style={nodeStyle("mod:journal")}
          highlighted={highlightedSet.ids.has("mod:journal")}
          onDragStart={(e) => startNodeDrag(e, "mod:journal")}
          onHover={setHovered}
        />
      </div>

      {chartExpanded && (
        <div
          data-desk-hud
          className="absolute inset-3 z-30 flex flex-col overflow-hidden rounded-2xl border border-emerald-400/50 bg-[#121216]/98 shadow-2xl backdrop-blur-md"
        >
          <div className="flex items-center justify-between border-b border-hairline/40 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Activity size={14} className="text-emerald-400" />
              <span className="text-[13px] font-semibold text-ink">
                Live Tape · {trading?.market.mnq_contract ?? "MNQZ6"} / {trading?.market.es_contract ?? "ESZ6"} SMT
              </span>
              {trading?.market.last_nq && (
                <span className="rounded-md bg-inset px-2 py-0.5 font-mono text-[11.5px] text-emerald-300">
                  {trading.market.last_nq.toFixed(2)}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onToggleChartExpanded}
              title="Exit fullscreen (Esc)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-inset px-2.5 py-1 text-[11.5px] font-medium text-ink-secondary hover:bg-control hover:text-ink"
            >
              <Minimize2 size={12} />
              <span>Shrink</span>
            </button>
          </div>
          <MorningPlanStrip
            plan={sessionPlan}
            dayLocked={Boolean(trading?.session.day_locked)}
            lockReason={trading?.session.lock_reason ?? null}
            expanded
          />
          <div data-card-scroll data-no-drag className="min-h-0 flex-1 overflow-y-auto">
            <TradingChartTab
              chart={chart}
              loading={loadingChart}
              tf={tf}
              onTfChange={onTfChange}
              onRefresh={onRefresh}
              positions={openPositions}
            />
          </div>
        </div>
      )}

      <div
        data-desk-hud
        className="pointer-events-auto absolute bottom-4 left-4 z-20 flex items-center gap-1 rounded-xl border border-hairline/50 bg-[#141418]/90 p-1 text-ink-secondary shadow-xl backdrop-blur-md"
      >
        <button type="button" onClick={() => zoomBy(1 / 1.15)} title="Zoom out" aria-label="Zoom out" className="flex size-8 items-center justify-center rounded-lg hover:bg-control hover:text-ink">
          <Minus size={14} />
        </button>
        <span className="min-w-[44px] text-center font-mono text-[11px] text-ink">{Math.round(view.scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.15)} title="Zoom in" aria-label="Zoom in" className="flex size-8 items-center justify-center rounded-lg hover:bg-control hover:text-ink">
          <Plus size={14} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-hairline/50" />
        <button type="button" onClick={fitToViewport} title="Fit canvas to screen" aria-label="Fit canvas" className="flex size-8 items-center justify-center rounded-lg hover:bg-control hover:text-ink">
          <Maximize2 size={13} />
        </button>
        <button type="button" onClick={resetLayout} title="Reset layout" aria-label="Reset layout" className="flex size-8 items-center justify-center rounded-lg hover:bg-control hover:text-ink">
          <RotateCcw size={13} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-hairline/50" />
        <button type="button" onClick={onRefresh} title="Refresh live desk feeds" aria-label="Refresh feeds" className="flex size-8 items-center justify-center rounded-lg hover:bg-control hover:text-ink">
          <RefreshCw size={13} className={loadingChart ? "animate-spin" : ""} />
        </button>
      </div>
    </div>
  );
}
