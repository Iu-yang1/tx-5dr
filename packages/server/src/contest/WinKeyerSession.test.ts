import { describe,it,expect,vi } from 'vitest';
import { WinKeyerSession } from './WinKeyerSession.js';
import { WinKeyerBridge } from './WinKeyerBridge.js';
import { createConnection } from 'node:net';
import { once } from 'node:events';
describe('WinKeyer host framing',()=>{
  it('handles fragmented admin, speed, text, busy/ready, and buffered speed',async()=>{
    const sent:Array<[string,number]>=[], out:number[]=[];
    const backend={send:async(text:string,wpm:number)=>{sent.push([text,wpm]);},stop:vi.fn(async()=>{}),speed:vi.fn(async()=>{})};
    const s=new WinKeyerSession(backend,b=>out.push(...b));
    s.feed(Buffer.from([0]));s.feed(Buffer.from([2,2,30]));s.feed(Buffer.from('CQ TEST','ascii'));
    s.feed(Buffer.from([0x1c,20]));s.feed(Buffer.from('BG8GLR','ascii'));
    await vi.waitFor(()=>expect(sent).toEqual([['CQ TEST',30],['BG8GLR',20]]));
    expect(out[0]).toBe(23);expect(out).toContain(0xc4);expect(out[out.length-1]).toBe(0xc0);
    await s.close();
  });
  it('clear cancels the pending send without echo and prevents queued text',async()=>{
    let finish=()=>{}; const out:number[]=[];
    const send=vi.fn(async()=>{await new Promise<void>(resolve=>{finish=resolve;});});
    const stop=vi.fn(async()=>{finish();});
    const s=new WinKeyerSession({send,stop,speed:async()=>{}},b=>out.push(...b));
    s.feed(Buffer.from([0,2]));s.feed(Buffer.from('CQ TEST'));
    await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(1));
    s.feed(Buffer.from('BG8GLR'));s.feed(Buffer.from([0x0a]));
    await vi.waitFor(()=>expect(s.status.busy).toBe(false));
    expect(send).toHaveBeenCalledTimes(1);expect(out).not.toContain(67);await s.close();
  });
  it('real TCP host handshake and disconnect releases only its session',async()=>{
    const stop=vi.fn(async()=>{});const bridge=new WinKeyerBridge({enabled:true,host:'127.0.0.1',port:0},()=>({send:async()=>{},stop,speed:async()=>{}}));
    await bridge.start();const socket=createConnection({host:'127.0.0.1',port:bridge.status().port});
    try {await once(socket,'connect');const reply=once(socket,'data');socket.write(Buffer.from([0,2]));const [data]=await reply;expect(data[0]).toBe(23);
      socket.destroy();await vi.waitFor(()=>expect(stop).toHaveBeenCalled());}
    finally{socket.destroy();await bridge.stop();}
  });
});
