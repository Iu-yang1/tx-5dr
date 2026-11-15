import { randomUUID } from 'node:crypto';
import type { MfskManualQso, QSORecord } from '@tx5dr/contracts';

/** Construct the single canonical record passed to native QSO completion. */
export function buildMfskManualQsoRecord(
  item: MfskManualQso,
  operator: { myCallsign: string; myGrid?: string },
): QSORecord {
  return {
    id: randomUUID(),
    callsign: item.callsign,
    ...(item.grid ? { grid: item.grid } : {}),
    ...(item.qth ? { qth: item.qth } : {}),
    ...(item.comment ? { comment: item.comment } : {}),
    frequency: item.frequencyHz,
    mode: item.mode,
    startTime: item.startTime,
    endTime: item.endTime,
    ...(item.reportSent ? { reportSent: item.reportSent } : {}),
    ...(item.reportReceived ? { reportReceived: item.reportReceived } : {}),
    messageHistory: item.messageHistory,
    myCallsign: operator.myCallsign,
    ...(operator.myGrid ? { myGrid: operator.myGrid } : {}),
    ...(item.q65Submode ? { notes: 'Q65 submode: ' + item.q65Submode } : {}),
    ...(item.mode === 'JTTY' ? { notes: 'Experimental JTTY continuous mode; ADIF compatibility projection applies' } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
    lotwQslSent: 'N',
    lotwQslReceived: 'N',
    qrzQslSent: 'N',
    qrzQslReceived: 'N',
  };
}
