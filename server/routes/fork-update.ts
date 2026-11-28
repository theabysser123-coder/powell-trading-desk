// Fork-aware OpenMausBot upstream update status, silent background AI updater, and restart routes.
// Runs updates on an ephemeral hidden bot task (never shown in chat, sidebar, or thread switcher),
// streams live step progress back to Announcements, deletes the hidden task on completion, and
// supports a clean 1-click systemd restart + browser reload.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { compareVersions } from "../../shared/announcements.ts";
import { announcementStore } from "../announcements/feed.ts";
import { releaseNotesStore } from "../announcements/release-notes.ts";
import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

const execFileAsync = promisify(execFile);

export const FORK_UPDATE_STATUS_PATH = "/api/fork-update/status";
export const FORK_UPDATE_CHECK_PATH = "/api/fork-update/check";
export const FORK_UPDATE_APPLY_PATH = "/api/fork-update/apply";
export const FORK_UPDATE_CANCEL_PATH = "/api/fork-update/cancel";
export const FORK_UPDATE_DISMISS_PATH = "/api/fork-update/dismiss";
export const FORK_UPDATE_RESTART_PATH = "/api/fork-update/restart";

export const FORK_UPDATE_THREAD_PREFIX = "fork-update-";

export const isForkUpdateTask = (task: { routineRunId?: string } | undefined | null): boolean =>
  typeof task?.routineRunId === "string" && task.routineRunId.startsWith(FORK_UPDATE_THREAD_PREFIX);

const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STATUS_CACHE_TTL_MS = 30_000;
const GIT_TIMEOUT_MS = 12_000;
const FETCH_TIMEOUT_MS = 35_000;
const MAX_LOG_LINES = 40;

export interface ForkUpdateJobView {
  id: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  fromVersion: string;
  targetVersion: string;
  startedAt: number;
  finishedAt: number | null;
  currentStep: string | null;
  log: string[];
  summary: string | null;
  error: string | null;
  backupTag: string | null;
  needsRestart: boolean;
}

export interface ForkUpdateStatus {
  isFork: boolean;
  installedVersion: string;
  branch: string;
  headSha: string;
  originRemote: string | null;
  upstreamRemote: string | null;
  aheadCount: number;
  behindCount: number;
  latestTag: string | null;
  dirty: boolean;
  repoPath: string;
  manifestPath: string;
  checkedAt: number;
  canBackgroundUpdate: boolean;
  job: ForkUpdateJobView | null;
}

export interface HiddenTurnMessage {
  role?: string;
  kind?: string;
  text?: string;
  tool?: { name?: string; summary?: string; ok?: boolean };
}

export interface ForkUpdateRunner {
  dataDir?: string;
  repoRoot?: string;
  findBot(): { id: string; name: string } | null;
  createHiddenTask(botId: string, routineRunId: string): { threadId: string } | null;
  deleteHiddenTask(botId: string, threadId: string): void;
  cleanupStaleTasks?(): void;
  messagesFor(threadId: string): readonly HiddenTurnMessage[];
  startTurn(
    botId: string,
    threadId: string,
    prompt: string,
    onSettled: (outcome: { ok: boolean; error?: string; text?: string }) => void,
  ): Promise<unknown>;
  interruptThread(botId: string, threadId: string, reason: string): Promise<void>;
  restartServer?: () => void;
}

interface InternalJob extends ForkUpdateJobView {
  botId: string;
  threadId: string | null;
  headBefore: string;
}

/** Normalize a GitHub/git remote URL to a clean "owner/repo" label. */
export function shortRemoteName(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim().replace(/\.git$/i, "");
  const ssh = /^[^@]+@[^:]+:(.+)$/.exec(trimmed);
  if (ssh) return ssh[1]!.replace(/^\/+/, "");
  const https = /^https?:\/\/[^/]+\/(.+)$/i.exec(trimmed);
  if (https) return https[1]!.replace(/^\/+/, "");
  return trimmed || null;
}

