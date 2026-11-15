import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ confirmMfskQso: vi.fn(), createQSO: vi.fn() }));
vi.mock('@tx5dr/core', () => ({ api: mocked }));
import { confirmJttyQso } from '../jttyQsoSubmission';

const body = {
  callsign: 'JA1ABC', frequency: 14080000, startTime: 1000, endTime: 1800,
  reportSent: '599', reportReceived: '579', grid: 'PM95',
  qth: 'Tokyo', comment: 'Portable station',
};

describe('JTTY native QSO confirmation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('passes all supported fields exactly once through the native JTTY route', async () => {
    mocked.confirmMfskQso.mockResolvedValue({ success: true, id: 'qso-1' });
    await confirmJttyQso('operator-1', body);
    expect(mocked.confirmMfskQso).toHaveBeenCalledTimes(1);
    expect(mocked.confirmMfskQso).toHaveBeenCalledWith({
      mode: 'JTTY', operatorId: 'operator-1', callsign: 'JA1ABC',
      frequencyHz: 14080000, startTime: 1000, endTime: 1800,
      reportSent: '599', reportReceived: '579', grid: 'PM95',
      qth: 'Tokyo', comment: 'Portable station', messageHistory: [],
    });
    expect(mocked.createQSO).not.toHaveBeenCalled();
  });

  it('does not report success when the server rejects native confirmation', async () => {
    mocked.confirmMfskQso.mockResolvedValue({ success: false });
    await expect(confirmJttyQso('operator-1', body)).rejects.toThrow('confirmation failed');
  });
});
