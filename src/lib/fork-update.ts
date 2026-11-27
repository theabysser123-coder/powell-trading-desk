// Client helpers for fork-safe AI-managed OpenMausBot updates launched from Announcements.
import type { Dispatch } from "react";
import { api, type Action, type Bot } from "@/state/store";
import { compareVersions } from "../../shared/announcements";
import { releaseLeads, type ReleaseEntry } from "../../shared/release-notes";

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

/** Pick Head of Desk (Chief of Staff) to run the fork-safe update; fall back to the first visible bot. */
export function findUpdateBot(bots: readonly Bot[] | undefined): Bot | undefined {
  if (!bots?.length) return undefined;
  const visible = bots.filter((bot) => !bot.hidden);
  return visible.find((bot) => bot.chiefOfStaff)
    ?? visible.find((bot) => /head of desk/i.test(bot.name))
    ?? visible[0];
}

export interface BuildForkUpdatePromptInput {
  targetVersion: string;
  installedVersion: string;
  repoPath: string;
  upstreamRemote: string | null;
  release?: ReleaseEntry | null;
}

/** Build a crisp, self-contained update instruction that preserves every customization in FORK_MANIFEST.md. */
export function buildForkUpdatePrompt(input: BuildForkUpdatePromptInput): string {
  const target = bare(input.targetVersion);
  const current = bare(input.installedVersion);
  const tagRef = /^\d+\.\d+\.\d+$/.test(target) ? `v${target}` : target;
  const highlights = input.release ? releaseLeads(input.release, 3) : [];
  const lines = [
    `Update our OpenMausBot fork from v${current} to ${tagRef} without breaking any of our custom setup.`,
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
    "5. Commit and push the verified update to origin/main, then report what upstream changes landed, any conflicts resolved, the backup rollback tag, and whether a service restart is needed (do not restart the running server mid-reply).",
  ];
  return lines.join("\n");
}

export interface LaunchForkUpdateInput {
  bot: Bot;
  status: ForkUpdateStatus;
  targetVersion: string;
  release?: ReleaseEntry | null;
  dispatch: Dispatch<Action>;
}

/** Open a dedicated chat thread on Head of Desk, switch to it, and kick off the fork-safe update. */
export async function launchForkUpdateChat(input: LaunchForkUpdateInput): Promise<string> {
  const target = bare(input.targetVersion);
  const tagLabel = /^\d+\.\d+\.\d+$/.test(target) ? `v${target}` : target;
  const created = await api<{ bot?: Bot }>(`/api/bots/${input.bot.id}/tasks`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const nextBot = created?.bot ?? input.bot;
  const threadId = nextBot.threadId;

  if (created?.bot) {
    input.dispatch({ type: "taskSwitched", bot: created.bot });
  }
  input.dispatch({ type: "select", id: input.bot.id });
  input.dispatch({ type: "showChat" });

  if (threadId) {
    input.dispatch({
      type: "renameTask",
      botId: input.bot.id,
      threadId,
      title: `Update OpenMausBot to ${tagLabel}`,
    });
  }

  const text = buildForkUpdatePrompt({
    targetVersion: target,
    installedVersion: input.status.installedVersion,
    repoPath: input.status.repoPath,
    upstreamRemote: input.status.upstreamRemote,
    release: input.release,
  });

  input.dispatch({
    type: "send",
    botId: input.bot.id,
    threadId,
    text,
  });

  return threadId;
}
