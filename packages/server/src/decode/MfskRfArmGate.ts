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
  private armed: { identity: string; operatorId: string; principalId: string; until: number } | null = null;
  constructor(private readonly deps: {
    monotonicNowMs(): number;
    eligibleIdentity(): string | null;
  }) {}

  arm(acknowledged: boolean, operatorId: string, principalId: string, validityMs = 600_000): MfskRfArmStatus {
    // An invalid re-arm request must never leave a previous approval active.
    this.revoke();
    if (acknowledged !== true) throw new Error('RF safety acknowledgement is required');
    if (!operatorId || operatorId.length > 128 || !principalId || principalId.length > 256) {
      throw new Error('A valid authenticated operator and session are required');
    }
    if (!Number.isSafeInteger(validityMs) || validityMs <= 0 || validityMs > 600_000) {
      throw new Error('Invalid RF authorization duration');
    }
    const identity = this.deps.eligibleIdentity();
    const now = this.deps.monotonicNowMs();
    if (identity === null || !Number.isFinite(now)) {
      throw new Error('Native RF requires a real, connected radio and a ready matching receiver');
    }
    this.armed = { identity, operatorId, principalId, until: now + validityMs };
    return this.status(operatorId,principalId);
  }

  status(operatorId?: string,principalId?: string): MfskRfArmStatus {
    const now = this.deps.monotonicNowMs();
    const identity = this.deps.eligibleIdentity();
    const sessionValid = Boolean(this.armed && identity &&
      this.armed.identity === identity && Number.isFinite(now) &&
      now < this.armed.until);
    if(!sessionValid)this.revoke(); // Sticky fail-closed after rig/session transition.
    const enabled = Boolean(sessionValid && operatorId && principalId &&
      this.armed?.operatorId===operatorId && this.armed.principalId===principalId);
    return { rfEnabled: enabled, remainingMs: enabled
      ? Math.max(0, Math.ceil(this.armed!.until - now)) : 0 };
  }

  /** Used only inside the TX service; the authenticated HTTP route ALSO checks principal. */
  allowedForOperator(operatorId:string):boolean {
    // Check identity/expiry without authorizing a different operator.
    const now=this.deps.monotonicNowMs(), identity=this.deps.eligibleIdentity();
    const valid=Boolean(this.armed && identity && this.armed.identity===identity &&
      Number.isFinite(now) && now<this.armed.until);
    if(!valid){this.revoke();return false;}
    return this.armed!.operatorId===operatorId;
  }
  allowed():boolean {return this.allowedForOperator(this.armed?.operatorId??'');}
  revoke(): void { this.armed = null; }
}
