// Fork-aware OpenMausBot upstream update status & refresh routes.
// Lets the Announcements page show live fork status (installed version, upstream commits/tags)
// and refresh upstream release notes on demand without ever touching the working tree.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { compareVersions } from "../../shared/announcements.ts";
import { announcementStore } from "../announcements/feed.ts";
import { releaseNotesStore } from "../announcements/release-notes.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

const execFileAsync = promisify(execFile);

export const FORK_UPDATE_STATUS_PATH = "/api/fork-update/status";
export const FORK_UPDATE_CHECK_PATH = "/api/fork-update/check";

const DEFAULT_REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const STATUS_CACHE_TTL_MS = 30_000;
const GIT_TIMEOUT_MS = 12_000;
const FETCH_TIMEOUT_MS = 35_000;

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

export async function inspectForkStatus(repoRoot = DEFAULT_REPO_ROOT): Promise<ForkUpdateStatus> {
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

let cachedStatus: { at: number; value: ForkUpdateStatus } | null = null;
let inflightStatus: Promise<ForkUpdateStatus> | null = null;
let inflightRefresh: Promise<ForkUpdateStatus> | null = null;

async function getStatus(repoRoot = DEFAULT_REPO_ROOT, force = false): Promise<ForkUpdateStatus> {
  const now = Date.now();
  if (!force && cachedStatus && now - cachedStatus.at < STATUS_CACHE_TTL_MS) {
    return cachedStatus.value;
  }
  if (!force && inflightStatus) return inflightStatus;

  const task = inspectForkStatus(repoRoot)
    .then((value) => {
      cachedStatus = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (inflightStatus === task) inflightStatus = null;
    });
  inflightStatus = task;
  return task;
}

async function refreshUpstream(repoRoot = DEFAULT_REPO_ROOT): Promise<ForkUpdateStatus> {
  if (inflightRefresh) return inflightRefresh;

  const task = (async () => {
    const upstreamUrl = await runGit(repoRoot, ["remote", "get-url", "upstream"]);
    await Promise.all([
      upstreamUrl ? runGit(repoRoot, ["fetch", "upstream", "--tags", "--prune"], FETCH_TIMEOUT_MS) : Promise.resolve(null),
      announcementStore().refresh({ force: true }).catch(() => undefined),
      releaseNotesStore().refresh({ force: true }).catch(() => undefined),
    ]);
    const status = await inspectForkStatus(repoRoot);
    cachedStatus = { at: Date.now(), value: status };
    return status;
  })().finally(() => {
    if (inflightRefresh === task) inflightRefresh = null;
  });

  inflightRefresh = task;
  return task;
}

export function resetForkUpdateCacheForTest(): void {
  cachedStatus = null;
  inflightStatus = null;
  inflightRefresh = null;
}

export const forkUpdateRoutes: RouteHandler = async (ctx: RouteContext) => {
  const { path, method, url, res, json, auth } = ctx;
  if (path !== FORK_UPDATE_STATUS_PATH && path !== FORK_UPDATE_CHECK_PATH) return PASS;

  try {
    if (path === FORK_UPDATE_STATUS_PATH) {
      if (method !== "GET") return json(res, 405, { error: "Use GET." });
      const refresh = url.searchParams.get("refresh") === "1";
      const status = refresh && ownerOrAdmin(auth)
        ? await refreshUpstream()
        : await getStatus(DEFAULT_REPO_ROOT, refresh);
      return json(res, 200, status);
    }

    if (method !== "POST") return json(res, 405, { error: "Use POST." });
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "Only the owner can check for upstream updates." });
    const status = await refreshUpstream();
    return json(res, 200, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(res, 500, { error: message });
  }
};
