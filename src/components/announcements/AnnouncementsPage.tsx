import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Cloud, Gift, GitBranch, GitMerge, Loader2, Megaphone, RefreshCw, Rocket, ShieldCheck, Square, UsersRound, X } from "lucide-react";
import type { CloudOffer } from "../../../electron/cloud-home.mjs";
import { itemSeen, rememberNoticeSeen, withDownloadedUpdate, type HistoryAction, type HistoryItem, type HistoryMark, type HistoryModal } from "@/lib/announcement-history";
import { refreshAnnouncements } from "@/lib/announcements";
import { appVersion, desktopAppVersion } from "@/lib/app-links";
import { openEmailDraft, openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import {
  cancelBackgroundForkUpdate,
  checkForkUpdates,
  dismissBackgroundForkUpdate,
  fetchForkUpdateStatus,
  formatElapsed,
  isNewerVersion,
  restartForkServer,
  startBackgroundForkUpdate,
  waitForServerRestart,
  type ForkUpdateJobView,
  type ForkUpdateStatus,
} from "@/lib/fork-update";
import { EARLIER_WHATS_NEW_NOTICE } from "@/lib/notices";
import { activeLocale, t } from "@/lib/i18n";
import { reportTeams, teamsAction } from "@/lib/teams-whats-new";
import { installUpdate, useUpdaterState } from "@/lib/updater";
import { reportWhatsNew, WHATS_NEW_SOURCES, whatsNewView, type WhatsNewView } from "@/lib/whats-new";
import { useStore } from "@/state/store";
import { localized, type AnnouncementAction, type AnnouncementPlace } from "../../../shared/announcements";
import type { ReleaseEntry } from "../../../shared/release-notes";
import { announcementPlaceAction, KIND_ICON, MARK } from "../AnnouncementCard";
import { GrokBotMark } from "../GrokBotMark";
import { GrokMovePopup } from "../GrokMovePopup";
import { GrokMoveDialog } from "../lazy-screens";
import { PRIMARY_BUTTON } from "../NoticeCard";
import { ModelgoMark, type IconProps } from "../ProviderIcons";
import { TOOL_PAGE_TITLE, ToolPage, ToolPageHeader } from "../ToolPageShell";
import { TeamsPopup } from "../whats-new/TeamsPopup";
import { WhatsNewPopup } from "../whats-new/WhatsNewPopup";
import { BODY_TEXT, CHIP, DATE_TEXT, downloadedUpdate, MARK_TILE, QUIET_BUTTON, ReleaseRow, TITLE_TEXT, type ReleaseContext } from "./ReleaseRow";
import { useAnnouncements, type Announcements } from "./use-announcements";

const BUILT_IN_MARK: Record<HistoryMark, ComponentType<IconProps>> = {
  teams: UsersRound, cloud: Cloud, boat: Gift, modelgo: ModelgoMark, grok: GrokBotMark, "product-hunt": Rocket,
};
type NoticeItem = Exclude<HistoryItem, { source: "release" }>;

/** A button that opens what an announcement's own notice opens, never anything else. */
export interface AnnouncementRun {
  url: (url: string) => void;
  email: (url: string) => void;
  place: (place: AnnouncementPlace) => void;
  cloudAdd: (action: Extract<HistoryAction, { cloud_add: unknown }>["cloud_add"]) => void;
  cloudHowTo: () => void;
}

function run(action: HistoryAction | AnnouncementAction, to: AnnouncementRun) {
  if ("open_url" in action) to.url(action.open_url);
  else if ("email" in action) to.email(action.email);
  else if ("open" in action) to.place(action.open);
  else if ("cloud_add" in action) to.cloudAdd(action.cloud_add);
  else to.cloudHowTo();
}

const dateText = (at: number, locale: string) => {
  try { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(at); } catch { return new Date(at).toISOString().slice(0, 10); }
};

function Mark({ item }: { item: NoticeItem }) {
  const Icon = item.source === "built-in" ? BUILT_IN_MARK[item.entry.mark] : item.card.image && "mark" in item.card.image ? MARK[item.card.image.mark] : KIND_ICON[item.card.kind];
  return <span aria-hidden="true" className={MARK_TILE}><Icon size={18} /></span>;
}

/** One announcement: its date, mark, title and line or two, and its own buttons; a popup's row opens the popup again. */
function Row({ item, locale, onModal, canReopen, to }: {
  item: NoticeItem; locale: string; onModal: (modal: HistoryModal) => void; canReopen: (modal: HistoryModal) => boolean; to: AnnouncementRun;
}) {
  const title = item.source === "built-in" ? t(item.entry.title) : localized(item.card.title, locale);
  const body = item.source === "built-in" ? t(item.entry.body) : localized(item.card.body, locale);
  const words = <>
    <time dateTime={new Date(item.at).toISOString()} className={DATE_TEXT}>{dateText(item.at, locale)}</time>
    <span className={TITLE_TEXT}>{title}</span>
    <span className={BODY_TEXT}>{body}</span>
  </>;
  const modal = item.source === "built-in" && "modal" in item.entry.open ? item.entry.open.modal : null;
  if (modal && canReopen(modal)) {
    return <li data-announcement-item={item.id}>
      <button type="button" onClick={() => onModal(modal)} className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-start transition-colors hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:outline-focus">
        <Mark item={item} />
        <span className="min-w-0 flex-1">{words}</span>
        <span className="ui-button ui-button-sm pointer-events-none mt-4 shrink-0 rounded-full px-3 text-[12px]">{t("announcements.showAgain")}</span>
      </button>
    </li>;
  }
  let buttons: ReactNode = null;
  if (item.source === "built-in" && item.ended) buttons = <span data-announcement-ended className={CHIP}>{t("announcements.ended")}</span>;
  else if (item.source === "built-in" && "buttons" in item.entry.open) {
    buttons = item.entry.open.buttons.map((button, index) => <button key={button.label} type="button" className={index === 0 ? PRIMARY_BUTTON : QUIET_BUTTON}
      onClick={() => run(button.action, to)}>{t(button.label)}</button>);
  } else if (item.source === "feed") {
    buttons = [item.card.primary, item.card.secondary].flatMap((button, index) => button ? [<button key={index} type="button" className={index === 0 ? PRIMARY_BUTTON : QUIET_BUTTON}
      onClick={() => run(button.action, to)}>{localized(button.label, locale)}</button>] : []);
  }
  return <li data-announcement-item={item.id} className="flex items-start gap-3 px-3 py-3">
    <Mark item={item} />
    <div className="min-w-0 flex-1">
      {words}
      {buttons && <div className="mt-2.5 flex flex-wrap items-center gap-2">{buttons}</div>}
    </div>
  </li>;
}

/** The list itself, as the page draws it: newest first. */
export function AnnouncementList({ items, locale = activeLocale(), onModal, canReopen = () => true, to, release = { installed: appVersion(), updater: null }, onRestart = () => {} }: {
  items: readonly HistoryItem[]; locale?: string; onModal: (modal: HistoryModal) => void; canReopen?: (modal: HistoryModal) => boolean; to: AnnouncementRun;
  release?: ReleaseContext; onRestart?: () => void;
}) {
  if (!items.length) {
    return <section aria-label={t("announcements.empty")} className="px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Megaphone size={22} /></div>
      <p className="text-[14px] text-ink-secondary">{t("announcements.empty")}</p>
    </section>;
  }
  return <ul aria-label={t("announcements.title")} className="flex flex-col divide-y divide-hairline/40 rounded-2xl border border-hairline/50 bg-card/40">
    {items.map(item => item.source === "release"
      ? <ReleaseRow key={`${item.source}:${item.id}`} item={item} date={dateText(item.at, locale)} context={release} onRestart={onRestart} />
      : <Row key={`${item.source}:${item.id}`} item={item} locale={locale} onModal={onModal} canReopen={canReopen} to={to} />)}
  </ul>;
}

/** The earlier What's new needs this desktop's Cloud account and the Admin's offer to say anything; null when it has nothing
 * for this account. */
function useWhatsNewView(found: Announcements, listed: boolean): WhatsNewView | null {
  const bridge = found.cloudBridge ? window.ogb?.cloudAccount : undefined;
  const [offer, setOffer] = useState<CloudOffer | null | undefined>(undefined);
  useEffect(() => {
    if (!listed || !bridge?.offer) return;
    let active = true;
    void bridge.offer().then(next => { if (active) setOffer(next); }, () => { if (active) setOffer(null); });
    return () => { active = false; };
  }, [listed, bridge]);
  const view = listed && bridge?.offer ? whatsNewView(found.account, offer) : "none";
  return typeof view === "object" ? view : null;
}

/** A popup from the list, opened again outside the notice queue: nothing about the queue's launch changes. */
function Replay({ modal, found, whatsNew, onClose }: { modal: HistoryModal; found: Announcements; whatsNew: WhatsNewView | null; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [moving, setMoving] = useState(false);
  const item = found.items.find(entry => entry.source === "built-in" && "modal" in entry.entry.open && entry.entry.open.modal === modal);
  const done = () => {
    if (item && !itemSeen(item, found.person)) rememberNoticeSeen(item.id, found.person.record, found.writer);
    onClose();
  };
  if (modal === "teams") {
    const action = teamsAction({ team: state.config?.team, viewer: found.viewer, account: found.account, canAddCloud: found.cloudBridge });
    return <TeamsPopup action={action} onStep={step => reportTeams(step, action)} onDone={done}
      onStart={() => dispatch({ type: "openCloudAdd", source: WHATS_NEW_SOURCES.team })} />;
  }
  if (modal === "whats-new") {
    if (!whatsNew) return null;
    return <WhatsNewPopup view={whatsNew} report={(action, slide) => reportWhatsNew(action, slide, whatsNew, EARLIER_WHATS_NEW_NOTICE)} onDone={done}
      onBuy={slide => dispatch({ type: "openCloudAdd", source: WHATS_NEW_SOURCES[slide] })} />;
  }
  if (moving) return <GrokMoveDialog onClose={onClose} />;
  return <GrokMovePopup onDone={action => { if (action === "start") setMoving(true); else done(); }} />;
}

/** Inline status panel for a silent background AI update (running, succeeded, failed, or cancelled). */
function BackgroundUpdateProgress({
  job,
  nowMs,
  restarting,
  onCancel,
  onDismiss,
  onRestart,
}: {
  job: ForkUpdateJobView;
  nowMs: number;
  restarting: boolean;
  onCancel: () => void;
  onDismiss: () => void;
  onRestart: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const running = job.status === "running";
  const succeeded = job.status === "succeeded";
  const failed = job.status === "failed";
  const elapsed = formatElapsed(job.startedAt, job.finishedAt, nowMs);
  const hasDetails = Boolean(job.summary || job.log.length > 1);

  return (
    <div
      data-fork-job={job.status}
      className={cn(
        "mt-3 rounded-xl border px-3.5 py-3 text-[12.5px]",
        running && "border-accent/30 bg-accent/[0.06]",
        succeeded && "border-emerald-500/30 bg-emerald-500/[0.06]",
        failed && "border-rose-500/30 bg-rose-500/[0.06]",
        job.status === "cancelled" && "border-hairline/60 bg-ink/[0.03]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {running && <Loader2 size={14} aria-hidden className="shrink-0 animate-spin text-accent" />}
          {succeeded && <CheckCircle2 size={14} aria-hidden className="shrink-0 text-emerald-400" />}
          {failed && <AlertCircle size={14} aria-hidden className="shrink-0 text-rose-400" />}
          <span className="font-medium text-ink">
            {running && `Updating v${job.fromVersion} → v${job.targetVersion} in background`}
            {succeeded && `Updated to v${job.targetVersion} in background`}
            {failed && `Background update to v${job.targetVersion} failed`}
            {job.status === "cancelled" && `Update to v${job.targetVersion} cancelled`}
          </span>
          <span className="font-mono text-[11.5px] text-ink-tertiary">{elapsed}</span>
          {job.backupTag && (
            <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 font-mono text-[11px] text-ink-secondary">
              backup: {job.backupTag}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasDetails && (
            <button
              type="button"
              data-fork-job-details-toggle
              className="ui-button min-h-7 gap-1 px-2.5 py-1 text-[12px]"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((open) => !open)}
            >
              {showDetails ? "Hide details" : "Details"}
              <ChevronDown size={12} aria-hidden className={cn("transition-transform", showDetails && "rotate-180")} />
            </button>
          )}
          {running && (
            <button
              type="button"
              data-fork-job-cancel
              className="ui-button min-h-7 gap-1 px-2.5 py-1 text-[12px] text-rose-300"
              onClick={onCancel}
            >
              <Square size={11} aria-hidden />
              Cancel
            </button>
          )}
          {succeeded && job.needsRestart && (
            <button
              type="button"
              data-fork-job-restart
              className={PRIMARY_BUTTON}
              disabled={restarting}
              onClick={onRestart}
            >
              <RefreshCw size={13} aria-hidden className={cn(restarting && "animate-spin")} />
              {restarting ? "Restarting server…" : "Restart server & reload"}
            </button>
          )}
          {!running && (
            <button
              type="button"
              data-fork-job-dismiss
              aria-label="Dismiss update status"
              className="ui-button min-h-7 px-2 py-1 text-ink-tertiary hover:text-ink"
              onClick={onDismiss}
            >
              <X size={13} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {running && job.currentStep && (
        <p data-fork-job-step className="mt-1.5 truncate text-[12px] text-ink-secondary">
          {job.currentStep}
        </p>
      )}
      {failed && job.error && (
        <p role="alert" className="mt-1.5 text-[12px] text-rose-300">
          {job.error}
        </p>
      )}
      {succeeded && !showDetails && job.summary && (
        <p className="mt-1.5 line-clamp-2 text-[12px] text-ink-secondary">
          {job.summary}
        </p>
      )}
      {showDetails && (
        <div data-fork-job-details className="mt-2.5 space-y-2 border-t border-hairline/40 pt-2.5">
          {job.summary && (
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-ink/[0.04] p-2.5 font-sans text-[12px] leading-[18px] text-ink-secondary">
              {job.summary}
            </pre>
          )}
          {job.log.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-ink/[0.04] p-2.5 font-mono text-[11px] leading-[16px] text-ink-tertiary">
              {job.log.map((line, index) => (
                <li key={index} className="truncate">{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact status card for local git forks: shows installed vs upstream version, manual check, and silent background AI merge. */
function ForkUpdateBanner({
  status,
  checking,
  startingVersion,
  restarting,
  nowMs,
  error,
  latestRelease,
  onCheck,
  onUpdate,
  onCancel,
  onDismiss,
  onRestart,
}: {
  status: ForkUpdateStatus;
  checking: boolean;
  startingVersion: string | null;
  restarting: boolean;
  nowMs: number;
  error: string | null;
  latestRelease: ReleaseEntry | null;
  onCheck: () => void;
  onUpdate: (version: string, release: ReleaseEntry | null) => void;
  onCancel: () => void;
  onDismiss: () => void;
  onRestart: () => void;
}) {
  const newestVersion = latestRelease && isNewerVersion(latestRelease.version, status.installedVersion)
    ? latestRelease.version
    : status.latestTag && isNewerVersion(status.latestTag, status.installedVersion)
      ? status.latestTag
      : null;
  const hasUpstreamWork = Boolean(newestVersion) || status.behindCount > 0;
  const targetVersion = newestVersion ?? "upstream/main";
  const targetLabel = newestVersion ? `v${newestVersion}` : "upstream/main";
  const matchingRelease = newestVersion && latestRelease?.version === newestVersion ? latestRelease : null;
  const job = status.job ?? null;
  const running = job?.status === "running" || startingVersion !== null;
  const canLaunch = status.canBackgroundUpdate !== false;

  return (
    <section
      data-fork-update-banner
      aria-label="Fork upstream updates"
      className="mb-4 rounded-2xl border border-hairline/60 bg-card/60 px-4 py-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <GitBranch size={14} className="text-accent" aria-hidden />
              {status.originRemote ?? "Local fork"}
            </span>
            <span className={CHIP}>v{status.installedVersion}</span>
            {hasUpstreamWork ? (
              <span className="rounded-full bg-accent/12 px-2.5 py-0.5 text-[12px] font-medium text-accent">
                {newestVersion ? `${targetLabel} available` : `${status.behindCount} upstream commits`}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[12px] font-medium text-emerald-400">
                Up to date
              </span>
            )}
            {status.dirty && (
              <span className="rounded-full bg-amber-500/12 px-2.5 py-0.5 text-[12px] text-amber-400">
                Uncommitted edits
              </span>
            )}
          </div>
          <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-[18px] text-ink-secondary">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden />
            <span>
              Runs silently in the background (no chat thread opened) — creates a backup tag, merges via{" "}
              <code className="rounded bg-ink/[0.06] px-1 font-mono text-[11.5px]">FORK_MANIFEST.md</code>,
              and verifies your Trading Desk Canvas, bots, and custom tweaks stay intact.
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-fork-check
            className={QUIET_BUTTON}
            disabled={checking || running || restarting}
            onClick={onCheck}
          >
            <RefreshCw size={14} aria-hidden className={cn(checking && "animate-spin")} />
            {checking ? "Checking…" : "Check for updates"}
          </button>
          {hasUpstreamWork && canLaunch && (
            <button
              type="button"
              data-fork-update-latest
              className={PRIMARY_BUTTON}
              disabled={running || restarting}
              onClick={() => onUpdate(targetVersion, matchingRelease)}
            >
              {running ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <GitMerge size={14} aria-hidden />}
              {running ? "Updating in background…" : `Update to ${targetLabel} with AI`}
            </button>
          )}
        </div>
      </div>
      {job && (
        <BackgroundUpdateProgress
          job={job}
          nowMs={nowMs}
          restarting={restarting}
          onCancel={onCancel}
          onDismiss={onDismiss}
          onRestart={onRestart}
        />
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-rose-400">
          {error}
        </p>
      )}
    </section>
  );
}

/** Everything announced to this person, newest first. Opening it clears the red dot (here and on their other pages). */
export function AnnouncementsPage() {
  const { dispatch } = useStore();
  const found = useAnnouncements();
  const [open, setOpen] = useState<HistoryModal | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const updater = useUpdaterState();
  const [openedAt] = useState(Date.now);
  const [forkStatus, setForkStatus] = useState<ForkUpdateStatus | null>(null);
  const [checkingFork, setCheckingFork] = useState(false);
  const [startingVersion, setStartingVersion] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now);
  const [forkError, setForkError] = useState<string | null>(null);

  const items = withDownloadedUpdate(found.items, downloadedUpdate(updater, openedAt), found.branded, openedAt);
  const whatsNew = useWhatsNewView(found, found.items.some(item => item.source === "built-in" && "modal" in item.entry.open && item.entry.open.modal === "whats-new"));
  const latestRelease = items.find((item): item is Extract<HistoryItem, { source: "release" }> => item.source === "release")?.release ?? null;
  const activeJob = forkStatus?.job ?? null;
  const isJobRunning = activeJob?.status === "running";

  useEffect(() => { back.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => { if (found.unread) found.markRead(); }, [found.unread]);
  useEffect(() => {
    let active = true;
    void fetchForkUpdateStatus().then((next) => {
      if (active && next?.isFork) setForkStatus(next);
    });
    return () => { active = false; };
  }, []);

  // Poll silent background job status every 2.5s while running and tick the elapsed clock.
  useEffect(() => {
    if (!isJobRunning) return;
    let active = true;
    const poll = window.setInterval(() => {
      void fetchForkUpdateStatus().then((next) => {
        if (!active || !next?.isFork) return;
        setForkStatus(next);
        if (next.job?.status !== "running") {
          void refreshAnnouncements();
        }
      });
    }, 2_500);
    const tick = window.setInterval(() => {
      if (active) setNowMs(Date.now());
    }, 1_000);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [isJobRunning]);

  const handleCheckForkUpdates = async () => {
    setCheckingFork(true);
    setForkError(null);
    try {
      const [next] = await Promise.all([checkForkUpdates(), refreshAnnouncements()]);
      if (next?.isFork) setForkStatus(next);
    } catch (error) {
      setForkError(error instanceof Error ? error.message : "Could not check upstream updates.");
    } finally {
      setCheckingFork(false);
    }
  };

  const handleForkUpdate = async (targetVersion: string, release: ReleaseEntry | null) => {
    if (!forkStatus || isJobRunning || startingVersion) return;
    setStartingVersion(targetVersion);
    setForkError(null);
    setNowMs(Date.now());
    try {
      const job = await startBackgroundForkUpdate({ targetVersion, release });
      setForkStatus((prev) => (prev ? { ...prev, job } : prev));
    } catch (error) {
      setForkError(error instanceof Error ? error.message : "Could not start the background update.");
    } finally {
      setStartingVersion(null);
    }
  };

  const handleCancelForkUpdate = async () => {
    setForkError(null);
    try {
      const job = await cancelBackgroundForkUpdate();
      setForkStatus((prev) => (prev ? { ...prev, job } : prev));
    } catch (error) {
      setForkError(error instanceof Error ? error.message : "Could not cancel the update.");
    }
  };

  const handleDismissForkJob = async () => {
    setForkError(null);
    try {
      await dismissBackgroundForkUpdate();
      setForkStatus((prev) => (prev ? { ...prev, job: null } : prev));
    } catch (error) {
      setForkError(error instanceof Error ? error.message : "Could not dismiss update status.");
    }
  };

  const handleRestartServer = async () => {
    setRestarting(true);
    setForkError(null);
    try {
      await restartForkServer();
      const backUp = await waitForServerRestart();
      if (backUp) {
        window.location.reload();
      } else {
        setRestarting(false);
        setForkError("Server is still restarting — refresh the page in a few seconds.");
      }
    } catch (error) {
      setRestarting(false);
      setForkError(error instanceof Error ? error.message : "Could not restart the server.");
    }
  };

  const to: AnnouncementRun = {
    url: url => void openExternalLink(url).catch(() => undefined),
    email: url => void openEmailDraft(url).catch(() => undefined),
    place: place => dispatch(announcementPlaceAction(place)),
    cloudAdd: source => dispatch({ type: "openCloudAdd", source }),
    cloudHowTo: () => dispatch({ type: "cloudHowTo", open: true }),
  };

  const installedVersion = forkStatus?.isFork ? forkStatus.installedVersion : desktopAppVersion();
  const busyVersion = isJobRunning ? activeJob.targetVersion : startingVersion;
  const forkUpdateAction = forkStatus?.isFork && forkStatus.canBackgroundUpdate !== false
    ? { busyVersion, onUpdate: (release: ReleaseEntry) => void handleForkUpdate(release.version, release) }
    : null;

  return (
    <ToolPage label={t("announcements.title")}>
      <ToolPageHeader backLabel={t("automations.back")} onBack={() => dispatch({ type: "showChat" })} backRef={back}>
        <h1 className={TOOL_PAGE_TITLE}>{t("announcements.title")}</h1>
      </ToolPageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto" data-announcements={items.length}>
        <div className={cn("mx-auto w-full max-w-2xl p-4 sm:p-6")}>
          {forkStatus?.isFork && (
            <ForkUpdateBanner
              status={forkStatus}
              checking={checkingFork}
              startingVersion={startingVersion}
              restarting={restarting}
              nowMs={nowMs}
              error={forkError}
              latestRelease={latestRelease}
              onCheck={() => void handleCheckForkUpdates()}
              onUpdate={(version, release) => void handleForkUpdate(version, release)}
              onCancel={() => void handleCancelForkUpdate()}
              onDismiss={() => void handleDismissForkJob()}
              onRestart={() => void handleRestartServer()}
            />
          )}
          <AnnouncementList items={items} onModal={setOpen} canReopen={modal => modal !== "whats-new" || whatsNew !== null} to={to}
            release={{ installed: installedVersion, updater, forkUpdate: forkUpdateAction }}
            onRestart={() => void installUpdate().catch(() => undefined)} />
        </div>
      </div>
      {open && <Replay modal={open} found={found} whatsNew={whatsNew} onClose={() => setOpen(null)} />}
    </ToolPage>
  );
}
