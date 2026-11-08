import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardBody, Input, Switch } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import type { PublicTunnelSettings, PublicTunnelStatus, RemoteAccessPreset } from '@tx5dr/contracts';
import { isPublicTunnelPresetReady } from './publicTunnelPrerequisites';

type TunnelField = { key: keyof PublicTunnelSettings; label: string; placeholder: string; numeric?: boolean; labelKey?: string };
const connectionFields: TunnelField[] = [
  { key: 'frpcPath', label: 'frpc', placeholder: 'C:\\tools\\frp\\frpc.exe' },
  { key: 'serverHost', label: 'FRP server / VPS', placeholder: 'tunnel.example.com' },
  { key: 'serverPort', label: 'FRP TCP port', placeholder: '7000', numeric: true },
  { key: 'publicHost', label: 'Public HTTPS host (domain or IP)', placeholder: 'radio.example.com or 203.0.113.10' },
];
const proxyFields: TunnelField[] = [
  { key: 'remoteWebPort', label: 'VPS web TCP port', placeholder: '18076', numeric: true },
  { key: 'remoteUdpPort', label: 'VPS WebRTC UDP port', placeholder: '50110', numeric: true },
  { key: 'localUdpPort', label: 'TX5DR WebRTC UDP port', placeholder: '50110', numeric: true },
  { key: 'localWebIP', label: 'Web TCP localIP', labelKey: 'system.publicTunnelLocalWebIP', placeholder: '127.0.0.1 / 192.168.1.5' },
  { key: 'localWebPort', label: 'Web TCP localPort', labelKey: 'system.publicTunnelLocalWebPort', placeholder: '0 = auto', numeric: true },
  { key: 'localUdpIP', label: 'WebRTC UDP localIP', labelKey: 'system.publicTunnelLocalUdpIP', placeholder: '127.0.0.1 / 192.168.1.5' },
  { key: 'webProxyName', label: 'Web TCP proxy name', labelKey: 'system.publicTunnelWebProxyName', placeholder: 'tx5dr-web' },
  { key: 'rtcUdpProxyName', label: 'WebRTC UDP proxy name', labelKey: 'system.publicTunnelRtcProxyName', placeholder: 'tx5dr-rtc-udp' },
];

interface PublicTunnelSettingsCardProps {
  selectedRemoteAccessPreset: RemoteAccessPreset | null;
  savedRemoteAccessPreset: RemoteAccessPreset | null;
  remoteAccessHasUnsavedChanges: boolean;
}

