// @vitest-environment jsdom
import React from 'react';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {HeroUIProvider} from '@heroui/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createStorageStub} from './cwTestStorage';
const mocks=vi.hoisted(()=>({entry:vi.fn(),update:vi.fn(),snapshot:vi.fn(),send:vi.fn(),stop:vi.fn(),qsy:vi.fn(),bus:{onWSEvent:vi.fn(),offWSEvent:vi.fn(),send:vi.fn()},panel:vi.fn()}));
vi.mock('react-i18next',async original=>({...await original<object>(),useTranslation:()=>({t:(k:string)=>k})}));
vi.mock('../../../utils/errorToast',()=>({showErrorToast:vi.fn()}));
vi.mock('@tx5dr/core',async original=>({...await original<object>(),api:{getN1MMEntry:mocks.entry,updateN1MMEntry:mocks.update,getCWContestSnapshot:mocks.snapshot,getCWKeyerConfig:async()=>({success:true,config:{backend:'serial',keyPort:'COM7',keyMethod:'dtr',keyActiveLevel:'high',wpm:25}}),getCWMessagePanel:mocks.panel,getCWDecoderConfig:async()=>({config:{enabled:true,backend:'deepcw-onnx'}}),getCWDecoderBackends:async()=>({backends:[{id:'deepcw-onnx',label:'DeepCW'}]}),getLogBookQSOs:async()=>({success:true,data:[]}),getLastFrequency:async()=>({success:true,lastCWFrequency:{frequency:14025000}})}}));
const connectionFixture=vi.hoisted(()=>({state:{isConnected:true,radioService:{wsClientInstance:{onWSEvent:vi.fn(),offWSEvent:vi.fn(),send:vi.fn()}}}}));
vi.mock('../../../store/radioStore',()=>({useOperators:()=>({operators:[{id:'op',context:{myCall:'BG5JSU'}}]}),useCurrentOperatorId:()=>({currentOperatorId:'op'}),useRadioConnectionState:()=>({radioConnected:true,radioConfig:{type:'serial'},coreCapabilities:{writeFrequency:true}}),useRadioModeState:()=>({engineMode:'cw',currentRadioFrequency:14025000,currentRadioMode:'CW'}),useConnection:()=>connectionFixture,useCWState:()=>({cwKeyerStatus:{active:false},cwConfig:null}),useProfiles:()=>({activeProfileId:'p1'}),useSplitState:()=>({splitEnabled:false,splitTxFrequency:null,splitTxFrequencyWritable:false})}));
vi.mock('../../../store/authStore',()=>({useCan:()=>true,useAbility:()=>({can:()=>true}),useAuth:()=>({state:{authEnabled:false}})}));
vi.mock('../../../hooks/useCWKeyer',()=>({useCWKeyer:()=>({cwKeyerStatus:{active:false,backendAvailable:true},isCWMode:true,cwConfig:null,sendText:mocks.send,stopMessage:mocks.stop,sendKeyAction:vi.fn(),playMessage:vi.fn()})}));
vi.mock('../../../utils/radioFrequencyIntent',()=>({setRadioFrequencyWithIntent:mocks.qsy}));
import {CQWWWorkbench} from '../CQWWWorkbench';
import {CWFrequencyControl} from '../CWFrequencyControl';
import {CWDecoderPanel} from '../CWDecoderPanel';
import {CWDecoderProvider} from '../../../hooks/useCWDecoder';
import {CWKeyerPanel} from '../CWKeyerPanel';
import {CWQSOLogCard} from '../CWQSOLogCard';
vi.mock('../../radio/frequency/SplitSettingsPopover',()=>({SplitSettingsPopover:()=>null}));
vi.mock('../../../utils/windowManager',()=>({openLogbookWindow:vi.fn()}));
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
  mocks.panel.mockResolvedValue({success:true,panel:{callsign:'BG5JSU',slotCount:3,maxSlotCount:12,slots:[{id:'s1',index:1,label:'CQ',text:'CQ TEST {MYCALL}',repeatEnabled:false,repeatIntervalSec:5},{id:'s2',index:2,label:'EXCH',text:'{HISCALL} 5NN 24',repeatEnabled:false,repeatIntervalSec:5},{id:'s3',index:3,label:'TU',text:'TU {MYCALL}',repeatEnabled:false,repeatIntervalSec:5}]}});
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

  // Whole-console fixture: the original production CW panels and the contest
  // workbench share their real draft/profile stores. RF spectrum is synthetic.
  it('renders the two-pane CW console and exports a visual simulation fixture',async()=>{
    const {container}=render(<HeroUIProvider disableAnimation><main className="grid h-screen min-w-0 grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-background text-foreground"><section className="min-w-0 flex flex-col gap-2 overflow-auto"><div className="text-sm font-bold">TX-5DR · CW · SIMULATED RF</div><CWFrequencyControl/><div className="h-32 shrink-0 bg-content2 rounded-md overflow-hidden"><svg width="100%" height="100%" viewBox="0 0 600 128" preserveAspectRatio="none"><rect width="600" height="128" fill="#111827"/>{[70,150,290,360,490].map((x,i)=><path key={x} d={`M${x-22} 72 Q${x} ${8+i*9} ${x+22} 72`} stroke="#3bd5b5" strokeWidth="2" fill="none"/>)}<path d="M0 72H600" stroke="#3bd5b5"/><rect x="272" width="40" height="85" fill="#35b9ac" opacity=".2"/><path d="M0 95H600M0 109H600" stroke="#223a65" strokeWidth="10"/></svg></div><CWDecoderProvider><CWDecoderPanel/></CWDecoderProvider><CWKeyerPanel embedded/></section><section className="min-w-0 flex flex-col gap-2 overflow-hidden"><CQWWWorkbench/><div className="shrink-0 max-h-[45%] overflow-auto"><CWQSOLogCard/></div></section></main></HeroUIProvider>);
    await waitFor(()=>expect(mocks.panel).toHaveBeenCalled());
    await waitFor(()=>expect(screen.getByRole('button',{name:'N1MM LOG'})).toBeTruthy());
    expect(container.querySelector('[data-freq-digit]')).toBeTruthy();
    expect(container.querySelector('[aria-label="CQ WW CW Workbench"]')).toBeTruthy();
    await waitFor(()=>expect(screen.getByText('Bandmap / RBN')).toBeTruthy());
    if(process.env.CW_CONSOLE_RENDER_DIR){const dir=resolve(process.env.CW_CONSOLE_RENDER_DIR);mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'console-dom.html'),container.innerHTML);}
  });
