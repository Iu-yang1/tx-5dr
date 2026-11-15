import { describe, expect, it } from 'vitest';
import { MfskManualQsoSchema, QSORecordSchema } from '@tx5dr/contracts';
import { buildMfskManualQsoRecord } from '../mfskQsoRecord.js';

describe('Native manual QSO record', () => {
  it('preserves new JTTY QTH, ADIF COMMENT and optional NOTES atomically', () => {
    const request = MfskManualQsoSchema.parse({
      mode: 'JTTY', operatorId: 'operator-1', callsign: 'ja1abc', grid: 'PM95',
      frequencyHz: 14080000, startTime: 1000, endTime: 1800,
      reportSent: '599', reportReceived: '579', qth: 'Tokyo',
      comment: 'Portable station, portable antenna',
      notes: 'Operator supplied notes', messageHistory: [],
    });
    const record = QSORecordSchema.parse(buildMfskManualQsoRecord(request, {
      myCallsign: 'BG5JSU', myGrid: 'OL79WQ',
    }));
    expect(record).toMatchObject({
      mode: 'JTTY', callsign: 'JA1ABC', qth: 'Tokyo',
      comment: 'Portable station, portable antenna',
      notes: 'Operator supplied notes', myCallsign: 'BG5JSU',
      grid: 'PM95',
    });
  });

  it('keeps previous Q65 native confirmation semantics without extra fields', () => {
    const request = MfskManualQsoSchema.parse({
      mode: 'Q65', q65Submode: 'Q65-60B', operatorId: 'operator-1',
      callsign: 'HB9Q', frequencyHz: 432080000,
      startTime: 1000, endTime: 1800,
    });
    const record = buildMfskManualQsoRecord(request, { myCallsign: 'BG5JSU' });
    expect(record.notes).toBe('Q65 submode: Q65-60B');
    expect(record.qth).toBeUndefined();
    expect(record.comment).toBeUndefined();
  });

  it('validates bounded optional text fields at the native API boundary', () => {
    const basic = {
      mode: 'JTTY', operatorId: 'operator-1', callsign: 'JA1ABC',
      frequencyHz: 14080000, startTime: 1000, endTime: 1800,
    };
    expect(MfskManualQsoSchema.safeParse({ ...basic, qth: 'Q'.repeat(257) }).success).toBe(false);
    expect(MfskManualQsoSchema.safeParse({ ...basic, comment: 'A'.repeat(2049) }).success).toBe(false);
  });
});
