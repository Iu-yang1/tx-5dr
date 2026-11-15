import React, { useCallback } from 'react';
import type { QSORecord } from '@tx5dr/contracts';
import { api } from '@tx5dr/core';
import { useCurrentOperatorId, useRadioModeState } from '../../store/radioStore';
import { jttyQsoDraftStore } from '../../store/jttyQsoDraftStore';
import { useJtty } from '../../hooks/useJtty';
import { ModeQSOLogCard } from '../keyboard-mode/ModeQSOLogCard';

interface Props {
  editingQSO?: QSORecord | null;
  onEditComplete?: (record: QSORecord) => void;
  onDeleteComplete?: (id: string) => void;
  onCancelEdit?: () => void;
}

/** New JTTY QSOs use the native MFSK confirmation route; edits keep the shared logbook route. */
export function JttyQSOLogCard(props: Props) {
  const { currentOperatorId } = useCurrentOperatorId();
  const { currentRadioFrequency } = useRadioModeState();
  const { txBusy, txPhase } = useJtty();
  const createQso = useCallback(async (body: {
    callsign: string; frequency: number; startTime: number; endTime: number;
    reportSent: string; reportReceived: string; grid?: string;
  }) => {
    if (!currentOperatorId) throw new Error('JTTY operator required');
    if (!currentRadioFrequency || currentRadioFrequency < 1000) throw new Error('Radio frequency unavailable');
    const result = await api.confirmMfskQso({
      mode: 'JTTY',
      operatorId: currentOperatorId,
      callsign: body.callsign,
      frequencyHz: body.frequency,
      startTime: body.startTime,
      endTime: body.endTime,
      reportSent: body.reportSent,
      reportReceived: body.reportReceived,
      ...(body.grid ? { grid: body.grid } : {}),
      messageHistory: [],
    });
    if (!result.success) throw new Error('JTTY QSO confirmation failed');
  }, [currentOperatorId, currentRadioFrequency]);
  return <ModeQSOLogCard
    {...props}
    mode="JTTY" defaultReport="599" rstMaxLength={3}
    txActive={txBusy || txPhase === 'processing' || txPhase === 'transmitting'}
    draftStore={jttyQsoDraftStore}
    i18nPrefix="radio:jtty.qso"
    syncReportsFromDraft startTimeFromCallsign hideExtendedFields
    createQso={createQso}
  />;
}
