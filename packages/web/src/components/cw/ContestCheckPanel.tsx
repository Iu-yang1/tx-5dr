import React,{useMemo,useState} from 'react';
import { checkCandidates,parseMasterScp,parseCallHistory } from './contestCheck';
export function ContestCheckPanel({query,zone,logCalls,spotCalls,onSelect}:{query:string;zone:string;logCalls:string[];spotCalls:string[];onSelect:(call:string)=>void}){
  const [master,setMaster]=useState<string[]>([]);
  const [history,setHistory]=useState<Array<{call:string;zone:string}>>([]);
  const [error,setError]=useState('');
  const groups=useMemo(()=>[
    {name:'Log',rows:checkCandidates(query,logCalls)},
    {name:'Master.scp',rows:checkCandidates(query,master)},
    {name:'Spots',rows:checkCandidates(query,spotCalls)},
    {name:'Call history',rows:checkCandidates(query,history.map(x=>x.call))},
  ],[query,logCalls,master,spotCalls,history]);
  const load=async(file:File|undefined,kind:'master'|'history')=>{
    if(!file)return;
    try{const data=await file.text();if(kind==='master'){const calls=parseMasterScp(data);setMaster(calls);if(!calls.length)throw new Error('No valid SCP calls');}
      else{const rows=parseCallHistory(data);setHistory(rows);if(!rows.length)throw new Error('CSV must contain Call and Zone columns');}setError('');}
    catch(exc){setError(String(exc));}
  };
  return <section className="min-w-0 rounded-md bg-content2 p-2 text-xs" aria-label="Check / SCP">
    <div className="font-semibold">Check / SCP <span className="font-normal text-default-500">Local candidates</span></div>
    <div className="flex flex-wrap gap-2 py-1"><label>Master.scp ({master.length}) <input className="block max-w-40" type="file" accept=".scp,.txt" onChange={event=>void load(event.target.files?.[0],'master')}/></label>
    <label>Call history ({history.length}) <input className="block max-w-40" type="file" accept=".csv,.txt" onChange={event=>void load(event.target.files?.[0],'history')}/></label></div>
    {error&&<p className="text-warning">{error}</p>}
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-1">{groups.map(group=><div key={group.name} className="min-w-0"><strong>{group.name}</strong>{group.rows.map(row=><button key={row.call} className={'block max-w-full truncate font-mono '+(row.kind==='near'?'text-warning':row.kind==='partial'?'text-success':'font-bold')} type="button" onClick={()=>onSelect(row.call)}>{row.call}</button>)}</div>)}</div>
    {zone&&<div className="flex flex-wrap gap-2">Zone {zone}: {history.filter(x=>Number(x.zone)===Number(zone)).slice(0,12).map(x=><button key={x.call} type="button" onClick={()=>onSelect(x.call)}>{x.call}</button>)}</div>}
  </section>;
}
