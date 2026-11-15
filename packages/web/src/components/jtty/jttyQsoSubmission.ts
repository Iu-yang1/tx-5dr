import { api } from '@tx5dr/core';

export interface JttyQsoSubmission {
  callsign: string;
  frequency: number;
  startTime: number;
  endTime: number;
  reportSent: string;
  reportReceived: string;
  grid?: string;
  qth?: string;
  comment?: string;
}

/** New JTTY records must use the native manual-completion route, not createQSO. */
export async function confirmJttyQso(operatorId: string, body: JttyQsoSubmission): Promise<void> {
  const response = await api.confirmMfskQso({
    mode: 'JTTY',
    operatorId,
    callsign: body.callsign,
    frequencyHz: body.frequency,
    startTime: body.startTime,
    endTime: body.endTime,
    reportSent: body.reportSent,
    reportReceived: body.reportReceived,
    ...(body.grid ? { grid: body.grid } : {}),
    ...(body.qth?.trim() ? { qth: body.qth.trim() } : {}),
    ...(body.comment?.trim() ? { comment: body.comment.trim() } : {}),
    messageHistory: [],
  });
  if (!response.success) throw new Error('JTTY QSO confirmation failed');
}
