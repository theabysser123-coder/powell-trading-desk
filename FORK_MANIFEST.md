# Powell Trading Desk — Fork Protection Manifest

This repository (`theabysser123-coder/powell-trading-desk`) is a customized local fork of **OpenMausBot** (`milind-soni/OpenMausBot`, git remote `upstream`).

Whenever merging an upstream OpenMausBot release into this fork, **every customization listed below MUST be preserved and verified** before pushing to `origin/main`.

---

## 1. Non-Negotiable Fork Customizations

### A. Live Trading Desk Canvas & TopstepX Bridge
- **Standalone files (must remain intact):**
  - `server/routes/trading.ts` — REST bridge to `/home/nebula/.gemini/antigravity/scratch/powell-backtest/trading_bridge.py` with in-flight request deduplication and generation-safe cache invalidation.
  - `src/components/trading/TradingDeskPanel.tsx` — Pure Canvas shell with adaptive live polling (12s/15s flat, 5s/5s when in a live position) and live unrealized P&L pill.
  - `src/components/trading/TradingDeskCanvas.tsx` — Full-screen visual bot-to-system canvas (Head of Desk, Risk & Prop Guardian, Powell v7 Trader, Journal & Replay Analyst wired to Risk, Volatility/News, Live Tape + Morning Plan strip, and 80d Benchmark & Journals), fullscreen tape toggle, drag/pan/zoom.
  - `src/components/trading/TradingDeskNodes.tsx` — 2-click `Flatten` guard (`Flatten` → `Confirm?` 4s auto-reset), MLL + Personal DLL (`$750`) bars, live open position + Defense Ladder (`BE+1`, `+1R`) readout, journal history pager (`‹ / ›`).
  - `src/components/trading/TradingChartTab.tsx` — Live MNQ + synced ES SMT candlestick chart with `10:00 KO` & `4H/1H/15m Rejection Blocks`.
  - `src/components/trading/types.ts` — Shared trading payload TypeScript interfaces.
  - `start-desk.sh` — Local desk launcher script.
- **Core wiring (preserve during merges):**
  - `server/routes/table.ts` — `tradingRoutes` registered in `ROUTES`.
  - `server/request-auth.ts` — `/api/trading(?:\/[\w-]+)*` allowed for local client/admin requests.
  - `src/state/store.tsx` & `src/App.tsx` — `tradingDeskOpen` defaults to **`false`** (Desk never auto-opens on boot; closes when navigating to Automations/Computer).

### B. Automations Visual Canvas
- **Standalone files:**
  - `src/components/automations/AutomationsCanvas.tsx`
  - `src/lib/automation-canvas.ts`
  - `src/lib/automation-canvas.test.ts`
- **Core wiring:**
  - `src/components/TriggersPage.tsx` — Canvas view toggle wired cleanly.

### C. Head of Desk, 3 Specialist Bots & Trimmed Engine Fleet
- **Standalone files:**
  - `server/trading-desk-seed.ts` — Seeds Head of Desk + Risk & Prop Guardian + Powell v7 Trader + Journal & Replay Analyst + 3 Mon-Fri ET routines.
- **Core wiring:**
  - `server/index.ts` — Invokes trading desk seeding cleanly.
  - `server/instance-fleets.ts` — Trimmed `DEFAULT_FLEET` (Antigravity Gemini 4 Neon, Claude, Codex — no unwanted Cursor login popups).
  - `server/model-manifest/model-manifest.json` — Default model & fleet adjustments preserved.

### D. Liquid-Chrome Exhausted Head of Desk Mascot
- `src/assets/mausbot-steel/cursor-*.webp` — Custom exhausted chrome mascot images.
- `src/components/CursorAvatar.tsx`, `src/lib/mascot.ts`, `packages/phone-protocol/src/cursor-face-data.ts` — Sleepy/exhausted trader face support.

### E. Antigravity MCP Schema Guard & Inline Visuals
- `server/tool-schema-profile.ts` & `server/tool-schema-profile.test.ts` — **CRITICAL:** Every array parameter in compacted MCP tool schemas MUST preserve its `items` field (otherwise Google Gemini Antigravity rejects requests with HTTP 400 `INVALID_ARGUMENT: ...items: missing field`).
- `server/mcp-tool-schema.ts`, `server/drivers/agents-mcp.ts`, `server/drivers/agents-mcp-env.ts`, `server/drivers/turn-mcp.ts`, `server/harness-mcp-proxy.ts`, `server/harness-mcp-request.ts`, `server/routes/own-mcp-http.ts`.
- `src/components/ChatMarkdown.tsx`, `src/components/SvgDiagram.tsx`, `src/components/app/AppMessage.tsx`, `shared/app-frame/jsx-page.ts` — In-chat visual rendering (React JSX / ECharts / Lightweight-Charts / inline SVG).

