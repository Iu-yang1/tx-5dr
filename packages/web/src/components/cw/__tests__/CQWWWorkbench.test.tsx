// @vitest-environment jsdom
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {HeroUIProvider} from '@heroui/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createStorageStub} from './cwTestStorage';
const mocks=vi.hoisted(()=>({entry:vi.fn(),update:vi.fn(),snapshot:vi.fn(),send:vi.fn(),stop:vi.fn(),qsy:vi.fn()}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(k:string)=>k})}));
vi.mock('@tx5dr/core',async original=>({...await original<object>(),api:{getN1MMEntry:mocks.entry,updateN1MMEntry:mocks.update,getCWContestSnapshot:mocks.snapshot}}));
vi.mock('../../../store/radioStore',()=>({useOperators:()=>({operators:[{id:'op',context:{myCall:'BG5JSU'}}]}),useCurrentOperatorId:()=>({currentOperatorId:'op'}),useRadioConnectionState:()=>({radioConnected:true,coreCapabilities:{writeFrequency:true}})}));
vi.mock('../../../store/authStore',()=>({useCan:()=>true,useAbility:()=>({can:()=>true})}));
vi.mock('../../../hooks/useCWKeyer',()=>({useCWKeyer:()=>({cwKeyerStatus:{active:false,backendAvailable:true},isCWMode:true,sendText:mocks.send,stopMessage:mocks.stop})}));
vi.mock('../../../utils/radioFrequencyIntent',()=>({setRadioFrequencyWithIntent:mocks.qsy}));
import {CQWWWorkbench} from '../CQWWWorkbench';
import {updateCWContestProfile} from '../../../store/cwContestProfileStore';
import {setCWQSOHisCallsign} from '../../../store/cwQsoDraftStore';
beforeEach(()=>{
  vi.clearAllMocks();vi.stubGlobal('localStorage',createStorageStub());vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});
  window.matchMedia=vi.fn().mockImplementation(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));
  updateCWContestProfile({active:true,stationCall:'BG8GLR',sentZone:'24',receivedZone:'25',run:true});
  setCWQSOHisCallsign('JA1ABC');
  mocks.entry.mockResolvedValue({online:true,fields:{call:'JA1ABC',zone:'25'},revision:1,actions:['ENTER','F1','LOG'],updatedAt:Date.now()});
  mocks.update.mockResolvedValue({online:true,fields:{call:'JA1ABC',zone:'25'},revision:2,actions:['ENTER','F1','LOG'],updatedAt:Date.now()});
  mocks.snapshot.mockResolvedValue({enabled:true,listening:true,stationCall:'BG8GLR',radio:{receivedAt:Date.now(),operator:'BG5JSU',frequencyHz:14025000,running:true},contacts:[],observedContacts:0,spots:[{call:'DL1ABC',frequencyHz:14030000,status:'single mult',spotter:'RBN'}],logCandidates:['JA1ABC']});
  mocks.qsy.mockResolvedValue({success:true});
});
afterEach(()=>{cleanup();updateCWContestProfile({active:false});vi.unstubAllGlobals();});
describe('CQWW actual component DOM simulation',()=>{
  it('renders entry, CW macros, assistance, native ESM and sends only explicit actions',async()=>{
    render(<HeroUIProvider disableAnimation><CQWWWorkbench/></HeroUIProvider>);
    expect(await screen.findByText('Check / SCP',{exact:false})).toBeTruthy();
    await waitFor(()=>expect((screen.getByRole('button',{name:'ESM Enter'}) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('Bandmap / RBN')).toBeTruthy();
    expect(screen.getByText('DL1ABC')).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'ESM Enter'}));
    await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith({call:'JA1ABC',zone:'25',action:'ENTER'}));
    expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'14030.00'}));
    await waitFor(()=>expect(mocks.qsy).toHaveBeenCalledWith(expect.objectContaining({frequency:14030000,mode:'CW'})));
  });
  it('propagates a manually selected decoder callsign to N1MM',async()=>{
    render(<HeroUIProvider disableAnimation><CQWWWorkbench/></HeroUIProvider>);
    await waitFor(()=>expect((screen.getByRole('button',{name:'ESM Enter'}) as HTMLButtonElement).disabled).toBe(false));
    act(()=>setCWQSOHisCallsign('K1ABC'));
    await waitFor(()=>expect(mocks.update).toHaveBeenCalledWith({call:'K1ABC',zone:'25'}));
  });
});
