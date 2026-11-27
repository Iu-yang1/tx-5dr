import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { ModeRightTopTabs } from '../keyboard-mode/ModeRightTopTabs';
import { CQWWWorkbench } from './CQWWWorkbench';
import { updateCWContestProfile } from '../../store/cwContestProfileStore';

interface CWRightTopTabsProps {
  operatorId: string | null | undefined;
  nativeContent: React.ReactNode;
  toolbarRight?: React.ReactNode;
}

export const CWRightTopTabs: React.FC<CWRightTopTabsProps> = (props) => {
  const { t } = useTranslation('radio');
  const onSelectedKeyChange = React.useCallback((key: string) => updateCWContestProfile({ active: key === 'cqww-cw' }), []);
  React.useEffect(() => () => updateCWContestProfile({ active: false }), []);
  const contestItems = React.useMemo(() => [{ key: 'cqww-cw', label: 'CQ WW CW', content: <CQWWWorkbench /> }], []);
  return (
    <ModeRightTopTabs
      {...props}
      slotId="cw-right-top"
      extraNativeItems={contestItems}
      onSelectedKeyChange={onSelectedKeyChange}
      nativeTabLabel={t('cw.qsoTab', 'QSOs')}
    />
  );
};
