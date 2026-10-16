import { describe, expect, it } from 'vitest';
import { RendererRecoveryBudget, RENDERER_RECOVERY_DELAY_MS, RENDERER_RECOVERY_WINDOW_MS } from '../rendererRecovery.js';

describe('RendererRecoveryBudget', () => {
  it('allows five crashes in ten minutes, then blocks an automatic crash loop', () => {
    const budget = new RendererRecoveryBudget();
    for (let n = 0; n < 5; n += 1) {
      expect(budget.recordCrash(n * 1_000)).toEqual({
        allowed: true, attempts: n + 1, retryAfterMs: RENDERER_RECOVERY_DELAY_MS,
      });
    }
    expect(budget.recordCrash(5_000)).toEqual({
      allowed: false, attempts: 5, retryAfterMs: RENDERER_RECOVERY_WINDOW_MS - 5_000,
    });
    expect(budget.recordCrash(RENDERER_RECOVERY_WINDOW_MS)).toEqual({
      allowed: true, attempts: 5, retryAfterMs: RENDERER_RECOVERY_DELAY_MS,
    });
  });

  it('manual retry resets exhausted automatic recovery budget', () => {
    const budget = new RendererRecoveryBudget();
    for (let i = 0; i < 5; i += 1) budget.recordCrash(100 + i);
    expect(budget.recordCrash(1000).allowed).toBe(false);
    budget.reset();
    expect(budget.recordCrash(1001).allowed).toBe(true);
  });

  it('ignores invalid backwards time without storing repeated timestamps forever', () => {
    const budget = new RendererRecoveryBudget();
    budget.recordCrash(12_000);
    const state = budget.recordCrash(0);
    expect(state.attempts).toBe(1);
  });
});
