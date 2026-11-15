import React from 'react';
import { Input } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { jttyQsoDraftStore, useJttyQSODraft } from '../../store/jttyQsoDraftStore';

/** Compact draft fields on the receive tab; logging remains an explicit action in QSO Log. */
export function JttyMobileQsoBar() {
  const { t } = useTranslation('radio');
  const { hisCallsign, rrst } = useJttyQSODraft();
  return <div className="grid grid-cols-2 gap-2 rounded-lg bg-content2/50 p-2">
    <Input size="sm" label={t('jtty.workbench.dxCall')} value={hisCallsign}
      onValueChange={jttyQsoDraftStore.setHisCallsign} />
    <Input size="sm" label={t('jtty.workbench.receivedReport')} value={rrst}
      onValueChange={jttyQsoDraftStore.setRrst} />
  </div>;
}
