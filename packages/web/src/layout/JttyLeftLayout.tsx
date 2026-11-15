import React, { useEffect, useState } from 'react';
import { Card, CardBody } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { SpectrumDisplay } from '../components/radio/spectrum/SpectrumDisplay';
import { RadioMetersPanel } from '../components/radio/control/RadioMetersPanel';
import { JttyReceiveTerminal } from '../components/radio/digital/JttyReceiveTerminal';
import { JttyMacroPanel } from '../components/jtty/JttyMacroPanel';
import { JttyMobileQsoBar } from '../components/jtty/JttyMobileQsoBar';
import { ClockDisplay } from '../components/system/ClockDisplay';
import { StationInfoPopover } from '../components/station/StationInfoPopover';

export const JttyLeftLayout: React.FC = () => {
  const { t } = useTranslation('radio');
  const [isMobile, setIsMobile] = useState(false);
  const [isShort, setIsShort] = useState(false);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 767px)');
    const short = window.matchMedia('(max-height: 820px)');
    const update = () => { setIsMobile(mobile.matches); setIsShort(short.matches); };
    update();
    mobile.addEventListener('change', update);
    short.addEventListener('change', update);
    return () => { mobile.removeEventListener('change', update); short.removeEventListener('change', update); };
  }, []);

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <StationInfoPopover />
        <span className="truncate text-xs font-semibold text-default-500">{t('jtty.workbench.title')}</span>
      </div>
      <ClockDisplay />
    </div>
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-2 md:px-5 md:pb-4">
      <Card shadow="sm" className="shrink-0 overflow-hidden">
        <CardBody className="p-0">
          <SpectrumDisplay height={isMobile ? 80 : isShort ? 72 : 120} />
        </CardBody>
      </Card>
      {!isShort && <RadioMetersPanel className="shrink-0" enableAlcOverLimitPrompt={false} />}
      {isMobile && <JttyMobileQsoBar />}
      <JttyReceiveTerminal className="flex-1 min-h-[15rem]" />
      <div className="shrink-0"><JttyMacroPanel /></div>
    </div>
  </div>;
};