/** Pick the highest semver tag from a list of git tags like ["v0.1.184", "v0.1.181"]. */
export function pickLatestSemverTag(tags: readonly string[]): string | null {
  let best: string | null = null;
  for (const raw of tags) {
    const cleaned = raw.trim().replace(/^v/i, "");
    if (!/^\d+\.\d+\.\d+$/.test(cleaned)) continue;
    if (!best || (compareVersions(cleaned, best) ?? 0) > 0) best = cleaned;
  }
  return best;
}

/** Parse `git rev-list --left-right --count upstream/main...HEAD` output ("<behind>\t<ahead>"). */
export function parseAheadBehind(output: string): { behind: number; ahead: number } {
  const parts = output.trim().split(/\s+/);
  const behind = Number(parts[0]);
  const ahead = Number(parts[1]);
  return {
    behind: Number.isFinite(behind) && behind >= 0 ? behind : 0,
    ahead: Number.isFinite(ahead) && ahead >= 0 ? ahead : 0,
  };
}

const bareVersion = (version: string) => version.trim().replace(/^v/i, "");

export function buildServerForkUpdatePrompt(input: {
  targetVersion: string;
  installedVersion: string;
  repoPath: string;
  upstreamRemote: string | null;
  highlights?: readonly string[];
}): string {
  const target = bareVersion(input.targetVersion);
  const current = bareVersion(input.installedVersion);
  const tagRef = /^\d+\.\d+\.\d+$/.test(target) ? `v${target}` : target;
  const highlights = (input.highlights ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 3);
  return [
    `Update our OpenMausBot fork silently in the background from v${current} to ${tagRef} without breaking any of our custom setup.`,
    "",
    `Repo: ${input.repoPath}`,
    ...(input.upstreamRemote ? [`Upstream: ${input.upstreamRemote} (target ${tagRef})`] : []),
    ...(highlights.length ? [`Release highlights: ${highlights.join(" ")}`] : []),
    "",
    "Required safety checklist:",
    "1. Read FORK_MANIFEST.md first so every custom feature, route, asset, schema guard, and UX tweak is explicitly protected.",
    `2. Verify git status is clean (never discard local work) and create a safety backup tag (backup/pre-update-${tagRef}-<timestamp>) before merging.`,
    `3. Fetch upstream tags and merge ${tagRef} with git merge --no-ff (never reset or overwrite fork files). Resolve any conflicts keeping both the upstream improvements and all fork customizations.`,
    "4. Run pnpm install if dependencies changed, then run typechecks (tsc -b & tsc -p tsconfig.server.json), the fork/announcements/store Vitest suite, and npx vite build.",
    "5. Commit and push the verified update to origin/main. Do NOT restart powell-trading-desk.service yourself (the Announcements UI handles restart cleanly after you finish).",
    "6. End with a concise 3-5 bullet summary: versions updated, key upstream changes landed, conflicts resolved (if any), and the exact backup rollback tag.",
  ].join("\n");
}

function summarizeMessages(messages: readonly HiddenTurnMessage[]): { currentStep: string | null; log: string[]; lastReply: string | null } {
  const log: string[] = [];
  let lastReply: string | null = null;
  for (const msg of messages) {
    if (msg.role === "user") continue;
    if (msg.tool?.summary || msg.tool?.name) {
      const label = (msg.tool.summary || msg.tool.name || "").trim();
      if (label && log[log.length - 1] !== label) log.push(label);
    }
    const text = typeof msg.text === "string" ? msg.text.trim() : "";
    if (text && msg.role === "bot" && msg.kind !== "activity") {
      lastReply = text;
      const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean);
      if (firstLine && log[log.length - 1] !== firstLine) {
        log.push(firstLine.length > 160 ? `${firstLine.slice(0, 159)}…` : firstLine);
      }
    }
  }
  const trimmed = log.slice(-MAX_LOG_LINES);
  return { currentStep: trimmed[trimmed.length - 1] ?? null, log: trimmed, lastReply };
}

