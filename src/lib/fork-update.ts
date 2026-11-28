// Client helpers for silent background AI-managed OpenMausBot fork updates in Announcements.
import { api } from "@/state/store";
import { compareVersions } from "../../shared/announcements";
import { releaseLeads, type ReleaseEntry } from "../../shared/release-notes";

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

export interface TradingGuardStatus {
  blocked: boolean;
  reason: string | null;
  inTradingWindow: boolean;
  hasOpenTrade: boolean;
  nyTimeEt: string;
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
  canBackgroundUpdate?: boolean;
  tradingGuard?: TradingGuardStatus | null;
  job?: ForkUpdateJobView | null;
}

const bare = (version: string) => version.trim().replace(/^v/i, "");

export function isNewerVersion(candidate: string | null | undefined, installed: string | null | undefined): boolean {
  if (!candidate || !installed) return false;
  return (compareVersions(bare(candidate), bare(installed)) ?? 0) > 0;
}

export async function fetchForkUpdateStatus(): Promise<ForkUpdateStatus | null> {
  try {
    const data = await api<ForkUpdateStatus | null | undefined>("/api/fork-update/status");
    return data && typeof data.isFork === "boolean" ? data : null;
  } catch {
    return null;
  }
}

export async function checkForkUpdates(): Promise<ForkUpdateStatus | null> {
  try {
    const data = await api<ForkUpdateStatus | null | undefined>("/api/fork-update/check", {
      method: "POST",
      body: "{}",
    });
    return data && typeof data.isFork === "boolean" ? data : null;
  } catch {
    return null;
  }
}

/** Kick off a silent background AI merge on the server (no chat thread opened or shown). */
export async function startBackgroundForkUpdate(input: {
  targetVersion: string;
  release?: ReleaseEntry | null;
}): Promise<ForkUpdateJobView> {
  const highlights = input.release ? releaseLeads(input.release, 3) : [];
  const res = await api<{ ok?: boolean; job?: ForkUpdateJobView; error?: string }>("/api/fork-update/apply", {
    method: "POST",
    body: JSON.stringify({
      targetVersion: bare(input.targetVersion),
      highlights,
    }),
  });
  if (!res?.job) throw new Error(res?.error || "Could not start the background update.");
  return res.job;
}

export async function cancelBackgroundForkUpdate(): Promise<ForkUpdateJobView | null> {
  const res = await api<{ ok?: boolean; job?: ForkUpdateJobView | null }>("/api/fork-update/cancel", {
    method: "POST",
    body: "{}",
  });
  return res?.job ?? null;
}

export async function dismissBackgroundForkUpdate(): Promise<void> {
  await api("/api/fork-update/dismiss", {
    method: "POST",
    body: "{}",
  });
}

export async function restartForkServer(): Promise<void> {
  await api("/api/fork-update/restart", {
    method: "POST",
    body: "{}",
  });
}

/** Poll /api/health after a server restart until the restarted process responds, then resolve true. */
export async function waitForServerRestart(timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // Wait briefly so the old process has time to stop before polling.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  while (Date.now() < deadline) {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (response.ok) return true;
    } catch {
      // still restarting
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

export function formatElapsed(startedAt: number, finishedAt: number | null, nowMs: number): string {
  const totalSec = Math.max(0, Math.floor(((finishedAt ?? nowMs) - startedAt) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
