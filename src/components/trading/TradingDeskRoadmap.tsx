import { Layers, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import type { LiveJournalEntry, MultiAccountSummary, TradingState } from "./types.ts";

/** Visual Combine -> XFA Payout #1 -> 5x XFA live roadmap & consistency tracker. */
export function CombineRoadmapPanel({
  trading,
  liveJournals,
}: {
  trading: TradingState | null;
  liveJournals: readonly LiveJournalEntry[];
}) {
  const acct = trading?.account;
  const multi = trading?.multi_account;
  const netProfit = acct?.net_profit ?? 0;
  const combineTarget = acct?.target_profit ?? 3000;
  const combinePct = Math.max(0, Math.min(100, (netProfit / combineTarget) * 100));
  const todayNet = acct?.today_net ?? 0;
  const consistencyCap = acct?.consistency_cap ?? 1650;
  const consistencyPct = Math.max(0, Math.min(100, (Math.max(0, todayNet) / consistencyCap) * 100));
  const consistencyHot = todayNet >= consistencyCap * 0.85;

  const greenDays = liveJournals.filter((j) => (j.realized_pnl_usd ?? 0) >= 150).length;
  const liveNetSum = liveJournals.reduce((sum, j) => sum + (j.realized_pnl_usd ?? 0), 0);
  const liveSlots = multi?.active_live_count ?? (acct && !acct.is_practice ? 1 : 0);
  const targetSlots = multi?.target_xfa_slots ?? 5;

  return (
    <div data-combine-roadmap className="rounded-xl border border-hairline/35 bg-inset/70 p-2.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-ink">
          <Trophy size={12} className="text-amber-400" />
          Combine → 5× XFA Roadmap
        </span>
        <span className="font-mono text-[10px] text-ink-tertiary">
          {liveSlots}/{targetSlots} live slots
        </span>
      </div>

      {/* Phase 1: Combine Pass + 55% Consistency Cap */}
      <div className="mt-2 space-y-1.5">
        <div>
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="text-ink-secondary">1. Combine $53k</span>
            <span className={netProfit >= combineTarget ? "font-semibold text-emerald-400" : "text-ink"}>
              {netProfit >= 0 ? "+" : ""}${netProfit.toFixed(0)} / $3,000 ({combinePct.toFixed(0)}%)
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-card">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${Math.max(2, combinePct)}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="text-ink-secondary">55% Consistency Cap</span>
            <span className={consistencyHot ? "font-semibold text-amber-300" : "text-ink-tertiary"}>
              ${Math.max(0, todayNet).toFixed(0)} / ${consistencyCap.toFixed(0)} today
            </span>
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-card">
            <div
              className={cn("h-full rounded-full transition-all", consistencyHot ? "bg-amber-400" : "bg-sky-400")}
              style={{ width: `${Math.max(2, consistencyPct)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Phase 2 & 3 compact milestones */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-[10px]">
        <div className="rounded-lg bg-card/80 px-2 py-1.5">
          <div className="text-[9.5px] text-ink-tertiary">2. XFA Payout #1</div>
          <div className="mt-0.5 font-semibold text-ink">
            {greenDays}/5 green · ${Math.max(0, liveNetSum).toFixed(0)}/2.5k
          </div>
        </div>
        <div className="rounded-lg bg-card/80 px-2 py-1.5">
          <div className="text-[9.5px] text-ink-tertiary">3. Scale 5× XFAs</div>
          <div className="mt-0.5 flex items-center gap-1 font-semibold text-sky-400">
            {Array.from({ length: targetSlots }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  i < liveSlots ? "bg-sky-400" : "bg-inset",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Multi-account 5x XFA fleet strip rendered inside the Risk card. */
export function MultiAccountStrip({ multi }: { multi: MultiAccountSummary | undefined }) {
  if (!multi) return null;
  const liveAccounts = multi.accounts.filter((a) => !a.is_practice);
  if (liveAccounts.length <= 1) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-hairline/30 bg-inset/50 px-2.5 py-1.5 font-mono text-[10px] text-ink-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <Layers size={11} className="text-sky-400" />
          5× XFA Multi-Account Ready
        </span>
        <span className="text-ink-secondary">{liveAccounts.length}/{multi.target_xfa_slots} active</span>
      </div>
    );
  }

  return (
    <div data-multi-account-strip className="space-y-1.5 rounded-xl border border-sky-400/30 bg-sky-500/8 p-2 text-[10.5px]">
      <div className="flex items-center justify-between font-mono text-[10px]">
        <span className="inline-flex items-center gap-1 font-semibold text-sky-300">
          <Layers size={11} />
          {liveAccounts.length}/{multi.target_xfa_slots} Live Accounts
        </span>
        <span className={cn("font-semibold", multi.total_unrealized_usd >= 0 ? "text-emerald-400" : "text-rose-400")}>
          ${multi.total_balance.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          {multi.total_open_positions > 0 && ` (${multi.total_unrealized_usd >= 0 ? "+" : ""}$${multi.total_unrealized_usd.toFixed(0)})`}
        </span>
      </div>
      <div className="space-y-1">
        {liveAccounts.slice(0, 5).map((a) => (
          <div key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-inset/70 px-2 py-1 font-mono text-[10px]">
            <span className="truncate text-ink">
              {a.name}
              {a.is_primary && <span className="ml-1 text-[9px] text-sky-400">LEAD</span>}
            </span>
            <span className="shrink-0 text-ink-secondary">
              MLL ${a.mll_cushion.toFixed(0)}
              {a.open_positions > 0 && (
                <span className={cn("ml-1.5", a.unrealized_usd >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {a.unrealized_usd >= 0 ? "+" : ""}${a.unrealized_usd.toFixed(0)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
