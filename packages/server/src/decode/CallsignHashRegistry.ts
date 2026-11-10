/**
 * Receiver-scoped WSJT 77-bit callsign memory.
 *
 * Native decoders own per-slot staged DSP state; only protocol-validated
 * calls from completed worker results enter this registry. A snapshot is
 * ordered oldest-to-newest for native 22-bit LRU replay.
 */
export interface CallsignHashSnapshot {
  version: number;
  calls: string[];
}

const MAX_CALLS = 1000;
const VALID_CALL = /^(?=.{2,11}$)(?=.*[A-Z])(?=.*[0-9])[A-Z0-9/]+$/;

export class CallsignHashRegistry {
  private readonly rxCalls = new Map<string, true>();
  private revision = 0;

  get version(): number { return this.revision; }
  get size(): number { return this.rxCalls.size; }

  /**
   * Accept only calls supplied by Native's 77-bit field extractor.
   * Never pass display-text tokens, grids, or unresolved hashes here.
   */
  learnRx(calls: readonly string[]): number {
    let changed = 0;
    for (const raw of calls) {
      if (typeof raw !== 'string') continue;
      const call = raw.trim().toUpperCase();
      if (!VALID_CALL.test(call)) continue;
      if (this.rxCalls.has(call)) {
        // WSJT-X save_hash_call refreshes the 22-bit LRU on repeated RX.
        if ([...this.rxCalls.keys()].at(-1) !== call) {
          this.rxCalls.delete(call);
          this.rxCalls.set(call, true);
          changed++;
        }
        continue;
      }
      this.rxCalls.set(call, true);
      if (this.rxCalls.size > MAX_CALLS) {
        this.rxCalls.delete(this.rxCalls.keys().next().value!);
      }
      changed++;
    }
    if (changed) this.revision++;
    return changed;
  }

  snapshot(): CallsignHashSnapshot {
    return { version: this.revision, calls: [...this.rxCalls.keys()] };
  }

  clear(): void {
    if (this.rxCalls.size) {
      this.rxCalls.clear();
      this.revision++;
    }
  }
}
