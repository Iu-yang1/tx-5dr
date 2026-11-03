// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MfskLiveReceiverPanel } from './MfskLiveReceiverPanel';

const mock = vi.hoisted(() => ({
  transmit: vi.fn(async () => ({ success: true })),
  arm: vi.fn(async () => ({ success:true,rfEnabled:true,remainingMs:600000 })),
  disarm: vi.fn(async () => ({ success:true,rfEnabled:false,remainingMs:0 })),
  start: vi.fn(async () => ({mode:'Q65',q65Submode:'Q65-120D',ready:true,running:true,generation:8})),
  stop: vi.fn(async () => ({mode:'Q65',ready:false,running:false,generation:8})),
  events: vi.fn(async () => ({
    status: {
      ready: true, running: true, physicalTxEnabled: false,
      mode: 'Q65', q65Submode: 'Q65-120D', generation: 7,
      received: 0, droppedAudioChunks: 0, rejectedSlots: 0,
      workerFaults: 0,
    },
    events: [],
  })),
  txStatus: vi.fn(async () => ({ rfEnabled: true, busy: false, remainingMs: 90000 })),
}));

vi.mock('@heroui/react', () => ({
  Card: ({ children }: {children: React.ReactNode}) => <div>{children}</div>,
  CardBody: ({ children }: {children: React.ReactNode}) => <div>{children}</div>,
  Button: ({ children, onPress, isDisabled }: {
    children: React.ReactNode; onPress?: () => void; isDisabled?: boolean;
  }) => <button disabled={isDisabled} onClick={onPress}>{children}</button>,
  Input: ({ label, value, onValueChange }: {
    label: string;value: string;onValueChange: (value: string) => void;
  }) => <input aria-label={label} value={value} onChange={e=>onValueChange(e.target.value)}/>,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../store/authStore', () => ({ useCan: () => true }));
vi.mock('../../store/radioStore', () => ({
  useCurrentOperatorId: () => ({ currentOperatorId:'op1', setCurrentOperatorId:vi.fn() }),
  useOperators: () => ({ operators:[{ id:'op1', context:{myCall:'K1ABC'} }] }),
  useRadioModeState: () => ({currentMode:{name:'Q65'},currentRadioFrequency:432080000}),
}));
vi.mock('@tx5dr/core', () => ({ api: {
  getMfskLiveRxEvents:mock.events,
  getMfskNativeTxStatus:mock.txStatus,
  armMfskNativeTx:mock.arm,
  disarmMfskNativeTx:mock.disarm,
  startMfskLiveRx:mock.start,
  stopMfskLiveRx:mock.stop,
  transmitMfsk:mock.transmit,
  getMfskLiveWsprSpots:vi.fn(async()=>({spots:[]})),
}}));

afterEach(()=>{cleanup();vi.clearAllMocks();});

it('uses the existing mode and confirmed Q65 RX submode for operator TX',async()=>{
  render(<MfskLiveReceiverPanel surface="operator"/>);
  await waitFor(()=>expect(screen.getByText(/Q65-120D/)).toBeTruthy());
  expect(screen.queryByText('codec.startRx')).toBeNull();
  fireEvent.change(screen.getByLabelText('codec.message'),{
    target:{value:'CQ K1ABC FN42'},
  });
  fireEvent.change(screen.getByLabelText('codec.txAfFrequency'),{
    target:{value:'1760'},
  });
  fireEvent.click(screen.getByText('codec.manualTx'));
  await waitFor(()=>expect(mock.transmit).toHaveBeenCalledWith(expect.objectContaining({
    mode:'Q65',operatorId:'op1',q65Submode:'Q65-120D',q65TxFirst:true,
    audioHz:1760,text:'CQ K1ABC FN42',
  })));
});

it('keeps the native RX inside the existing receiver pane without duplicate PTT controls',async()=>{
  render(<MfskLiveReceiverPanel initialMode="Q65" surface="receiver"/>);
  await waitFor(()=>expect(mock.events).toHaveBeenCalled());
  expect(screen.queryByText('codec.manualTx')).toBeNull();
  expect(screen.queryByText('codec.armRf')).toBeNull();
  expect(screen.getByText('codec.applyRx')).toBeTruthy();
});

it('double-click station selection populates operator DX and TX AF but never keys PTT',async()=>{
  render(<MfskLiveReceiverPanel surface="operator"/>);
  await waitFor(()=>expect(screen.getByLabelText('codec.txAfFrequency')).toBeTruthy());
  const {NATIVE_DIGITAL_SELECTION_EVENT}=await import('../../components/radio/digital/nativeDigitalSelection');
  fireEvent(window,new CustomEvent(NATIVE_DIGITAL_SELECTION_EVENT,{
    detail:{mode:'Q65',text:'CQ BG5JSU OL79',audioHz:1780},
  }));
  await waitFor(()=>{
    expect((screen.getByLabelText('codec.txAfFrequency') as HTMLInputElement).value).toBe('1780');
    expect((screen.getByLabelText('codec.dxCall') as HTMLInputElement).value).toBe('BG5JSU');
  });
  expect(mock.transmit).not.toHaveBeenCalled();
});
it('requires manual RF acknowledgement before arming and permits explicit disarm',async()=>{
  render(<MfskLiveReceiverPanel surface="operator"/>);
  await waitFor(()=>expect(screen.getByText('codec.armRf')).toBeTruthy());
  const arm=screen.getByText('codec.armRf') as HTMLButtonElement;
  expect(arm.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('codec.armAcknowledgement'));
  await waitFor(()=>expect(arm.disabled).toBe(false));
  fireEvent.click(arm);
  await waitFor(()=>expect(mock.arm).toHaveBeenCalledWith('op1'));
  fireEvent.click(screen.getByText('codec.disarmRf'));
  await waitFor(()=>expect(mock.disarm).toHaveBeenCalledTimes(1));
  expect(mock.transmit).not.toHaveBeenCalled();
});
