import React,{forwardRef,useCallback,useEffect,useImperativeHandle,useState} from 'react';
import {Button,Chip,Input,Switch} from '@heroui/react';
import {api} from '@tx5dr/core';
import {N1MMInterfaceConfigSchema,type N1MMInterfaceConfig,type N1MMInterfaceStatus,type N1MMVirtualSerialStatus,type N1MMVirtualSerialAction} from '@tx5dr/contracts';
import {useTranslation} from 'react-i18next';
import {SettingsPage,SettingsSection,SettingsRow,SettingsBlock} from './SettingsLayout';
export interface N1MMInterfaceSettingsRef {hasUnsavedChanges():boolean;save():Promise<void>}
export const N1MMInterfaceSettings=forwardRef<N1MMInterfaceSettingsRef,{onUnsavedChanges?:(dirty:boolean)=>void}>(({onUnsavedChanges},ref)=>{
  const {t}=useTranslation('settings');
  const [form,setForm]=useState<N1MMInterfaceConfig>(()=>N1MMInterfaceConfigSchema.parse({}));
  const [status,setStatus]=useState<N1MMInterfaceStatus>();
  const [serial,setSerial]=useState<N1MMVirtualSerialStatus>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    setBusy(true);
    try{const next=await api.getN1MMInterfaces();setStatus(next);setForm(next.config);setError('');}
    catch(e){setError(String(e));}
    finally{setBusy(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  const dirty=!!status&&JSON.stringify(status.config)!==JSON.stringify(form);
  useEffect(()=>onUnsavedChanges?.(dirty),[dirty,onUnsavedChanges]);
  const save=async()=>{
    try{const next=await api.updateN1MMInterfaces(N1MMInterfaceConfigSchema.parse(form));setStatus(next);setForm(next.config);setError('');}
    catch(e){setError(String(e));throw e;}
  };
  useImperativeHandle(ref,()=>({hasUnsavedChanges:()=>dirty,save}));
  const update=<K extends 'cat'|'winkey'|'udp'>(key:K,patch:Partial<N1MMInterfaceConfig[K]>)=>setForm(previous=>({...previous,[key]:{...previous[key],...patch}}));
  const serialAction=async(action?:N1MMVirtualSerialAction)=>{
    setBusy(true);
    try{setSerial(action?await api.updateN1MMVirtualSerial(action):await api.getN1MMVirtualSerial());setError('');}
    catch(e){setError(String(e));}finally{setBusy(false);}
  };
  return <SettingsPage title={t('n1mm.title')} description={t('n1mm.description')} actions={<Button size="sm" variant="flat" isDisabled={busy||dirty} onPress={()=>void refresh()}>{t('rigctld.refreshButton')}</Button>}>
    {error&&<p className="text-sm text-danger">{error}</p>}
    {(['cat','winkey','udp'] as const).map(key=>{
      const running=status?.[key]?.listening;
      return <SettingsSection key={key} title={t('n1mm.'+key)} actions={<Chip size="sm" variant="flat" color={running?'success':'default'}>{t(running?'rigctld.statusRunning':'rigctld.statusStopped')}</Chip>}>
        <SettingsRow label={t('n1mm.enable')} control={<Switch size="sm" aria-label={t('n1mm.'+key)} isDisabled={busy||!status} isSelected={form[key].enabled} onValueChange={enabled=>update(key,{enabled})}/>}/>
        <SettingsBlock><div className="grid gap-3 md:grid-cols-2">
          <Input label={t('rigctld.bindAddressLabel')} value={form[key].host} isDisabled={busy||!status} onValueChange={host=>update(key,{host})}/>
          <Input type="number" min={1} max={65535} label={t('rigctld.portLabel')} value={String(form[key].port)} isDisabled={busy||!status} onValueChange={value=>update(key,{port:Number(value)})}/>
        </div>{status?.[key]?.error&&<p className="mt-2 text-xs text-danger">{status[key]?.error}</p>}</SettingsBlock>
        {key==='cat'&&<SettingsRow label={t('n1mm.allowPtt')} control={<Switch size="sm" isSelected={form.cat.allowPtt} onValueChange={allowPtt=>update('cat',{allowPtt})}/>}/>}
        {key==='udp'?<SettingsBlock><div className="grid gap-3 md:grid-cols-2"><Input label={t('n1mm.stationCall')} value={form.udp.stationCall} onValueChange={stationCall=>update('udp',{stationCall:stationCall.toUpperCase()})}/><Input label={t('n1mm.stationName')} value={form.udp.stationName} onValueChange={stationName=>update('udp',{stationName})}/></div></SettingsBlock>:<SettingsBlock><Input label={t('n1mm.com')} value={form[key].com} onValueChange={com=>key==='cat'?update('cat',{com:com.toUpperCase()}):update('winkey',{com:com.toUpperCase()})}/></SettingsBlock>}
      </SettingsSection>;
    })}
    <SettingsSection title={t('n1mm.radio')}><SettingsRow label={t('n1mm.fastPoll')} control={<Switch size="sm" isSelected={form.fastPoll} onValueChange={fastPoll=>setForm(f=>({...f,fastPoll}))}/>}/></SettingsSection>
    <SettingsSection title={t('n1mm.virtualSerial')} description={t('n1mm.providerHint')} actions={<Button size="sm" variant="flat" isDisabled={busy} onPress={()=>void serialAction()}>{t('n1mm.detect')}</Button>}>
      <SettingsBlock><a className="text-primary text-sm underline" href="https://github.com/RahulP5/SerialLoom/releases/tag/v0.4.0" target="_blank" rel="noreferrer">{t('n1mm.install')}</a>
        {serial&&<p className="text-xs text-default-500">{t(serial.available?'n1mm.ready':serial.supported?'n1mm.unavailable':'n1mm.windowsOnly')}</p>}
        {serial?.error&&<p className="text-xs text-warning">{serial.error}</p>}</SettingsBlock>
      {(['cat','winkey'] as const).map(channel=>{
        const connection=serial?.connections.find(c=>c.channel===channel);
        return <SettingsRow key={channel} label={t('n1mm.'+channel)} description={connection?connection.com+' → '+connection.address+' · '+t(connection.connected?'n1mm.connected':'n1mm.disconnected'):form[channel].com} >
          <div className="flex flex-wrap gap-2">{(['start','stop','remove'] as const).map(action=><Button size="sm" key={action} variant="flat" isDisabled={busy||dirty||!serial?.available||(action==='start'?!status?.[channel]?.listening:!connection)} onPress={()=>void serialAction({channel,action})}>{t('n1mm.'+action)}</Button>)}</div>
        </SettingsRow>;
      })}
    </SettingsSection>
  </SettingsPage>;
});
