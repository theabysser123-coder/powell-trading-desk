import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Calendar,
  Clock,
  Crown,
  Database,
  GitBranch,
  Globe,
  Mail,
  Maximize2,
  MessageCircle,
  Minus,
  Newspaper,
  Play,
  Plus,
  RotateCcw,
  Terminal,
  Webhook,
  Zap,
} from "lucide-react";

import type { Automation } from "@/lib/automations";
import {
  buildAutomationCanvasGraph,
  COLUMN_X,
  connectedSubgraph,
  loadCanvasPositions,
  saveCanvasPositions,
  wirePath,
  type BotNodeData,
  type CanvasEdge,
  type CanvasNode,
  type CanvasPoint,
  type JobNodeData,
  type SystemIconKey,
  type SystemNodeData,
  type TriggerNodeData,
} from "@/lib/automation-canvas";
import { cn } from "@/lib/cn";
import { activityPreview, botEngine } from "@/lib/failed-turn";
import { computerStepLine } from "@/lib/computer-step";
import { teamMapStatus } from "@/lib/team-map";
import { useShowThreads } from "@/lib/thread-preferences";
import { openBot, useStore, type Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { Switch } from "../SettingsPrimitives";
import { StatusMark } from "./parts";

interface View {
  x: number;
  y: number;
  scale: number;
}

type Gesture =
  | { kind: "pan"; pointerId: number; startX: number; startY: number; origin: View; moved: boolean }
  | { kind: "node"; pointerId: number; nodeId: string; startX: number; startY: number; origin: CanvasPoint; moved: boolean };

const MIN_SCALE = 0.45;
const MAX_SCALE = 1.6;
const DRAG_THRESHOLD = 5;

const SYSTEM_ICONS: Record<SystemIconKey, typeof Activity> = {
  exchange: Database,
  tape: Activity,
  news: Newspaper,
  journal: BookOpen,
  benchmark: BarChart3,
  script: Terminal,
  web: Globe,
  mail: Mail,
  calendar: Calendar,
  github: GitBranch,
  chat: MessageCircle,
};

function currentBotStep(bot: Bot, instances: ReturnType<typeof useStore>["state"]["instances"]): string | undefined {
  if (!bot.busy) return undefined;
  const open = bot.tasks?.find((task) => task.threadId === bot.threadId);
  const last = !open || open.busy ? bot.messages.findLast((message) => message.kind === "activity" && message.tool) : undefined;
  if (last?.tool) return computerStepLine(last.tool) ?? activityPreview(last.tool, botEngine(bot, instances), last.dataResult);
  return bot.tasks?.find((task) => task.busy && task.threadId !== bot.threadId && task.title.trim())?.title;
}

function edgeStroke(edge: CanvasEdge, highlighted: boolean): string {
  if (edge.tone === "running") return "#26c485";
  if (edge.tone === "danger") return "#e54d5d";
  if (edge.tone === "warning") return "#f59e0b";
  if (edge.tone === "paused") return "rgba(148, 163, 184, 0.35)";
  if (edge.tone === "oversight") return highlighted ? "rgba(167, 139, 250, 0.85)" : "rgba(148, 163, 184, 0.32)";
  return highlighted ? "#26c485" : "rgba(148, 163, 184, 0.45)";
}

export interface AutomationsCanvasProps {
  automations: readonly Automation[];
  bots: readonly Pick<Bot, "id">[];
  selectedAutomationId: string | null;
  busyAction: string | null;
  onSelectAutomation: (id: string | null) => void;
  onRunNow: (automation: Automation) => void;
  onToggle: (automation: Automation) => void;
  onNewAutomation: () => void;
}

export function AutomationsCanvas({
  automations,
  bots,
  selectedAutomationId,
  busyAction,
  onSelectAutomation,
  onRunNow,
  onToggle,
  onNewAutomation,
}: AutomationsCanvasProps) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [positions, setPositions] = useState<Record<string, CanvasPoint>>(loadCanvasPositions);
  const [view, setView] = useState<View>({ x: 32, y: 24, scale: 0.92 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const fittedRef = useRef(false);

  const visibleBotIds = useMemo(() => new Set(bots.map((bot) => bot.id)), [bots]);
  const liveBots = useMemo(() => state.bots.filter((bot) => visibleBotIds.has(bot.id)), [state.bots, visibleBotIds]);

  const graph = useMemo(
    () => buildAutomationCanvasGraph({ automations, bots: liveBots, positions }),
    [automations, liveBots, positions],
  );
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

  const activeFocusId = hoveredId ?? (selectedAutomationId ? `job:${selectedAutomationId}` : selectedNodeId);
  const highlight = useMemo(() => connectedSubgraph(activeFocusId, graph.edges), [activeFocusId, graph.edges]);
  const hasHighlight = Boolean(activeFocusId && highlight.nodes.size > 0);

  const fitToViewport = useCallback(() => {
    const el = viewportRef.current;
    if (!el || graph.nodes.length === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) return;
    const padX = 56;
    const padY = 64;
    const contentW = Math.max(300, graph.bounds.maxX - graph.bounds.minX + padX * 2);
    const contentH = Math.max(240, graph.bounds.maxY - graph.bounds.minY + padY * 2);
    const scale = Math.max(MIN_SCALE, Math.min(1.04, Math.min(rect.width / contentW, rect.height / contentH)));
    const x = Math.round((rect.width - (graph.bounds.maxX - graph.bounds.minX) * scale) / 2 - graph.bounds.minX * scale);
    const y = Math.round((rect.height - (graph.bounds.maxY - graph.bounds.minY) * scale) / 2 - graph.bounds.minY * scale);
    setView({ x, y, scale });
  }, [graph.bounds, graph.nodes.length]);

  useLayoutEffect(() => {
    if (fittedRef.current || graph.nodes.length === 0) return;
    fittedRef.current = true;
    fitToViewport();
  }, [fitToViewport, graph.nodes.length]);

  useEffect(() => {
    if (!selectedAutomationId) return;
    setSelectedNodeId(`job:${selectedAutomationId}`);
  }, [selectedAutomationId]);

  const zoomBy = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const el = viewportRef.current;
    setView((current) => {
      const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number((current.scale * factor).toFixed(3))));
      if (!el || clientX === undefined || clientY === undefined) {
        const cx = (el?.clientWidth ?? 900) / 2;
        const cy = (el?.clientHeight ?? 600) / 2;
        const worldX = (cx - current.x) / current.scale;
        const worldY = (cy - current.y) / current.scale;
        return { scale: nextScale, x: Math.round(cx - worldX * nextScale), y: Math.round(cy - worldY * nextScale) };
      }
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const worldX = (px - current.x) / current.scale;
      const worldY = (py - current.y) / current.scale;
      return { scale: nextScale, x: Math.round(px - worldX * nextScale), y: Math.round(py - worldY * nextScale) };
    });
  }, []);

  const onCanvasWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) >= 4) {
      const factor = event.deltaY < 0 ? 1.09 : 1 / 1.09;
      zoomBy(factor, event.clientX, event.clientY);
    }
  }, [zoomBy]);

  const onBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-canvas-node],[data-canvas-hud]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({ kind: "pan", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: view, moved: false });
  };

  const onNodePointerDown = (event: ReactPointerEvent<HTMLElement>, node: CanvasNode) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, [role='switch'], a, input")) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesture({
      kind: "node",
      pointerId: event.pointerId,
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: node.x, y: node.y },
      moved: false,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const moved = gesture.moved || Math.hypot(dx, dy) >= DRAG_THRESHOLD;
    if (!moved) return;
    if (!gesture.moved) setGesture({ ...gesture, moved: true });

    if (gesture.kind === "pan") {
      setView({ ...gesture.origin, x: Math.round(gesture.origin.x + dx), y: Math.round(gesture.origin.y + dy) });
    } else {
      const nextPos = {
        x: Math.round(gesture.origin.x + dx / view.scale),
        y: Math.round(gesture.origin.y + dy / view.scale),
      };
      setPositions((prev) => ({ ...prev, [gesture.nodeId]: nextPos }));
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.kind === "node") {
      if (gesture.moved) {
        saveCanvasPositions(positions);
      } else {
        const node = nodeById.get(gesture.nodeId);
        if (node) {
          setSelectedNodeId(node.id);
          if (node.kind === "job" || node.kind === "trigger") {
            onSelectAutomation(node.automationId);
          } else {
            onSelectAutomation(null);
          }
        }
      }
    } else if (!gesture.moved) {
      setSelectedNodeId(null);
      onSelectAutomation(null);
    }
    setGesture(null);
  };

  const resetLayout = () => {
    setPositions({});
    saveCanvasPositions({});
    fittedRef.current = false;
    requestAnimationFrame(() => fitToViewport());
  };

  const activeCount = automations.filter((a) => a.enabled).length;
  const pausedCount = automations.length - activeCount;
  const runningCount = automations.filter((a) => a.runs.some((run) => run.status === "running")).length;

  if (automations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-hairline/50 bg-card text-accent">
          <Zap size={24} />
        </div>
        <h2 className="text-[17px] font-semibold text-ink">No automations on the canvas yet</h2>
        <p className="mt-1.5 max-w-sm text-[13px] text-ink-secondary">
          Add a schedule, webhook, or app trigger to see your bots, live jobs, and connected systems wired together here.
        </p>
        <button
          type="button"
          onClick={onNewAutomation}
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-ink hover:brightness-110"
        >
          <Plus size={15} /> New automation
        </button>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      data-testid="automations-canvas"
      onWheel={onCanvasWheel}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setGesture(null)}
      className={cn(
        "relative min-h-0 flex-1 overflow-hidden select-none bg-inset",
        gesture?.kind === "pan" ? "cursor-grabbing" : "cursor-grab",
      )}
      style={{
        backgroundImage: "radial-gradient(circle, rgba(148,163,184,0.16) 1px, transparent 1px)",
        backgroundSize: `${Math.max(12, Math.round(24 * view.scale))}px ${Math.max(12, Math.round(24 * view.scale))}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      {/* Inline keyframes for flowing active wires */}
      <style>{`
        @keyframes ombWireFlow {
          from { stroke-dashoffset: 24; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      {/* World transform layer */}
      <div
        className="absolute inset-0 origin-top-left"
        style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})` }}
      >
        {/* Lane headers */}
        {(
          [
            { x: COLUMN_X.trigger, label: "TRIGGERS", sub: "Schedules & Events" },
            { x: COLUMN_X.bot, label: "AGENTS", sub: "Autonomous Bots" },
            { x: COLUMN_X.job, label: "ACTIVE JOBS", sub: "What They Run" },
            { x: COLUMN_X.system, label: "CONNECTED SYSTEMS", sub: "Data & Outputs" },
          ] as const
        ).map((lane) => (
          <div key={lane.label} className="pointer-events-none absolute top-4 flex items-baseline gap-2" style={{ left: lane.x }}>
            <span className="text-[10px] font-bold tracking-[0.14em] text-ink-tertiary">{lane.label}</span>
            <span className="text-[11px] text-ink-tertiary/60">{lane.sub}</span>
          </div>
        ))}

        {/* SVG Bezier Wires */}
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {graph.edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            const isHighlighted = highlight.edges.has(edge.id);
            const dimmed = hasHighlight && !isHighlighted;
            const { d, x1, y1, x2, y2 } = wirePath(from, to, edge.tone === "oversight");
            const stroke = edgeStroke(edge, isHighlighted);
            const width = edge.tone === "running" || isHighlighted ? 2.4 : 1.75;
            return (
              <g key={edge.id} style={{ opacity: dimmed ? 0.18 : 1, transition: "opacity 160ms ease" }}>
                <path
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={width}
                  strokeDasharray={edge.animated ? "6 6" : edge.dashed ? "5 5" : undefined}
                  style={edge.animated ? { animation: "ombWireFlow 0.85s linear infinite" } : undefined}
                />
                <circle cx={x1} cy={y1} r={3.5} fill={stroke} />
                <circle cx={x2} cy={y2} r={3.5} fill={stroke} />
              </g>
            );
          })}
        </svg>

        {/* Nodes */}
        {graph.nodes.map((node) => {
          const isHighlighted = highlight.nodes.has(node.id);
          const dimmed = hasHighlight && !isHighlighted;
          const isSelected = selectedNodeId === node.id || (selectedAutomationId !== null && ((node.kind === "job" || node.kind === "trigger") && node.automationId === selectedAutomationId));

          return (
            <div
              key={node.id}
              data-canvas-node={node.kind}
              data-node-id={node.id}
              onPointerDown={(e) => onNodePointerDown(e, node)}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId((curr) => (curr === node.id ? null : curr))}
              style={{
                left: node.x,
                top: node.y,
                width: node.width,
                minHeight: node.height,
                opacity: dimmed ? 0.32 : 1,
                transition: gesture?.kind === "node" && gesture.nodeId === node.id ? "none" : "opacity 160ms ease, box-shadow 160ms ease",
              }}
              className={cn(
                "absolute cursor-grab active:cursor-grabbing rounded-2xl border bg-card/95 backdrop-blur-md shadow-md",
                isSelected
                  ? "border-accent ring-2 ring-accent/25 shadow-lg"
                  : isHighlighted
                    ? "border-emerald-400/60 shadow-lg"
                    : "border-hairline/55 hover:border-ink-secondary/45",
              )}
            >
              {node.kind === "trigger" && <TriggerNodeCard node={node} />}
              {node.kind === "bot" && (
                <BotNodeCard
                  node={node}
                  instances={state.instances}
                  onOpenChat={() => openBot(dispatch, node.bot, showThreads)}
                />
              )}
              {node.kind === "job" && (
                <JobNodeCard
                  node={node}
                  busyAction={busyAction}
                  onRunNow={() => onRunNow(node.automation)}
                  onToggle={() => onToggle(node.automation)}
                />
              )}
              {node.kind === "system" && <SystemNodeCard node={node} />}
            </div>
          );
        })}
      </div>

      {/* Floating top-left live summary pill */}
      <div
        data-canvas-hud
        className="pointer-events-auto absolute left-4 top-4 z-10 flex items-center gap-3 rounded-full border border-hairline/50 bg-panel/90 px-3.5 py-1.5 text-[12px] text-ink-secondary shadow-lg backdrop-blur-md"
      >
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <span className={cn("size-2 rounded-full", runningCount > 0 ? "animate-pulse bg-emerald-400" : activeCount > 0 ? "bg-emerald-400" : "bg-ink-tertiary")} />
          {runningCount > 0 ? `${runningCount} running` : `${activeCount} active`}
        </span>
        {pausedCount > 0 && <span className="text-ink-tertiary">{pausedCount} paused</span>}
        <span className="text-hairline">|</span>
        <span>{graph.nodes.filter((n) => n.kind === "bot").length} bots</span>
        <span className="text-hairline">|</span>
        <span>{graph.nodes.filter((n) => n.kind === "system").length} connected systems</span>
      </div>

      {/* Floating bottom-left zoom & layout controls */}
      <div
        data-canvas-hud
        className="pointer-events-auto absolute bottom-4 left-4 z-10 flex items-center gap-1 rounded-xl border border-hairline/50 bg-panel/90 p-1 text-ink-secondary shadow-lg backdrop-blur-md"
      >
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.15)}
          aria-label="Zoom out"
          title="Zoom out"
          className="flex size-8 items-center justify-center rounded-lg hover:bg-control hover:text-ink"
        >
          <Minus size={14} />
        </button>
        <span className="min-w-[44px] text-center font-mono text-[11px] text-ink">{Math.round(view.scale * 100)}%</span>
        <button
          type="button"
          onClick={() => zoomBy(1.15)}
          aria-label="Zoom in"
          title="Zoom in"
          className="flex size-8 items-center justify-center rounded-lg hover:bg-control hover:text-ink"
        >
          <Plus size={14} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-hairline/50" />
        <button
          type="button"
          onClick={fitToViewport}
          aria-label="Fit canvas to view"
          title="Fit to screen"
          className="flex size-8 items-center justify-center rounded-lg hover:bg-control hover:text-ink"
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          onClick={resetLayout}
          aria-label="Reset node positions"
          title="Reset layout"
          className="flex size-8 items-center justify-center rounded-lg hover:bg-control hover:text-ink"
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}

function TriggerNodeCard({ node }: { node: TriggerNodeData }) {
  const Icon = node.automationKind === "webhook" ? Webhook : node.automationKind === "app" ? Zap : Clock;
  return (
    <div className="flex h-full flex-col justify-between p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-inset px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-secondary">
          <Icon size={11} className={node.enabled ? "text-emerald-400" : "text-ink-tertiary"} />
          {node.automationKind === "schedule" ? "Schedule" : node.automationKind === "webhook" ? "Webhook" : "App Event"}
        </span>
        <StatusMark status={node.status} />
      </div>
      <div className="mt-2 truncate text-[13px] font-semibold text-ink" title={node.title}>
        {node.title}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-ink-secondary">{node.subtitle}</div>
    </div>
  );
}

function BotNodeCard({
  node,
  instances,
  onOpenChat,
}: {
  node: BotNodeData;
  instances: ReturnType<typeof useStore>["state"]["instances"];
  onOpenChat: () => void;
}) {
  const { bot } = node;
  const status = teamMapStatus(bot);
  const liveStep = currentBotStep(bot, instances);
  const instance = instances.find((item) => item.instanceId === bot.modelSelection.instanceId);
  const model = instance?.models.options.find((item) => item.id === bot.modelSelection.model)?.label ?? bot.modelSelection.model;

  return (
    <div className="flex h-full flex-col justify-between p-3.5">
      <div className="flex items-center gap-2.5">
        <BotAvatar bot={bot} size={36} motion="none" motionKey={0} animated={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-ink">{bot.name}</span>
            {bot.chiefOfStaff && <Crown size={12} className="shrink-0 text-amber-400" />}
          </div>
          <div className="truncate text-[11px] text-ink-secondary">
            {bot.title || (bot.chiefOfStaff ? "Desk PM · Chief of Staff" : "Specialist Bot")}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenChat}
          aria-label={`Open chat with ${bot.name}`}
          title={`Open chat with ${bot.name}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink"
        >
          <MessageCircle size={13} />
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-hairline/30 pt-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-1.5 text-ink-secondary">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              bot.busy
                ? "animate-pulse bg-emerald-400"
                : status.tone === "warning"
                  ? "bg-amber-400"
                  : status.tone === "danger"
                    ? "bg-rose-500"
                    : "bg-emerald-500/60",
            )}
          />
          <span className="truncate">{liveStep || (node.supervisorOnly ? "Overseeing desk" : bot.busy ? "Working…" : `${node.automationCount} job${node.automationCount === 1 ? "" : "s"}`)}</span>
        </span>
        <span className="shrink-0 rounded-md bg-inset px-1.5 py-0.5 text-[10px] text-ink-tertiary">{model}</span>
      </div>
    </div>
  );
}

