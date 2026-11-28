// Subtle Web Audio chimes + state-transition detector for Powell v7 live trading events:
// order fill, Defense Ladder BE+1pt / +1R arming, and trade close. Zero external audio assets.
import type { TradingPosition, TradingState } from "@/components/trading/types";

const MUTE_KEY = "omb-desk-alerts-muted";

export type DeskAlertKind = "fill" | "be_armed" | "lock_1r" | "close_win" | "close_loss";

export interface DeskAlertSnapshot {
  positionIds: string[];
  beArmedIds: string[];
  lock1rIds: string[];
  realizedToday: number;
}

export function isDeskAlertsMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDeskAlertsMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // ignore storage errors
  }
}

function ladderFlags(pos: TradingPosition, fallbackPx: number | null): { be: boolean; lock1r: boolean } {
  const px = pos.last_price ?? fallbackPx ?? pos.avg_price;
  if (pos.side === "long") {
    return { be: px >= pos.be_trigger, lock1r: px >= pos.lock_1r_trigger };
  }
  return { be: px <= pos.be_trigger, lock1r: px <= pos.lock_1r_trigger };
}

export function snapshotTradingAlertState(state: TradingState): DeskAlertSnapshot {
  const positionIds: string[] = [];
  const beArmedIds: string[] = [];
  const lock1rIds: string[] = [];
  for (const pos of state.positions) {
    const id = String(pos.id);
    positionIds.push(id);
    const flags = ladderFlags(pos, state.market.last_nq);
    if (flags.be) beArmedIds.push(id);
    if (flags.lock1r) lock1rIds.push(id);
  }
  return {
    positionIds,
    beArmedIds,
    lock1rIds,
    realizedToday: state.account.realized_today,
  };
}

/** Compare consecutive trading state snapshots and return any newly triggered alert events. */
export function detectDeskAlerts(prev: DeskAlertSnapshot | null, next: DeskAlertSnapshot): DeskAlertKind[] {
  if (!prev) return [];
  const events: DeskAlertKind[] = [];
  const prevPos = new Set(prev.positionIds);
  const nextPos = new Set(next.positionIds);
  const prevBe = new Set(prev.beArmedIds);
  const prev1r = new Set(prev.lock1rIds);

  if (next.positionIds.some((id) => !prevPos.has(id))) {
    events.push("fill");
  }
  if (next.lock1rIds.some((id) => !prev1r.has(id))) {
    events.push("lock_1r");
  } else if (next.beArmedIds.some((id) => !prevBe.has(id))) {
    events.push("be_armed");
  }
  if (prev.positionIds.some((id) => !nextPos.has(id))) {
    events.push(next.realizedToday >= prev.realizedToday ? "close_win" : "close_loss");
  }
  return events;
}

const TONES: Record<DeskAlertKind, Array<{ freq: number; delay: number; dur: number }>> = {
  fill: [
    { freq: 587.33, delay: 0, dur: 0.11 },     // D5
    { freq: 880.0, delay: 0.1, dur: 0.16 },    // A5
  ],
  be_armed: [
    { freq: 659.25, delay: 0, dur: 0.1 },      // E5
    { freq: 783.99, delay: 0.09, dur: 0.14 },  // G5
  ],
  lock_1r: [
    { freq: 659.25, delay: 0, dur: 0.09 },     // E5
    { freq: 783.99, delay: 0.08, dur: 0.09 },  // G5
    { freq: 1046.5, delay: 0.16, dur: 0.18 },  // C6
  ],
  close_win: [
    { freq: 523.25, delay: 0, dur: 0.1 },      // C5
    { freq: 659.25, delay: 0.09, dur: 0.1 },   // E5
    { freq: 783.99, delay: 0.18, dur: 0.12 },  // G5
    { freq: 1046.5, delay: 0.28, dur: 0.22 },  // C6
  ],
  close_loss: [
    { freq: 440.0, delay: 0, dur: 0.13 },      // A4
    { freq: 349.23, delay: 0.12, dur: 0.2 },   // F4
  ],
};

/** Play a subtle, non-jarring synthesized chime if unmuted and browser audio is available. */
export function playDeskAlertChime(kind: DeskAlertKind): void {
  if (isDeskAlertsMuted()) return;
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = TONES[kind];
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, now + note.delay);
      gain.gain.setValueAtTime(0.0001, now + note.delay);
      gain.gain.exponentialRampToValueAtTime(0.06, now + note.delay + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.delay + note.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + note.delay);
      osc.stop(now + note.delay + note.dur + 0.02);
    }
    window.setTimeout(() => void ctx.close().catch(() => {}), 800);
  } catch {
    // autoplay or audio context blocked
  }
}
