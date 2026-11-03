/**
 * Ephemeral, fail-closed approval for manually initiated native digital RF.
 * No configuration file, environment variable or login session implicitly
 * arms RF. Any rig connection, RX generation or mode change invalidates it.
 */
export interface MfskRfArmStatus {
  rfEnabled: boolean;
  remainingMs: number;
}

export class MfskRfArmGate {
  private armed: { identity: string; until: number } | null = null;
  constructor(private readonly deps: {
    monotonicNowMs(): number;
    eligibleIdentity(): string | null;
  }) {}

  arm(acknowledged: boolean, validityMs = 600_000): MfskRfArmStatus {
    if (acknowledged !== true) throw new Error('RF safety acknowledgement is required');
    if (!Number.isSafeInteger(validityMs) || validityMs <= 0 || validityMs > 600_000) {
      throw new Error('Invalid RF authorization duration');
    }
    const identity = this.deps.eligibleIdentity();
    const now = this.deps.monotonicNowMs();
    if (identity === null || !Number.isFinite(now)) {
      throw new Error('Native RF requires a real, connected radio and a ready matching receiver');
    }
    this.armed = { identity, until: now + validityMs };
    return this.status();
  }

  status(): MfskRfArmStatus {
    const now = this.deps.monotonicNowMs();
    const identity = this.deps.eligibleIdentity();
    const enabled = Boolean(this.armed && identity &&
      this.armed.identity === identity && Number.isFinite(now) &&
      now < this.armed.until);
    return { rfEnabled: enabled, remainingMs: enabled
      ? Math.max(0, Math.ceil(this.armed!.until - now)) : 0 };
  }

  allowed(): boolean { return this.status().rfEnabled; }
  revoke(): void { this.armed = null; }
}