function JobNodeCard({
  node,
  busyAction,
  onRunNow,
  onToggle,
}: {
  node: JobNodeData;
  busyAction: string | null;
  onRunNow: () => void;
  onToggle: () => void;
}) {
  const { automation } = node;
  const runBusy = busyAction === `run:${automation.id}`;
  const toggleBusy = busyAction === `toggle:${automation.id}`;

  return (
    <div className="flex h-full flex-col justify-between p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StatusMark status={node.status} />
            <span className="truncate text-[13.5px] font-semibold text-ink" title={automation.name}>
              {automation.name || "Untitled Automation"}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-secondary">{node.summary}</p>
        </div>
        {node.status.state !== "done" && (
          <Switch
            checked={automation.enabled}
            disabled={toggleBusy}
            aria-label={`Toggle ${automation.name}`}
            onClick={onToggle}
            className="mt-0.5 shrink-0"
          />
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-hairline/30 pt-2">
        <span className="min-w-0 truncate text-[11px] text-ink-tertiary" title={node.statusLine}>
          {node.running ? "Running live now…" : node.statusLine}
        </span>
        <button
          type="button"
          disabled={runBusy || node.running}
          onClick={onRunNow}
          title="Run now"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-hairline/50 bg-inset px-2 py-1 text-[11px] font-medium text-ink hover:border-accent/60 hover:text-accent-text disabled:opacity-45"
        >
          <Play size={10} className="fill-current" />
          Run
        </button>
      </div>
    </div>
  );
}

function SystemNodeCard({ node }: { node: SystemNodeData }) {
  const Icon = SYSTEM_ICONS[node.icon] ?? Database;
  return (
    <div className="flex h-full items-center gap-3 p-3.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-hairline/50 bg-inset text-emerald-400">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink" title={node.label}>
          {node.label}
        </div>
        <div className="truncate text-[11px] text-ink-secondary" title={node.detail}>
          {node.detail}
        </div>
      </div>
    </div>
  );
}
