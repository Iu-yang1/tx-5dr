export function parseMasterScp(text:string):string[]{
  return [...new Set(text.split(/\r?\n/).map(line=>line.trim().toUpperCase()).filter(line=>/^[A-Z0-9/]{3,20}$/.test(line)&&/[A-Z]/.test(line)&&/\d/.test(line)))];
}
export function parseCallHistory(text:string):Array<{call:string;zone:string}>{
  const lines=text.split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#'));
  const header=lines.shift()?.split(',').map(x=>x.trim().toLowerCase().replace(/^!!/,''));
  const callIndex=header?.findIndex(x=>x==='call'||x==='callsign')??-1;
  const zoneIndex=header?.findIndex(x=>['zone','cqzone','cqz'].includes(x))??-1;
  if(callIndex<0||zoneIndex<0)return [];
  return lines.flatMap(line=>{const fields=line.split(',');const call=fields[callIndex]?.trim().toUpperCase();const zone=fields[zoneIndex]?.trim();
    return call&&zone&&/^[A-Z0-9/]{3,20}$/.test(call)&&/^\d{1,2}$/.test(zone)&&Number(zone)>=1&&Number(zone)<=40?[{call,zone}]:[];});
}
function distance(a:string,b:string):number{
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row.push(Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+Number(a[i-1]!==b[j-1])));prev=row;}
  return prev[b.length];
}
export function checkCandidates(query:string,calls:string[],limit=12):Array<{call:string;kind:'exact'|'partial'|'near'}>{
  const q=query.trim().toUpperCase();if(q.length<3)return [];
  return [...new Set(calls)].flatMap<{call:string;kind:'exact'|'partial'|'near';rank:number}>(call=>{
    if(call===q)return [{call,kind:'exact' as const,rank:0}];
    if(call.includes(q))return [{call,kind:'partial' as const,rank:1}];
    if(Math.abs(call.length-q.length)<=1&&distance(call,q)<=1)return [{call,kind:'near' as const,rank:2}];
    return [];
  }).sort((a,b)=>a.rank-b.rank||a.call.localeCompare(b.call)).slice(0,limit);
}
