import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { ModeRightTopTabs } from '../keyboard-mode/ModeRightTopTabs';
import { CQWWWorkbench } from './CQWWWorkbench';

interface CWRightTopTabsProps {
  operatorId: string | null | undefined;
  nativeContent: React.ReactNode;
  toolbarRight?: React.ReactNode;
}

export const CWRightTopTabs: React.FC<CWRightTopTabsProps> = (props) => {
  const { t } = useTranslation('radio');
  const contestItems = React.useMemo(() => [{ key: 'cqww-cw', label: 'CQ WW CW', content: <CQWWWorkbench /> }], []);
  return (
    <ModeRightTopTabs
      {...props}
      slotId="cw-right-top"
      extraNativeItems={contestItems}
      nativeTabLabel={t('cw.qsoTab', 'QSOs')}
    />
  );
};
