import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureForkUpdateRunner,
  FORK_UPDATE_APPLY_PATH,
  FORK_UPDATE_CANCEL_PATH,
  FORK_UPDATE_CHECK_PATH,
  FORK_UPDATE_DISMISS_PATH,
  FORK_UPDATE_RESTART_PATH,
  FORK_UPDATE_STATUS_PATH,
  forkUpdateRoutes,
  inspectForkStatus,
  isForkUpdateTask,
  parseAheadBehind,
  pickLatestSemverTag,
  resetForkUpdateCacheForTest,
  shortRemoteName,
} from "./fork-update.ts";
import { PASS, type RouteContext } from "./table.ts";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
}

afterEach(() => {
  resetForkUpdateCacheForTest();
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("fork-update helpers", () => {
  it("normalizes HTTPS and SSH remote URLs", () => {
    expect(shortRemoteName("https://github.com/milind-soni/OpenMausBot.git")).toBe("milind-soni/OpenMausBot");
    expect(shortRemoteName("git@github.com:theabysser123-coder/powell-trading-desk.git")).toBe("theabysser123-coder/powell-trading-desk");
    expect(shortRemoteName("")).toBeNull();
    expect(shortRemoteName(null)).toBeNull();
  });

  it("picks the highest semver tag", () => {
    expect(pickLatestSemverTag(["v0.1.9", "v0.1.184", "v0.1.181", "backup/pre-update"])).toBe("0.1.184");
    expect(pickLatestSemverTag(["not-a-version"])).toBeNull();
  });

  it("parses git rev-list behind/ahead counts", () => {
    expect(parseAheadBehind("12\t4")).toEqual({ behind: 12, ahead: 4 });
    expect(parseAheadBehind("0 0")).toEqual({ behind: 0, ahead: 0 });
    expect(parseAheadBehind("")).toEqual({ behind: 0, ahead: 0 });
  });
});

describe("inspectForkStatus", () => {
  it("returns isFork=false when no upstream remote is configured", async () => {
    const repo = makeTempDir("fork-status-no-upstream-");
    git(repo, "init", "-b", "main");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "0.1.181" }));
    const status = await inspectForkStatus(repo);
    expect(status.isFork).toBe(false);
    expect(status.installedVersion).toBe("0.1.181");
  });

  it("reports ahead/behind counts, latest tag, remotes, and dirty state for a fork", async () => {
    const upstream = makeTempDir("fork-status-upstream-");
    git(upstream, "init", "-b", "main");
    writeFileSync(join(upstream, "package.json"), JSON.stringify({ version: "0.1.181" }));
    git(upstream, "add", ".");
    git(upstream, "commit", "-m", "base");
    git(upstream, "tag", "v0.1.181");

    const fork = makeTempDir("fork-status-local-");
    git(fork, "clone", upstream, ".");
    git(fork, "remote", "rename", "origin", "upstream");
    git(fork, "remote", "add", "origin", "https://github.com/theabysser123-coder/powell-trading-desk.git");

    // Advance upstream with 2 commits and a newer release tag
    writeFileSync(join(upstream, "package.json"), JSON.stringify({ version: "0.1.184" }));
    git(upstream, "commit", "-am", "upstream release 0.1.184");
    git(upstream, "tag", "v0.1.184");
    writeFileSync(join(upstream, "extra.txt"), "new upstream file\n");
    git(upstream, "add", ".");
    git(upstream, "commit", "-m", "post-release fix");

    // Advance fork with 1 custom commit
    writeFileSync(join(fork, "fork-only.txt"), "desk customization\n");
    git(fork, "add", ".");
    git(fork, "commit", "-m", "custom desk commit");
    git(fork, "fetch", "upstream", "--tags");

    const clean = await inspectForkStatus(fork);
    expect(clean.isFork).toBe(true);
    expect(clean.installedVersion).toBe("0.1.181");
    expect(clean.aheadCount).toBe(1);
    expect(clean.behindCount).toBe(2);
    expect(clean.latestTag).toBe("0.1.184");
    expect(clean.originRemote).toBe("theabysser123-coder/powell-trading-desk");
    expect(clean.dirty).toBe(false);

    // Dirty tree detection
    writeFileSync(join(fork, "scratch.txt"), "uncommitted\n");
    const dirty = await inspectForkStatus(fork);
    expect(dirty.dirty).toBe(true);
  });
});

