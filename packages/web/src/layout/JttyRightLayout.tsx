import React, { useCallback, useState } from 'react';
import type { QSORecord } from '@tx5dr/contracts';
import { useTranslation } from 'react-i18next';
import { Button } from '@heroui/react';
import { RadioControl } from '../components/radio/control/RadioControl';
import { JttyQSOLogCard } from '../components/jtty/JttyQSOLogCard';
import { ModeRecentQSOList } from '../components/keyboard-mode/ModeRecentQSOList';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { ClientNotificationButton } from '../components/common/ClientNotificationButton';
import { ServerHealthButton } from '../components/system/ServerHealthButton';
import { SettingsButton } from '../components/common/SettingsButton';
import { useCurrentOperatorId } from '../store/radioStore';
import { openLogbookWindow } from '../utils/windowManager';

export const JttyRightLayout: React.FC = () => {
  const { t } = useTranslation('radio');
  const { currentOperatorId } = useCurrentOperatorId();
  const [editingQSO, setEditingQSO] = useState<QSORecord | null>(null);
  const [lastUpdatedQSO, setLastUpdatedQSO] = useState<QSORecord | null>(null);
  const [lastDeletedId, setLastDeletedId] = useState<string | null>(null);
  const handleEditComplete = useCallback((record: QSORecord) => {
    setLastUpdatedQSO(record);
    setEditingQSO(null);
  }, []);
  const handleDeleteComplete = useCallback((id: string) => {
    setLastDeletedId(id);
    setEditingQSO(null);
  }, []);

  return <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-2 md:px-4">
      <span className="text-sm font-semibold">{t('jtty.workbench.qsoTitle')}</span>
      <div className="flex items-center gap-1">
        <Button variant="light" size="sm" isDisabled={!currentOperatorId}
          onPress={() => currentOperatorId && openLogbookWindow({ operatorId: currentOperatorId })}>
          {t('jtty.workbench.logbook')}
        </Button>
        <ServerHealthButton />
        <ClientNotificationButton />
        <ThemeToggle variant="dropdown" size="sm" />
        <SettingsButton />
      </div>
    </div>
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-2 md:px-5">
      <div className="flex-1 min-h-[9rem]">
        <ModeRecentQSOList
          i18nPrefix="jtty.recentQSO" excludeModes="" includeModes="JTTY"
          selectedQSOId={editingQSO?.id ?? null}
          onSelectQSO={setEditingQSO}
          onDeselectQSO={() => setEditingQSO(null)}
          lastUpdatedQSO={lastUpdatedQSO} lastDeletedId={lastDeletedId}
        />
      </div>
      <div className="shrink-0">
        <JttyQSOLogCard editingQSO={editingQSO}
          onEditComplete={handleEditComplete}
          onDeleteComplete={handleDeleteComplete}
          onCancelEdit={() => setEditingQSO(null)} />
      </div>
    </div>
    <div className="shrink-0 px-2 pb-2 md:px-5 md:pb-5">
      <RadioControl onOpenRadioSettings={() => window.dispatchEvent(new Event('openProfileModal'))} />
    </div>
  </div>;
};