export function PublicTunnelSettingsCard({
  selectedRemoteAccessPreset,
  savedRemoteAccessPreset,
  remoteAccessHasUnsavedChanges,
}: PublicTunnelSettingsCardProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PublicTunnelStatus | null>(null);
  const [electronPreset, setElectronPreset] = useState<RemoteAccessPreset | null>(null);
  const [draft, setDraft] = useState<PublicTunnelSettings | null>(null);
  const [token, setToken] = useState('');
  const tokenInvalid = token.length > 0 && (!token.trim() || /[\r\n]/.test(token));
  const proxyNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  const proxyNamesInvalid = Boolean(draft && (
    !proxyNamePattern.test(draft.webProxyName)
    || !proxyNamePattern.test(draft.rtcUdpProxyName)
    || draft.webProxyName === draft.rtcUdpProxyName
  ));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = typeof window !== 'undefined' ? window.electronAPI?.publicTunnel : undefined;
  const presetApi = typeof window !== 'undefined' ? window.electronAPI?.remoteAccess : undefined;
  const publicPresetReady = isPublicTunnelPresetReady({
    selectedPreset: selectedRemoteAccessPreset,
    savedPreset: savedRemoteAccessPreset,
    electronPreset,
    hasUnsavedChanges: remoteAccessHasUnsavedChanges,
  });

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

  // Read the authoritative Electron preset, not just the unsaved settings form.
  // Recheck when the parent finishes applying a new access preset.
  useEffect(() => {
    let active = true;
    void presetApi?.getPreset().then((preset) => {
      if (active) setElectronPreset(preset);
    }).catch((reason) => {
      if (active) setError(String(reason));
    });
    return () => { active = false; };
  }, [presetApi, savedRemoteAccessPreset]);

  const invoke = async (action: () => Promise<PublicTunnelStatus>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setStatus(result);
      setDraft(result.settings);
    } catch (reason) {
      const reasonText = reason instanceof Error ? reason.message : String(reason);
      setError(reasonText.includes('tunnel_token_invalid')
        ? t('system.publicTunnelTokenInvalid')
        : reasonText.includes('tunnel_invalid_local_ip')
          ? t('system.publicTunnelLocalIPInvalid')
          : reasonText.includes('tunnel_invalid_proxy_name')
            ? t('system.publicTunnelProxyNameInvalid')
            : reasonText.includes('tunnel_duplicate_proxy_names')
              ? t('system.publicTunnelProxyNameDuplicate')
        : reasonText.includes('tunnel_requires_public_preset')
          ? t('system.publicTunnelPresetRequired')
          : reasonText.includes('tunnel_public_authentication_required')
            ? t('system.publicTunnelAuthRequired')
            : reasonText);
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

  const browse = async () => {
    const chosen = await window.electronAPI?.fs?.selectFile({
      title: 'Choose frpc executable',
    });
    if (chosen) updateField('frpcPath', chosen);
  };

  const start = () => {
    if (!publicPresetReady) {
      setError(t('system.publicTunnelPresetRequired'));
      return;
    }
    void invoke(async () => {
      // A fresh IPC read closes the race with external preset changes.
      const preset = await presetApi?.getPreset();
      setElectronPreset(preset ?? null);
      if (preset !== 'public') throw new Error('tunnel_requires_public_preset');
      return api!.start();
    });
  };

  const save = () => {
    if (!draft) return;
    if (proxyNamesInvalid) {
      setError(draft.webProxyName === draft.rtcUdpProxyName
        ? t('system.publicTunnelProxyNameDuplicate')
        : t('system.publicTunnelProxyNameInvalid'));
      return;
    }
    if (tokenInvalid) {
      setError(t('system.publicTunnelTokenInvalid'));
      return;
    }
    void invoke(async () => {
      const next = await api.save({
        ...draft,
        ...(token.length > 0 ? { authToken: token } : {}),
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
        <Alert color="warning" variant="flat">{t('system.publicTunnelTlsUnverified')}</Alert>
        {!publicPresetReady && (
          <Alert color="warning" variant="flat">
            {selectedRemoteAccessPreset === 'public' && (
              remoteAccessHasUnsavedChanges || savedRemoteAccessPreset !== 'public'
            )
              ? t('system.publicTunnelPresetPendingSave')
              : t('system.publicTunnelPresetRequired')}
          </Alert>
        )}
        {error && <Alert color="danger" variant="flat">{error}</Alert>}
        {draft && (
          <>
            <h5 className="text-sm font-medium text-default-900">{t('system.publicTunnelConnectionSection')}</h5>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {connectionFields.map((field) => (
                <div key={field.key} className="flex gap-1 items-end">
                  <Input
                    size="sm"
                    type={field.numeric ? 'number' : 'text'}
                    label={field.labelKey ? t(field.labelKey) : field.label}
                    placeholder={field.placeholder}
                    isInvalid={(field.key === 'webProxyName' || field.key === 'rtcUdpProxyName') && proxyNamesInvalid}
                    value={fieldValue(field.key)}
                    onValueChange={(value) => updateField(field.key, value, field.numeric)}
                    isDisabled={busy || status?.running}
                  />
                  {field.key === 'frpcPath' && (
                    <Button size="sm" variant="flat" onPress={() => void browse()} isDisabled={busy || status?.running}>
                      {t('system.publicTunnelBrowse')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <h5 className="text-sm font-medium text-default-900">{t('system.publicTunnelProxySection')}</h5>
            <p className="text-xs text-default-600">{t('system.publicTunnelWebPortHelp')}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {proxyFields.map((field) => (
                <Input
                  key={field.key}
                  size="sm"
                  type={field.numeric ? 'number' : 'text'}
                  label={field.labelKey ? t(field.labelKey) : field.label}
                  placeholder={field.placeholder}
                  isInvalid={(field.key === 'webProxyName' || field.key === 'rtcUdpProxyName') && proxyNamesInvalid}
                  value={fieldValue(field.key)}
                  onValueChange={(value) => updateField(field.key, value, field.numeric)}
                  isDisabled={busy || status?.running}
                />
              ))}
            </div>
            <label className="flex max-w-xs flex-col gap-1 text-sm text-default-700">
              {t('system.publicTunnelLogLevel')}
              <select
                className="h-10 rounded-lg border border-divider bg-content1 px-3"
                value={draft.logLevel}
                onChange={(event) => setDraft({ ...draft, logLevel: event.target.value as PublicTunnelSettings['logLevel'] })}
                disabled={busy || status?.running}
              >
                {(['error', 'warn', 'info', 'debug'] as const).map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
            <Input
              size="sm"
              type="password"
              label={t('system.publicTunnelToken')}
              placeholder={status?.hasToken ? t('system.publicTunnelTokenRetained') : t('system.publicTunnelTokenPlaceholder')}
              value={token}
              onValueChange={setToken}
              isInvalid={tokenInvalid}
              errorMessage={tokenInvalid ? t('system.publicTunnelTokenInvalid') : undefined}
              description={t('system.publicTunnelTokenRequirement')}
              isDisabled={busy || status?.running}
            />
            <Switch size="sm" isSelected={draft.autoStart} isDisabled={busy || status?.running} onValueChange={(value) => setDraft({ ...draft, autoStart: value })}>
              {t('system.publicTunnelAutoStart')}
            </Switch>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" color="primary" onPress={save} isDisabled={busy || status?.running || tokenInvalid || proxyNamesInvalid}>{t('system.publicTunnelSave')}</Button>
              <Button size="sm" color="success" variant="flat" onPress={start} isDisabled={busy || !status?.hasToken || status?.running || !publicPresetReady}>
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
            <a href="https://github.com/Iu-yang1/tx-5dr/blob/main/docs/deployment/public-remote-caddy-frp.md" target="_blank" rel="noopener noreferrer" className="text-primary text-sm underline">
              {t('system.publicTunnelGuide')}
            </a>
          </>
        )}
      </CardBody>
    </Card>
  );
}
