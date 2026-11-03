import { useEffect, useState } from 'react';
import { Card, CardBody } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { api } from '@tx5dr/core';
import type { MfskCodecProbeResponse } from '@tx5dr/contracts';

/** Read-only diagnostic for a development build, not a six-mode mode switch. */
export function MfskCodecStatusCard() {
  const { t } = useTranslation('about');
  const [status, setStatus] = useState<MfskCodecProbeResponse | null>(null);

  useEffect(() => {
    let active = true;
    void api.getMfskCodecProbe().then(result => {
      if (active) setStatus(result);
    }).catch(() => {
      // Not all servers ship the experimental endpoint; do not suggest
      // availability or display an unauthenticated diagnostics surface.
    });
    return () => { active = false; };
  }, []);

  if (!status) return null;
  return <Card shadow="none">
    <CardBody className="gap-3 px-6 py-5">
      <h2 className="text-base font-semibold">{t('codec.title')}</h2>
      <p className="text-xs text-default-500">{t('codec.virtualOnly')}</p>
      {status.version && <p className="text-xs text-default-400">{status.version}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {status.capabilities.map(item => <div key={item.mode} className="rounded-md bg-default-100 p-2">
          <p className="font-medium text-sm">{item.mode}</p>
          <p className="text-xs text-default-500">{item.receiverReady ?
            t('codec.offlineReady') : t('codec.unavailable')}</p>
        </div>)}
      </div>
      <p className="text-xs text-default-500">{t('codec.noRf')}</p>
    </CardBody>
  </Card>;
}
