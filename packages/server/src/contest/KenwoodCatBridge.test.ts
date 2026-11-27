import { describe, expect, it, vi } from 'vitest';
import type { RadioController, RigctlMode } from '@tx5dr/rigctld-server';
import { KenwoodCatSession } from './KenwoodCatBridge.js';
function fixture(allowPtt = false) {
  let hz = 14025000, mode: RigctlMode = 'CW', ptt = false, wpm = 25;
  const radio: RadioController = {
    async getFrequency() { return hz; },
    async setFrequency(next) { hz = next; },
    async getMode() { return { mode, bandwidthHz: 400 }; },
    async setMode(next) { mode = next; },
    async getPTT() { return ptt; },
    setPTT: vi.fn(async (on: boolean) => { ptt = on; }),
  };
  const session = new KenwoodCatSession(radio, { async get() { return wpm; }, async set(next) { wpm = next; } }, allowPtt);
  return { radio, session, dial: (next: number) => { hz = next; } };
}
describe('N1MM single VFO CAT subset', () => {
  it('reflects physical dial changes and logger tuning on one owner', async () => {
    const { session, radio, dial } = fixture();
    expect(await session.command('ID')).toBe('ID021;');
    expect(await session.command('FA')).toBe('FA00014025000;');
    dial(7025000);
    expect(await session.command('FA')).toBe('FA00007025000;');
    expect(await session.command('FA00014030000')).toBe('');
    expect(await radio.getFrequency()).toBe(14030000);
    const info = await session.command('IF');
    expect(info).toHaveLength(38);
    expect(info.slice(2,13)).toBe('00014030000');
    expect(info[29]).toBe('3');
    expect(await session.command('MD7')).toBe('');
    expect(await session.command('MD')).toBe('MD7;');
    expect(await session.command('KS032')).toBe('');
    expect(await session.command('KS')).toBe('KS032;');
    expect(await session.command('FB')).toBe('?;');
  });
  it('does not assert an independent PTT by default; opt-in PTT is released on close', async () => {
    const primary = fixture();
    expect(await primary.session.command('TX')).toBe('?;');
    expect(primary.radio.setPTT).not.toHaveBeenCalled();
    const enabled = fixture(true);
    expect(await enabled.session.command('TX')).toBe('');
    expect(await enabled.radio.getPTT()).toBe(true);
    await enabled.session.close();
    expect(await enabled.radio.getPTT()).toBe(false);
    expect(await enabled.session.command('TX')).toBe('?;');
  });
});