describe("forkUpdateRoutes", () => {
  function makeCtx(path: string, method: string, authKind: "owner" | "service" = "owner") {
    const out: { status?: number; body?: unknown } = {};
    const json = vi.fn((_res: ServerResponse, status: number, body: unknown) => {
      out.status = status;
      out.body = body;
    });
    const ctx = {
      req: {} as IncomingMessage,
      res: { headersSent: false, writableEnded: false } as ServerResponse,
      url: new URL(`http://127.0.0.1:8799${path}`),
      path: path.split("?")[0]!,
      method,
      auth: authKind === "owner"
        ? { kind: "loopback", scopes: ["admin", "client"] }
        : { kind: "loopback", scopes: ["client"], trust: "service" },
      json,
      readBody: vi.fn(async () => ({})),
    } as unknown as RouteContext;
    return { ctx, out };
  }

  it("passes through unrelated routes and rejects wrong HTTP methods", async () => {
    const unrelated = makeCtx("/api/other", "GET");
    expect(await forkUpdateRoutes(unrelated.ctx)).toBe(PASS);

    const wrongStatusMethod = makeCtx(FORK_UPDATE_STATUS_PATH, "POST");
    await forkUpdateRoutes(wrongStatusMethod.ctx);
    expect(wrongStatusMethod.out.status).toBe(405);

    const wrongCheckMethod = makeCtx(FORK_UPDATE_CHECK_PATH, "GET");
    await forkUpdateRoutes(wrongCheckMethod.ctx);
    expect(wrongCheckMethod.out.status).toBe(405);
  });

  it("restricts POST /api/fork-update/check to owner/admin", async () => {
    const serviceCheck = makeCtx(FORK_UPDATE_CHECK_PATH, "POST", "service");
    await forkUpdateRoutes(serviceCheck.ctx);
    expect(serviceCheck.out.status).toBe(403);
  });

  it("identifies hidden fork-update tasks by routineRunId prefix", () => {
    expect(isForkUpdateTask({ routineRunId: "fork-update-abc" })).toBe(true);
    expect(isForkUpdateTask({ routineRunId: "routine-123" })).toBe(false);
    expect(isForkUpdateTask({})).toBe(false);
  });

  it("runs a silent background update, cleans up its hidden task on completion, and supports restart + dismiss", async () => {
    const upstream = makeTempDir("fork-bg-upstream-");
    git(upstream, "init", "-b", "main");
    writeFileSync(join(upstream, "package.json"), JSON.stringify({ version: "0.1.184" }));
    git(upstream, "add", ".");
    git(upstream, "commit", "-m", "base");
    git(upstream, "tag", "v0.1.184");

    const fork = makeTempDir("fork-bg-local-");
    git(fork, "clone", upstream, ".");
    git(fork, "remote", "rename", "origin", "upstream");
    git(fork, "remote", "add", "origin", "https://github.com/theabysser123-coder/powell-trading-desk.git");

    const dataDir = makeTempDir("fork-bg-data-");
    const deleted: Array<{ botId: string; threadId: string }> = [];
    const restarted = vi.fn();
    let settleFn: ((outcome: { ok: boolean; error?: string; text?: string }) => void) | null = null;
    const liveMessages = [
      { role: "bot", kind: "activity", tool: { name: "run_command", summary: "Merging upstream v0.1.185" } },
    ];

    configureForkUpdateRunner({
      dataDir,
      repoRoot: fork,
      findBot: () => ({ id: "chief-1", name: "Head of Desk" }),
      createHiddenTask: (_botId, routineRunId) => ({ threadId: `hidden-${routineRunId}` }),
      deleteHiddenTask: (botId, threadId) => { deleted.push({ botId, threadId }); },
      messagesFor: () => liveMessages,
      startTurn: async (_botId, _threadId, _prompt, onSettled) => { settleFn = onSettled; },
      interruptThread: async () => {},
      restartServer: restarted,
    });

    const applyReq = makeCtx(FORK_UPDATE_APPLY_PATH, "POST", "owner");
    applyReq.ctx.readBody = vi.fn(async () => ({ targetVersion: "0.1.185", highlights: ["Faster startup."] }));
    await forkUpdateRoutes(applyReq.ctx);
    expect(applyReq.out.status).toBe(202);
    expect((applyReq.out.body as { job: { status: string; targetVersion: string } }).job.status).toBe("running");

    // Live status exposes current step while running
    const midStatus = makeCtx(FORK_UPDATE_STATUS_PATH, "GET", "owner");
    await forkUpdateRoutes(midStatus.ctx);
    expect((midStatus.out.body as { job: { currentStep: string } }).job.currentStep).toBe("Merging upstream v0.1.185");

    // Simulate successful merge advancing package.json to 0.1.185 + backup tag
    git(fork, "tag", "backup/pre-update-v0.1.185-test");
    writeFileSync(join(fork, "package.json"), JSON.stringify({ version: "0.1.185" }));
    git(fork, "commit", "-am", "merge v0.1.185");

    settleFn!({ ok: true, text: "Updated cleanly to v0.1.185." });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.botId).toBe("chief-1");

    const doneStatus = makeCtx(FORK_UPDATE_STATUS_PATH, "GET", "owner");
    await forkUpdateRoutes(doneStatus.ctx);
    const doneJob = (doneStatus.out.body as { job: { status: string; backupTag: string; needsRestart: boolean; summary: string } }).job;
    expect(doneJob.status).toBe("succeeded");
    expect(doneJob.backupTag).toBe("backup/pre-update-v0.1.185-test");
    expect(doneJob.needsRestart).toBe(true);
    expect(doneJob.summary).toContain("v0.1.185");

    const restartReq = makeCtx(FORK_UPDATE_RESTART_PATH, "POST", "owner");
    await forkUpdateRoutes(restartReq.ctx);
    expect(restartReq.out.status).toBe(202);
    expect(restarted).toHaveBeenCalledTimes(1);

    const dismissReq = makeCtx(FORK_UPDATE_DISMISS_PATH, "POST", "owner");
    await forkUpdateRoutes(dismissReq.ctx);
    expect(dismissReq.out.status).toBe(200);

    // Also verify cancel works when idle
    const cancelReq = makeCtx(FORK_UPDATE_CANCEL_PATH, "POST", "owner");
    await forkUpdateRoutes(cancelReq.ctx);
    expect(cancelReq.out.status).toBe(200);
  });
});
