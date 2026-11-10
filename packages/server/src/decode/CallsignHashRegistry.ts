/**
 * Receiver-scoped WSJT 77-bit hash memory, independent of slot/Worker state.
 * Mirrors the three WSJT-X table lifetimes: 10/12-bit direct indexes and
 * a 1000-entry 22-bit LRU. Collisions keep a witness for Native to replay
 * so a short hash never silently resolves to the most recent winner.
 */
export interface CallsignHashSnapshot {
  version: number;
  calls: string[];
}

const MAX_HASH22 = 1000;
const C38 = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/';
const MASK64 = (1n << 64n) - 1n;
const MAGIC = 47_055_833_459n;
// Native extracts validated 77-bit fields. This additional shape check
// excludes grids/reports if a malformed or legacy Worker sends bad metadata.
const VALID_CALL = /^(?=.{2,11}$)(?=.*[A-Z])(?=.*[0-9][A-Z])[A-Z0-9/]+$/;

export function callsignHash(call: string, bits: 10 | 12 | 22): number {
  const normalized = call.toUpperCase().padEnd(11, ' ');
  let n = 0n;
  for (const c of normalized.slice(0, 11)) {
    n = ((n * 38n) + BigInt(Math.max(C38.indexOf(c), 0))) & MASK64;
  }
  return Number(((n * MAGIC) & MASK64) >> BigInt(64 - bits));
}

export class CallsignHashRegistry {
  private readonly calls10 = new Map<number, string>();
  private readonly calls12 = new Map<number, string>();
  private readonly collision10 = new Map<number, string>();
  private readonly collision12 = new Map<number, string>();
  private readonly calls22 = new Map<string, true>();
  private revision = 0;
  private last22: string | null = null;

  get version(): number { return this.revision; }
  get size(): number { return this.calls22.size; }

  /** Input MUST come from a Native-validated protocol field, not UI text. */
  learnRx(calls: readonly string[]): number {
    let changed = 0;
    for (const raw of calls) {
      if (typeof raw !== 'string') continue;
      const call = raw.trim().toUpperCase();
      if (!VALID_CALL.test(call)) continue;
      let updated = false;
      for (const [bits, slots, conflicts] of [
        [10, this.calls10, this.collision10],
        [12, this.calls12, this.collision12],
      ] as const) {
        const hash = callsignHash(call, bits);
        const previous = slots.get(hash);
        if (previous !== call) {
          if (previous && !conflicts.has(hash)) conflicts.set(hash, previous);
          slots.set(hash, call);
          updated = true;
        }
      }
      if (!this.calls22.has(call)) {
        this.calls22.set(call, true);
        if (this.calls22.size > MAX_HASH22) {
          this.calls22.delete(this.calls22.keys().next().value!);
        }
        this.last22 = call;
        updated = true;
      } else if (this.last22 !== call) {
        this.calls22.delete(call);
        this.calls22.set(call, true);
        this.last22 = call;
        updated = true;
      }
      if (updated) changed++;
    }
    if (changed) this.revision++;
    return changed;
  }

  snapshot(): CallsignHashSnapshot {
    // Replay direct-slot witnesses first. Replaying the latest 1000 calls
    // last restores the correct long-hash LRU without discarding older
    // still-valid short-hash entries.
    const calls = new Set<string>();
    for (const call of this.collision10.values()) calls.add(call);
    for (const call of this.collision12.values()) calls.add(call);
    for (const call of this.calls10.values()) calls.add(call);
    for (const call of this.calls12.values()) calls.add(call);
    for (const call of this.calls22.keys()) {
      calls.delete(call);
      calls.add(call);
    }
    return { version: this.revision, calls: [...calls] };
  }

  clear(): void {
    if (!this.revision && !this.calls22.size) return;
    this.calls10.clear(); this.calls12.clear();
    this.collision10.clear(); this.collision12.clear();
    this.calls22.clear();
    this.last22 = null;
    this.revision++;
  }
}
