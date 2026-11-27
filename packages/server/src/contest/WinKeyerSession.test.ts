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

describe('WinKeyer advanced host commands',()=>{
  it('preserves queued speed boundaries and merges supported prosigns',async()=>{
    const sent:Array<[string,number]>=[];
    const s=new WinKeyerSession({send:async(text,wpm)=>{sent.push([text,wpm]);},stop:async()=>{},speed:async()=>{}},()=>{});
    s.feed(Buffer.from([0,2,2,25]));s.feed(Buffer.from('CQ'));s.feed(Buffer.from([2,30,0x1b,65,82]));
    await vi.waitFor(()=>expect(sent).toEqual([['CQ',25],['<AR>',30]]));
    await s.close();
  });
  it('ends tune on clear and waits for in-flight keydown before releasing the session',async()=>{
    let release=()=>{};let down=false;
    const key=vi.fn(async(on:boolean)=>{if(on){await new Promise<void>(r=>{release=r;});}down=on;});
    const stop=vi.fn(async()=>{down=false;});
    const s=new WinKeyerSession({send:async()=>{},stop,speed:async()=>{},key},()=>{});
    s.feed(Buffer.from([0,2,0x0b,1]));
    await vi.waitFor(()=>expect(key).toHaveBeenCalledTimes(1));
    const abort=s.abort();release();await abort;
    expect(down).toBe(false);expect(s.status.busy).toBe(false);
    await s.close();
  });
  it('reports unsupported tune rather than silently claiming keydown',()=>{
    const s=new WinKeyerSession({send:async()=>{},stop:async()=>{},speed:async()=>{}},()=>{});
    s.feed(Buffer.from([0,2,0x0b,1]));
    expect(s.status.error).toContain('does not support');expect(s.status.busy).toBe(false);
  });
});

describe('WinKeyer pending buffer pointer protocol',()=>{
  it('corrects reserved callsign bytes, skips nulls and appends after fragmented pointer commands',async()=>{
    const sent:string[]=[];
    const s=new WinKeyerSession({send:async text=>{sent.push(text);},stop:async()=>{},speed:async()=>{}},()=>{});
    s.feed(Buffer.from([0,2,0x06,1,0x16,3,6]));
    s.feed(Buffer.from(' 5NN 24'));
    s.feed(Buffer.from([0x16,1]));s.feed(Buffer.from([1]));s.feed(Buffer.from('JA1ABC'));
    s.feed(Buffer.from([0x16,1,6,0x16,3,1,0x16,2,0]));
    s.feed(Buffer.from(' TU'));s.feed(Buffer.from([0x06,0]));
    await vi.waitFor(()=>expect(sent).toEqual(['JA1AB 5NN 24 TU']));
    await s.close();
  });
  it('does not retransmit already handed-off bytes when a host requests a late correction',async()=>{
    const sent:string[]=[];let done=()=>{};
    const s=new WinKeyerSession({send:async text=>{sent.push(text);await new Promise<void>(r=>{done=r;});},stop:async()=>{done();},speed:async()=>{}},()=>{});
    s.feed(Buffer.from([0,2]));s.feed(Buffer.from('JA1ABC'));
    await vi.waitFor(()=>expect(sent).toEqual(['JA1ABC']));
    s.feed(Buffer.from([0x16,1,2]));s.feed(Buffer.from('X'));
    expect(s.status.error).toContain('not pending');await s.close();
    expect(sent).toEqual(['JA1ABC']);
  });
});
