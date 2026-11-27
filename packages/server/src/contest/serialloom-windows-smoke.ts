// Explicit Windows-only integration probe. Real COM devices; simulated RF backend.
import assert from 'node:assert/strict';
import {SerialPort} from 'serialport';
import {N1MMInterfaceConfigSchema} from '@tx5dr/contracts';
import type {RadioController} from '@tx5dr/rigctld-server';
import {SerialLoomProvider} from './SerialLoomProvider.js';
import {KenwoodCatBridge} from './KenwoodCatBridge.js';
import {WinKeyerBridge} from './WinKeyerBridge.js';
import {createLogger} from '../utils/logger.js';

const logger=createLogger('SerialLoomWindowsSmoke');

async function until(check:()=>boolean|Promise<boolean>,description:string,timeout=30000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(await check())return;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Timed out: '+description);
}
async function openPort(path:string,baudRate:number,stopBits:1|2){
  const port=new SerialPort({path,baudRate,stopBits,autoOpen:false});
  await new Promise<void>((resolve,reject)=>port.open(error=>error?reject(error):resolve()));
  return port;
}
async function closePort(port?:SerialPort){
  if(port?.isOpen)await new Promise<void>((resolve,reject)=>port.close(error=>error?reject(error):resolve()));
}
async function write(port:SerialPort,data:Buffer|string){
  await new Promise<void>((resolve,reject)=>port.write(data,error=>error?reject(error):resolve()));
}
async function main(){
  assert.equal(process.platform,'win32');
  assert.equal(process.env.TX5DR_SERIALLOOM_SMOKE,'1','Explicit integration probe opt-in required');
  const provider=new SerialLoomProvider();
  let hz=14025000;
  const radio:RadioController={
    getFrequency:async()=>hz,setFrequency:async next=>{hz=next;},
    getMode:async()=>({mode:'CW',bandwidthHz:400}),setMode:async()=>{},
    getPTT:async()=>false,setPTT:async()=>{throw new Error('Unexpected RF operation in simulated test');},
  };
  let sent:string[]=[];let stops=0;
  const cat=new KenwoodCatBridge({enabled:true,host:'127.0.0.1',port:0,allowPtt:false},()=>radio,{get:async()=>25,set:async()=>{}});
  const wk=new WinKeyerBridge({enabled:true,host:'127.0.0.1',port:0},()=>({send:async text=>{sent.push(text);},stop:async()=>{stops++;},speed:async()=>{}}));
  await cat.start();await wk.start();
  const config=N1MMInterfaceConfigSchema.parse({cat:{enabled:true,port:cat.status().port,com:'COM91'},winkey:{enabled:true,port:wk.status().port,com:'COM92'}});
  let catPort:SerialPort|undefined,wkPort:SerialPort|undefined;
  try{
    await until(async()=>(await provider.status()).available,'SerialLoom automation');
    assert.equal((await provider.status()).connections.length,0,'Dedicated clean test VM required');
    await provider.apply({channel:'cat',action:'start'},config);
    await provider.apply({channel:'winkey',action:'start'},config);
    await until(async()=>{const ports=await SerialPort.list();return ['COM91','COM92'].every(name=>ports.some(p=>p.path.toUpperCase()===name));},'real COM enumeration');
    await until(()=>cat.status().clients===1&&wk.status().connected,'COM-to-TCP connections');
    catPort=await openPort('COM91',9600,1);wkPort=await openPort('COM92',1200,2);
    let catData='';const wkData:number[]=[];
    catPort.on('data',data=>{catData+=data.toString('ascii');});
    wkPort.on('data',data=>{wkData.push(...data);});
    await write(catPort,'ID;FA;FA00007025000;FA;');
    await until(()=>catData.includes('ID021;FA00014025000;FA00007025000;'),'CAT round trip');
    assert.equal(hz,7025000);
    await write(wkPort,Buffer.from([0,2]));
    await until(()=>wkData.includes(23),'WinKeyer host handshake');
    await write(wkPort,Buffer.from('TEST'));
    await until(()=>sent.join('')==='TEST','WinKeyer text reaches simulated keyer');
    await write(wkPort,Buffer.from([0x0a]));
    await until(()=>stops>0,'WinKeyer clear reaches simulated keyer');
    assert.equal((await provider.status()).connections.filter(c=>c.connected).length,2);
    logger.info('PASS: real Windows COM enumeration, CAT query/set, WinKeyer handshake/text/clear; no RF');
  }catch(error){
    logger.error('Windows COM smoke failed before cleanup', {error:String(error), provider:await provider.status(), ports:await SerialPort.list().catch(listError=>String(listError)), cat:cat.status(), winkey:wk.status()});
    throw error;
  }finally{
    await Promise.allSettled([closePort(catPort),closePort(wkPort)]);
    await Promise.allSettled([provider.apply({channel:'cat',action:'remove'},config),provider.apply({channel:'winkey',action:'remove'},config)]);
    await Promise.allSettled([cat.stop(),wk.stop()]);
  }
}
void main().catch(error=>{logger.error('Windows COM smoke failed', {error:String(error)});process.exitCode=1;});