### F. Custom UX Tweaks
- `src/components/ThreadSwitcherPill.tsx` (+ `.dom.test.ts`) — Hover-open top thread pill (expands on hover without stealing composer focus, ~180ms grace leave close).
- `src/state/thread-navigation.ts` (+ `store.test.ts`, `notification-open.test.ts`) — Always resume on the **latest active chat** when restarting or returning from another view.
- `src/components/StatusActivityRow.tsx` & `server/drivers/acp/quiet-watch.ts` — Suppress noisy `"is waiting on its model: no reply for ..."` heartbeat notices while keeping real errors and stuck-turn safeguards intact.
- `src/components/UnreadContextOverlay.tsx` — Suppress the floating `"Previous message"` / `Go to source` / `Close` unread-context overlay in chat.
- `src/App.tsx` — No intrusive promo / team upsell / tour popups.

### G. Fork-Safe AI Update System (Announcements Tab)
- `FORK_MANIFEST.md` (this file)
- `server/routes/fork-update.ts` (+ `server/routes/fork-update.test.ts`) — `/api/fork-update/{status,check,apply,cancel,dismiss,restart}` endpoints, silent hidden-task AI update runner (`configureForkUpdateRunner`), live step progress & disk persistence, and 1-click systemd restart. Registered in `server/routes/table.ts`, `server/request-auth.ts`, and `server/index.ts` (including `!isForkUpdateTask(task)` filter in `wireBot` & `wireTrustedApprovalBot` so background updates never create visible chat threads).
- `server/routes/announcements.ts` — Supports `?refresh=1` force-refresh of upstream announcements & release notes.
- `src/lib/fork-update.ts` — Client API helpers for silent background AI updates, cancel/dismiss, and server restart + health-check reload.
- `src/lib/announcements.ts` — Exports `refreshAnnouncements()`.
- `src/components/announcements/AnnouncementsPage.tsx`, `src/components/announcements/ReleaseRow.tsx`, `src/components/announcements/AnnouncementsPage.test.ts` — Fork sync bar, **Check for updates**, silent in-page background progress & **Restart server & reload**, and per-release **Update with AI** buttons.

---

## 2. Safe Upstream Update Playbook

Follow these exact steps whenever updating to a new OpenMausBot release (tag `vX.Y.Z` or `upstream/main`):

1. **Pre-flight & Safety Backup**
   - Verify clean working tree (`git status -sb`). If anything is dirty, inspect and commit or stash cleanly first — never lose local work.
   - Create a local safety tag before merging:
     ```bash
     git tag "backup/pre-update-v<TARGET>-$(date +%Y%m%d-%H%M%S)"
     ```
2. **Fetch Upstream**
   - `git fetch upstream --tags`
   - Inspect incoming commits & files that overlap with our fork (`git diff --name-only $(git merge-base upstream/main HEAD)..HEAD` vs `git diff --name-only HEAD..v<TARGET>`).
3. **Merge (Never Hard-Reset)**
   - Run `git merge --no-ff v<TARGET>` (or `upstream/main` if requested).
   - Resolve every merge conflict carefully so **both** upstream improvements AND every Section 1 customization survive.
   - Double-check `package.json` version reflects `<TARGET>`, and keep our extra dependencies (`lightweight-charts`, etc.) intact. Run `pnpm install` if `package.json` or `pnpm-lock.yaml` changed.
4. **Verify Before Finishing**
   - `npx tsc -b`
   - `npx tsc -p tsconfig.server.json`
   - Run targeted Vitest tests covering all critical fork areas:
     ```bash
     npx vitest run \
       server/tool-schema-profile.test.ts \
       server/routes/fork-update.test.ts \
       src/components/announcements/AnnouncementsPage.test.ts \
       src/components/ThreadSwitcherPill.dom.test.ts \
       src/state/notification-open.test.ts \
       src/lib/automation-canvas.test.ts \
       src/state/store.test.ts
     ```
   - `npx vite build` (updates `dist/` served by `powell-trading-desk.service`)
   - Note: Keep any newly edited/split fork files under 1,000 lines if touching ratchet-checked paths.
5. **Commit, Push & Restart Guidance**
   - Commit the verified merge and push to `origin/main`.
   - Report clearly:
     - New version (`old -> new`) and safety backup tag name (for instant rollback via `git reset --hard <backup-tag>`).
     - Key upstream features/fixes brought in.
     - Any conflicts resolved and confirmation that all Section 1 fork customizations & tests passed.
     - Reminder that UI updates are live on `Ctrl+Shift+R`, and backend updates take effect after `systemctl --user restart powell-trading-desk.service` (never kill the service mid-turn while replying!).