async function runGit(repoRoot: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoRoot,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

function readInstalledVersion(repoRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function latestBackupTag(repoRoot: string): Promise<string | null> {
  const raw = await runGit(repoRoot, ["tag", "--list", "backup/pre-update-*", "--sort=-creatordate"]);
  const first = raw?.split("\n").map((line) => line.trim()).find(Boolean);
  return first ?? null;
}

function defaultRestartServer(): void {
  const timer = setTimeout(() => {
    try {
      const child = spawn("systemctl", ["--user", "restart", "powell-trading-desk.service"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {
      // ignore if systemd user unit is unavailable
    }
  }, 350);
  timer.unref?.();
}

let runner: ForkUpdateRunner | null = null;
let currentJob: InternalJob | null = null;
let jobLoadedFromDisk = false;
let cachedStatus: { at: number; value: Omit<ForkUpdateStatus, "job" | "canBackgroundUpdate"> } | null = null;
let inflightStatus: Promise<Omit<ForkUpdateStatus, "job" | "canBackgroundUpdate">> | null = null;
let inflightRefresh: Promise<Omit<ForkUpdateStatus, "job" | "canBackgroundUpdate">> | null = null;

function jobFilePath(): string {
  return join(runner?.dataDir ?? DATA_DIR, "providers", "fork-update-job.json");
}

function toPublicJob(job: InternalJob | null): ForkUpdateJobView | null {
  if (!job) return null;
  if (job.status === "running" && job.threadId && runner) {
    const live = summarizeMessages(runner.messagesFor(job.threadId));
    return {
      id: job.id,
      status: job.status,
      fromVersion: job.fromVersion,
      targetVersion: job.targetVersion,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      currentStep: live.currentStep ?? job.currentStep,
      log: live.log.length ? live.log : job.log,
      summary: job.summary,
      error: job.error,
      backupTag: job.backupTag,
      needsRestart: job.needsRestart,
    };
  }
  return {
    id: job.id,
    status: job.status,
    fromVersion: job.fromVersion,
    targetVersion: job.targetVersion,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    currentStep: job.currentStep,
    log: job.log,
    summary: job.summary,
    error: job.error,
    backupTag: job.backupTag,
    needsRestart: job.needsRestart,
  };
}

function saveJobToDisk(): void {
  try {
    const path = jobFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic(path, JSON.stringify(toPublicJob(currentJob)));
  } catch {
    // non-fatal persistence failure
  }
}

function loadJobFromDisk(repoRoot: string): void {
  if (jobLoadedFromDisk) return;
  jobLoadedFromDisk = true;
  const path = jobFilePath();
  if (!existsSync(path)) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ForkUpdateJobView | null;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") return;
    const installed = readInstalledVersion(repoRoot);
    if (parsed.status === "running") {
      // Server restarted while an update was in flight; reconcile with disk version.
      const reached = compareVersions(bareVersion(installed), bareVersion(parsed.targetVersion)) === 0;
      currentJob = {
        ...parsed,
        status: reached ? "succeeded" : "failed",
        finishedAt: Date.now(),
        error: reached ? null : "The server restarted while the background update was running.",
        needsRestart: false,
        botId: "",
        threadId: null,
        headBefore: "",
      };
      saveJobToDisk();
      return;
    }
    // After a restart into the newly updated server, clear the "Restart to apply" flag.
    const needsRestart = parsed.status === "succeeded" && parsed.needsRestart
      ? (parsed.finishedAt !== null && Date.now() - parsed.finishedAt < 24 * 60 * 60 * 1000 && false)
      : false;
    currentJob = {
      ...parsed,
      needsRestart,
      botId: "",
      threadId: null,
      headBefore: "",
    };
  } catch {
    // ignore corrupt cache file
  }
}

export function configureForkUpdateRunner(next: ForkUpdateRunner): void {
  runner = next;
  jobLoadedFromDisk = false;
  currentJob = null;
  try {
    next.cleanupStaleTasks?.();
  } catch {
    // best-effort cleanup on boot
  }
  loadJobFromDisk(next.repoRoot ?? DEFAULT_REPO_ROOT);
}

/** Convenience wiring for server/index.ts so the entry file stays zero-growth under the line-count ratchet. */
export function wireForkUpdateRunner(deps: {
  dataDir: string;
  store: {
    bots: ReadonlyArray<{ id: string; name: string; hidden?: boolean; chiefOfStaff?: boolean; tasks?: ReadonlyArray<{ threadId: string; routineRunId?: string }> }>;
    createTask(
      botId: string,
      title?: string,
      activate?: boolean,
      projectId?: string,
      openedBy?: never,
      approvalMode?: never,
      modelSelection?: never,
      cwd?: string,
      beforeShown?: (task: { threadId: string; routineRunId?: string; archivedAt?: number }) => void,
    ): { threadId: string } | null;
    patchTask(botId: string, threadId: string, patch: { routineRunId?: string; archivedAt?: number }): unknown;
    messagesFor(threadId: string): readonly HiddenTurnMessage[];
  };
  deleteTasks(botId: string, threadIds: string[]): unknown;
  startTurn(
    botId: string,
    text: string,
    opts?: { threadId?: string; unattended?: boolean; onSettled?: (outcome: { ok: boolean; text: string }) => void },
  ): Promise<unknown>;
  interruptDirectThread(botId: string, threadId: string, cause?: string): Promise<void>;
}): void {
  configureForkUpdateRunner({
    dataDir: deps.dataDir,
    findBot: () => {
      const visible = deps.store.bots.filter((bot) => !bot.hidden);
      const chief = visible.find((bot) => bot.chiefOfStaff) ?? visible.find((bot) => /head of desk/i.test(bot.name)) ?? visible[0];
      return chief ? { id: chief.id, name: chief.name } : null;
    },
    createHiddenTask: (botId, routineRunId) => {
      const archivedAt = Date.now();
      // Stamp routineRunId + archivedAt in beforeShown so the very first store emit already
      // classifies this task as hidden (isForkUpdateTask === true) and never leaks it over SSE.
      const task = deps.store.createTask(
        botId,
        "Fork update",
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        (created) => {
          created.routineRunId = routineRunId;
          created.archivedAt = archivedAt;
        },
      );
      if (!task) return null;
      deps.store.patchTask(botId, task.threadId, { routineRunId, archivedAt });
      return { threadId: task.threadId };
    },
    deleteHiddenTask: (botId, threadId) => {
      deps.deleteTasks(botId, [threadId]);
    },
    cleanupStaleTasks: () => {
      for (const bot of deps.store.bots) {
        const stale = (bot.tasks ?? []).filter((task) => isForkUpdateTask(task)).map((task) => task.threadId);
        if (stale.length) deps.deleteTasks(bot.id, stale);
      }
    },
    messagesFor: (threadId) => deps.store.messagesFor(threadId),
    startTurn: (botId, threadId, prompt, onSettled) => deps.startTurn(botId, prompt, {
      threadId,
      unattended: true,
      onSettled: (outcome) => onSettled({ ok: outcome.ok, error: outcome.ok ? undefined : outcome.text, text: outcome.text }),
    }),
    interruptThread: (botId, threadId, reason) => deps.interruptDirectThread(botId, threadId, reason),
  });
}

async function inspectRepoStatus(repoRoot = DEFAULT_REPO_ROOT): Promise<Omit<ForkUpdateStatus, "job" | "canBackgroundUpdate">> {
  const installedVersion = readInstalledVersion(repoRoot);
  const manifestPath = join(repoRoot, "FORK_MANIFEST.md");
  const checkedAt = Date.now();

  const upstreamUrl = await runGit(repoRoot, ["remote", "get-url", "upstream"]);
  if (!upstreamUrl) {
    return {
      isFork: false,
      installedVersion,
      branch: "",
      headSha: "",
      originRemote: null,
      upstreamRemote: null,
      aheadCount: 0,
      behindCount: 0,
      latestTag: null,
      dirty: false,
      repoPath: repoRoot,
      manifestPath,
      checkedAt,
    };
  }

  const [originUrl, branch, headSha, aheadBehindRaw, tagsRaw, porcelain] = await Promise.all([
    runGit(repoRoot, ["remote", "get-url", "origin"]),
    runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGit(repoRoot, ["rev-parse", "--short", "HEAD"]),
    runGit(repoRoot, ["rev-list", "--left-right", "--count", "upstream/main...HEAD"]),
    runGit(repoRoot, ["tag", "--list", "v*"]),
    runGit(repoRoot, ["status", "--porcelain"]),
  ]);

  const { ahead, behind } = aheadBehindRaw ? parseAheadBehind(aheadBehindRaw) : { ahead: 0, behind: 0 };
  const latestTag = tagsRaw ? pickLatestSemverTag(tagsRaw.split("\n")) : null;

  return {
    isFork: true,
    installedVersion,
    branch: branch ?? "main",
    headSha: headSha ?? "",
    originRemote: shortRemoteName(originUrl),
    upstreamRemote: shortRemoteName(upstreamUrl),
    aheadCount: ahead,
    behindCount: behind,
    latestTag,
    dirty: Boolean(porcelain && porcelain.length > 0),
    repoPath: repoRoot,
    manifestPath,
    checkedAt,
  };
}

export async function inspectForkStatus(repoRoot = DEFAULT_REPO_ROOT): Promise<ForkUpdateStatus> {
  const base = await inspectRepoStatus(repoRoot);
  return {
    ...base,
    canBackgroundUpdate: Boolean(runner && runner.findBot()),
    job: toPublicJob(currentJob),
  };
}

async function getStatus(repoRoot = DEFAULT_REPO_ROOT, force = false): Promise<ForkUpdateStatus> {
  loadJobFromDisk(repoRoot);
  const now = Date.now();
  if (!force && cachedStatus && now - cachedStatus.at < STATUS_CACHE_TTL_MS) {
    return { ...cachedStatus.value, canBackgroundUpdate: Boolean(runner && runner.findBot()), job: toPublicJob(currentJob) };
  }
  if (!force && inflightStatus) {
    const value = await inflightStatus;
    return { ...value, canBackgroundUpdate: Boolean(runner && runner.findBot()), job: toPublicJob(currentJob) };
  }

  const task = inspectRepoStatus(repoRoot)
    .then((value) => {
      cachedStatus = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (inflightStatus === task) inflightStatus = null;
    });
  inflightStatus = task;
  const value = await task;
  return { ...value, canBackgroundUpdate: Boolean(runner && runner.findBot()), job: toPublicJob(currentJob) };
}

async function refreshUpstream(repoRoot = DEFAULT_REPO_ROOT): Promise<ForkUpdateStatus> {
  loadJobFromDisk(repoRoot);
  if (inflightRefresh) {
    const value = await inflightRefresh;
    return { ...value, canBackgroundUpdate: Boolean(runner && runner.findBot()), job: toPublicJob(currentJob) };
  }

  const task = (async () => {
    const upstreamUrl = await runGit(repoRoot, ["remote", "get-url", "upstream"]);
    await Promise.all([
      upstreamUrl ? runGit(repoRoot, ["fetch", "upstream", "--tags", "--prune"], FETCH_TIMEOUT_MS) : Promise.resolve(null),
      announcementStore().refresh({ force: true }).catch(() => undefined),
      releaseNotesStore().refresh({ force: true }).catch(() => undefined),
    ]);
    const value = await inspectRepoStatus(repoRoot);
    cachedStatus = { at: Date.now(), value };
    return value;
  })().finally(() => {
    if (inflightRefresh === task) inflightRefresh = null;
  });

  inflightRefresh = task;
  const value = await task;
  return { ...value, canBackgroundUpdate: Boolean(runner && runner.findBot()), job: toPublicJob(currentJob) };
}

async function startBackgroundUpdate(targetVersion: string, highlights: readonly string[]): Promise<{ ok: true; job: ForkUpdateJobView } | { ok: false; status: number; error: string }> {
  const activeRunner = runner;
  if (!activeRunner) {
    return { ok: false, status: 503, error: "Background update runner is not ready on this server." };
  }
  const repoRoot = activeRunner.repoRoot ?? DEFAULT_REPO_ROOT;
  loadJobFromDisk(repoRoot);
  if (currentJob?.status === "running") {
    return { ok: false, status: 409, error: `An update to v${currentJob.targetVersion} is already running in the background.` };
  }

  const bot = activeRunner.findBot();
  if (!bot) {
    return { ok: false, status: 404, error: "No bot is available to run the background update." };
  }

  const repoStatus = await inspectRepoStatus(repoRoot);
  if (!repoStatus.isFork) {
    return { ok: false, status: 400, error: "This install is not a git fork with an upstream remote." };
  }

  const cleanTarget = bareVersion(targetVersion);
  if (!cleanTarget) {
    return { ok: false, status: 400, error: "Missing target version." };
  }

  const jobId = randomUUID();
  const routineRunId = `${FORK_UPDATE_THREAD_PREFIX}${jobId}`;
  const created = activeRunner.createHiddenTask(bot.id, routineRunId);
  if (!created) {
    return { ok: false, status: 500, error: "Could not initialize a hidden background task." };
  }

  const job: InternalJob = {
    id: jobId,
    status: "running",
    fromVersion: repoStatus.installedVersion,
    targetVersion: cleanTarget,
    startedAt: Date.now(),
    finishedAt: null,
    currentStep: "Starting silent background merge…",
    log: ["Starting silent background merge…"],
    summary: null,
    error: null,
    backupTag: null,
    needsRestart: false,
    botId: bot.id,
    threadId: created.threadId,
    headBefore: repoStatus.headSha,
  };
  currentJob = job;
  saveJobToDisk();

  const prompt = buildServerForkUpdatePrompt({
    targetVersion: cleanTarget,
    installedVersion: repoStatus.installedVersion,
    repoPath: repoStatus.repoPath,
    upstreamRemote: repoStatus.upstreamRemote,
    highlights,
  });

  const finishJob = async (outcome: { ok: boolean; error?: string; text?: string }) => {
    if (currentJob?.id !== job.id) return;
    const captured = job.threadId ? summarizeMessages(activeRunner.messagesFor(job.threadId)) : { currentStep: null, log: [], lastReply: null };
    const threadToRemove = job.threadId;
    job.threadId = null;
    if (threadToRemove) {
      try {
        activeRunner.deleteHiddenTask(job.botId, threadToRemove);
      } catch {
        // best-effort cleanup
      }
    }

    const [afterRepo, backupTag] = await Promise.all([
      inspectRepoStatus(repoRoot),
      latestBackupTag(repoRoot),
    ]);
    cachedStatus = { at: Date.now(), value: afterRepo };

    if (job.status === "cancelled") {
      job.finishedAt ??= Date.now();
      job.log = captured.log.length ? captured.log : job.log;
      job.backupTag = backupTag;
      saveJobToDisk();
      return;
    }

    const replyText = outcome.text?.trim() || captured.lastReply || null;
    const versionReached = /^\d+\.\d+\.\d+$/.test(cleanTarget)
      ? compareVersions(bareVersion(afterRepo.installedVersion), cleanTarget) === 0
      : afterRepo.headSha !== job.headBefore;
    const succeeded = outcome.ok && (versionReached || afterRepo.headSha !== job.headBefore);

    job.status = succeeded ? "succeeded" : "failed";
    job.finishedAt = Date.now();
    job.currentStep = succeeded ? `Updated to v${afterRepo.installedVersion}` : "Update failed";
    job.log = captured.log.length ? captured.log : job.log;
    job.summary = replyText;
    job.error = succeeded ? null : (outcome.error || "Update did not advance the repository. Check details for more info.");
    job.backupTag = backupTag;
    job.needsRestart = succeeded;
    saveJobToDisk();
  };

  try {
    await activeRunner.startTurn(bot.id, created.threadId, prompt, (outcome) => {
      void finishJob(outcome);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishJob({ ok: false, error: message });
    return { ok: false, status: 500, error: message };
  }

  return { ok: true, job: toPublicJob(job)! };
}

async function cancelBackgroundUpdate(): Promise<{ ok: true; job: ForkUpdateJobView | null } | { ok: false; status: number; error: string }> {
  if (!currentJob || currentJob.status !== "running") {
    return { ok: true, job: toPublicJob(currentJob) };
  }
  const job = currentJob;
  job.status = "cancelled";
  job.finishedAt = Date.now();
  job.currentStep = "Cancelled";
  job.error = "Update cancelled.";
  const threadId = job.threadId;
  if (runner && threadId) {
    try {
      await runner.interruptThread(job.botId, threadId, "Cancelled from Announcements");
    } catch {
      // ignore interrupt failure
    }
    try {
      runner.deleteHiddenTask(job.botId, threadId);
    } catch {
      // ignore cleanup failure
    }
    job.threadId = null;
  }
  saveJobToDisk();
  return { ok: true, job: toPublicJob(job) };
}

export function resetForkUpdateCacheForTest(): void {
  cachedStatus = null;
  inflightStatus = null;
  inflightRefresh = null;
  currentJob = null;
  jobLoadedFromDisk = false;
  runner = null;
}

export const forkUpdateRoutes: RouteHandler = async (ctx: RouteContext) => {
  const { path, method, url, res, json, readBody, auth } = ctx;
  const repoRoot = runner?.repoRoot ?? DEFAULT_REPO_ROOT;

  if (
    path !== FORK_UPDATE_STATUS_PATH
    && path !== FORK_UPDATE_CHECK_PATH
    && path !== FORK_UPDATE_APPLY_PATH
    && path !== FORK_UPDATE_CANCEL_PATH
    && path !== FORK_UPDATE_DISMISS_PATH
    && path !== FORK_UPDATE_RESTART_PATH
  ) {
    return PASS;
  }

  try {
    if (path === FORK_UPDATE_STATUS_PATH) {
      if (method !== "GET") return json(res, 405, { error: "Use GET." });
      const refresh = url.searchParams.get("refresh") === "1";
      const status = refresh && ownerOrAdmin(auth)
        ? await refreshUpstream(repoRoot)
        : await getStatus(repoRoot, refresh);
      return json(res, 200, status);
    }

    if (method !== "POST") return json(res, 405, { error: "Use POST." });
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only the owner can manage fork updates." });

    if (path === FORK_UPDATE_CHECK_PATH) {
      const status = await refreshUpstream(repoRoot);
      return json(res, 200, status);
    }

    if (path === FORK_UPDATE_APPLY_PATH) {
      const body = (await readBody(ctx.req)) as { targetVersion?: unknown; highlights?: unknown } | null;
      const targetVersion = typeof body?.targetVersion === "string" ? body.targetVersion : "";
      const highlights = Array.isArray(body?.highlights)
        ? body.highlights.filter((line): line is string => typeof line === "string")
        : [];
      const started = await startBackgroundUpdate(targetVersion, highlights);
      if (!started.ok) return json(res, started.status, { error: started.error });
      return json(res, 202, { ok: true, job: started.job });
    }

    if (path === FORK_UPDATE_CANCEL_PATH) {
      const result = await cancelBackgroundUpdate();
      if (!result.ok) return json(res, result.status, { error: result.error });
      return json(res, 200, result);
    }

    if (path === FORK_UPDATE_DISMISS_PATH) {
      if (currentJob && currentJob.status !== "running") {
        currentJob = null;
        saveJobToDisk();
      }
      return json(res, 200, { ok: true });
    }

    if (path === FORK_UPDATE_RESTART_PATH) {
      if (currentJob?.status === "running") {
        return json(res, 409, { error: "Wait for the background update to finish before restarting." });
      }
      if (currentJob) {
        currentJob.needsRestart = false;
        saveJobToDisk();
      }
      json(res, 202, { ok: true, restarting: true });
      (runner?.restartServer ?? defaultRestartServer)();
      return;
    }

    return PASS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(res, 500, { error: message });
  }
};
