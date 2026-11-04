import { describe, expect, it } from 'vitest';
import { projectNativeDigitalFrames } from './NativeDigitalSlotBridge';

describe('native decodes to legacy SlotPack projection', () => {
  it('preserves true Q65-120 UTC slot and source SNR/Hz precision', () => {
    const rows = projectNativeDigitalFrames([{
      kind:'slot-decode',sessionId:'x',mode:'Q65',slotId:'Q65-120D-12-1440000',
      timestampMs:1560100, frequencyHz:1510.48, snrDb:-19.64,
      dtSeconds:2.18, text:'CQ BG5JSU OL79',final:true,
    }], 'Q65','Q65-120D');
    expect(rows).toHaveLength(1);
    expect(rows[0].presentationSlotMs).toBe(120000);
    expect(rows[0].result.slotId).toBe('slot-1440000');
    expect(rows[0].result.frames[0]).toMatchObject({
      snr:-19.64,freq:1510.48,dt:2.18,
    });
  });
  it('batches multiple MSK144 detections as display bins, not fake UTC transmit slots', () => {
    const make = (timestampMs:number) => ({
      kind:'burst-decode' as const,sessionId:'x',mode:'MSK144' as const,
      timestampMs,frequencyHz:1501.2,snrDb:-8.7,text:'BG5JSU HB9Q -10',
      observationWindowMs:100,
    });
    const rows = projectNativeDigitalFrames([make(10100),make(10800)],'MSK144');
    expect(rows).toHaveLength(1);
    expect(rows[0].presentationSlotMs).toBe(5000);
    expect(rows[0].result.frames).toHaveLength(2);
  });
  it('does not put mutable JTTY transcript or stale modes into slot packs', () => {
    expect(projectNativeDigitalFrames([{
      kind:'message-update',sessionId:'x',mode:'JTTY',timestampMs:10,
      frequencyHz:1700,messageId:'abc',revision:1,state:'growing',text:'CQ',
    }],'JTTY')).toEqual([]);
    expect(projectNativeDigitalFrames([{
      kind:'burst-decode',sessionId:'x',mode:'MSK144',timestampMs:20000,
      frequencyHz:1400,snrDb:-3,text:'CQ TEST',observationWindowMs:100,
    }],'Q65')).toEqual([]);
  });
});
