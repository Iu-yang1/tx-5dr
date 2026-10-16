/** Bounded automatic recovery following a Chromium renderer crash.
 * A manual tray/Dock action can explicitly retry after automatic recovery is exhausted.
 */
export const RENDERER_RECOVERY_WINDOW_MS = 10 * 60_000;
export const RENDERER_RECOVERY_MAX_ATTEMPTS = 5;
export const RENDERER_RECOVERY_DELAY_MS = 1_000;

export class RendererRecoveryBudget {
  private attempts: number[] = [];

  recordCrash(now: number): { allowed: boolean; attempts: number; retryAfterMs: number } {
    this.attempts = this.attempts.filter(at => now - at < RENDERER_RECOVERY_WINDOW_MS && now >= at);
    if (this.attempts.length >= RENDERER_RECOVERY_MAX_ATTEMPTS) {
      return {
        allowed: false,
        attempts: this.attempts.length,
        retryAfterMs: Math.max(0, RENDERER_RECOVERY_WINDOW_MS - (now - this.attempts[0])),
      };
    }
    this.attempts.push(now);
    return { allowed: true, attempts: this.attempts.length, retryAfterMs: RENDERER_RECOVERY_DELAY_MS };
  }

  reset(): void {
    this.attempts = [];
  }
}
