import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardBody, Input, Switch } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import type { PublicTunnelSettings, PublicTunnelStatus } from '@tx5dr/contracts';

const fields: Array<{ key: keyof PublicTunnelSettings; label: string; placeholder: string; numeric?: boolean }> = [
  { key: 'frpcPath', label: 'frpc', placeholder: 'C:\\tools\\frp\\frpc.exe' },
  { key: 'serverHost', label: 'FRP server / VPS', placeholder: 'tunnel.example.com' },
  { key: 'serverPort', label: 'FRP TCP port', placeholder: '7000', numeric: true },
  { key: 'publicHost', label: 'Public HTTPS domain (Nginx)', placeholder: 'radio.example.com' },
  { key: 'remoteWebPort', label: 'VPS web TCP port', placeholder: '18076', numeric: true },
  { key: 'remoteUdpPort', label: 'VPS WebRTC UDP port', placeholder: '50110', numeric: true },
  { key: 'localUdpPort', label: 'TX5DR WebRTC UDP port', placeholder: '50110', numeric: true },
  { key: 'trustedCaFile', label: 'Private CA certificate (optional)', placeholder: 'C:\\frp\\ca.crt' },
];

export function PublicTunnelSettingsCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PublicTunnelStatus | null>(null);
  const [draft, setDraft] = useState<PublicTunnelSettings | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = typeof window !== 'undefined' ? window.electronAPI?.publicTunnel : undefined;

  useEffect(() => {
    let active = true;
    void api?.getStatus().then((result) => {
      if (!active) return;
      setStatus(result);
      setDraft(result.settings);
    }).catch((reason) => {
      if (active) setError(String(reason));
    });
    return () => { active = false; };
  }, [api]);

  const invoke = async (action: () => Promise<PublicTunnelStatus>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setStatus(result);
      setDraft(result.settings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!api) return null;

  const fieldValue = (key: keyof PublicTunnelSettings): string =>
    String(draft?.[key] ?? '');

  const updateField = (key: keyof PublicTunnelSettings, value: string, numeric?: boolean) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: numeric ? Number(value) : value });
  };

  const browse = async (key: 'frpcPath' | 'trustedCaFile') => {
    const chosen = await window.electronAPI?.fs?.selectFile({
      title: key === 'frpcPath' ? 'Choose frpc executable' : 'Choose trusted CA certificate',
    });
    if (chosen) updateField(key, chosen);
  };

  const save = () => {
    if (!draft) return;
    void invoke(async () => {
      const next = await api.save({
        ...draft,
        ...(token.trim() ? { authToken: token.trim() } : {}),
      });
      setToken('');
      return next;
    });
  };

  return (
    <Card shadow="none" radius="lg" className="order-1 border border-divider bg-content1">
      <CardBody className="p-5 space-y-4">
        <div>
          <h4 className="text-base font-semibold">{t('system.publicTunnelTitle')}</h4>
          <p className="mt-1 text-sm text-default-600">{t('system.publicTunnelDescription')}</p>
        </div>
        <Alert color="default" variant="flat">{t('system.publicTunnelVpsReminder')}</Alert>
        {error && <Alert color="danger" variant="flat">{error}</Alert>}
        {draft && (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fields.map((field) => (
                <div key={field.key} className="flex gap-1 items-end">
                  <Input
                    size="sm"
                    type={field.numeric ? 'number' : 'text'}
                    label={field.label}
                    placeholder={field.placeholder}
                    value={fieldValue(field.key)}
                    onValueChange={(value) => updateField(field.key, value, field.numeric)}
                    isDisabled={busy || status?.running}
                  />
                  {(field.key === 'frpcPath' || field.key === 'trustedCaFile') && (
                    <Button size="sm" variant="flat" onPress={() => void browse(field.key as 'frpcPath' | 'trustedCaFile')} isDisabled={busy || status?.running}>
                      {t('system.publicTunnelBrowse')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Input
              size="sm"
              type="password"
              label={t('system.publicTunnelToken')}
              placeholder={status?.hasToken ? t('system.publicTunnelTokenRetained') : t('system.publicTunnelTokenPlaceholder')}
              value={token}
              onValueChange={setToken}
              isDisabled={busy || status?.running}
            />
            <Switch size="sm" isSelected={draft.autoStart} isDisabled={busy || status?.running} onValueChange={(value) => setDraft({ ...draft, autoStart: value })}>
              {t('system.publicTunnelAutoStart')}
            </Switch>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" color="primary" onPress={save} isDisabled={busy || status?.running}>{t('system.publicTunnelSave')}</Button>
              <Button size="sm" color="success" variant="flat" onPress={() => void invoke(() => api.start())} isDisabled={busy || !status?.hasToken || status?.running}>
                {t('system.publicTunnelStart')}
              </Button>
              <Button size="sm" color="danger" variant="flat" onPress={() => void invoke(() => api.stop())} isDisabled={busy || !status?.running}>
                {t('system.publicTunnelStop')}
              </Button>
              <Button size="sm" variant="flat" onPress={() => void invoke(() => api.getStatus())} isDisabled={busy}>{t('system.publicTunnelRefresh')}</Button>
              <Button size="sm" variant="light" onPress={() => void api.openFolder()}>{t('system.publicTunnelOpenFolder')}</Button>
            </div>
            <div className="text-xs text-default-600 space-y-1">
              <p>{status?.running ? t('system.publicTunnelRunning') : t('system.publicTunnelStopped')}{status?.pid ? ` (PID ${status.pid})` : ''}</p>
              <p>{t('system.publicTunnelPublicAddress')}: {draft.publicHost ? `https://${draft.publicHost}` : '—'}</p>
              <p>{t('system.publicTunnelMediaHint', { host: draft.serverHost, port: draft.remoteUdpPort })}</p>
              {status?.lastError && <p className="text-danger-600">{status.lastError}</p>}
            </div>
            <a href="https://github.com/Iu-yang1/tx-5dr/blob/main/docs/deployment/public-remote-nginx-frp.md" target="_blank" rel="noopener noreferrer" className="text-primary text-sm underline">
              {t('system.publicTunnelGuide')}
            </a>
          </>
        )}
      </CardBody>
    </Card>
  );
}
