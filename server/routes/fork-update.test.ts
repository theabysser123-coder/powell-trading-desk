import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FORK_UPDATE_CHECK_PATH,
  FORK_UPDATE_STATUS_PATH,
  forkUpdateRoutes,
  inspectForkStatus,
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
});
