import {describe,it,expect,vi} from 'vitest';
import {N1MMInterfaceConfigSchema} from '@tx5dr/contracts';
import {SerialLoomProvider} from './SerialLoomProvider.js';
describe('Windows SerialLoom provider',()=>{
  it('creates separate direct COM to TCP bridges using the documented API',async()=>{
    const invoke=vi.fn(async(request:Record<string,unknown>)=>request.command==='listHubs'?[]:{});
    const provider=new SerialLoomProvider(invoke,'win32');
    const config=N1MMInterfaceConfigSchema.parse({cat:{enabled:true},winkey:{enabled:true}});
    await provider.apply({channel:'cat',action:'start'},config);
    await provider.apply({channel:'winkey',action:'start'},config);
    expect(invoke).toHaveBeenCalledWith({command:'createHub',request:{name:'TX-5DR N1MM CAT',kind:'bridge',master:{kind:'newVirtual',name:'COM22'},members:[{kind:'tcpClient',address:'127.0.0.1:4533'}],autostart:false,start:true}});
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({request:expect.objectContaining({master:{kind:'newVirtual',name:'COM20'},members:[{kind:'tcpClient',address:'127.0.0.1:4534'}]})}));
  });
  it('does not touch a name collision or a non-Windows host',async()=>{
    const invoke=vi.fn(async()=>[{spec:{id:'other',name:'TX-5DR N1MM CAT',kind:'split',master:{spec:{kind:'serial'},created:false},members:[]},status:{running:true,endpoints:[]}}]);
    const config=N1MMInterfaceConfigSchema.parse({cat:{enabled:true}});
    await expect(new SerialLoomProvider(invoke,'win32').apply({channel:'cat',action:'remove'},config)).rejects.toThrow('conflict');
    expect(await new SerialLoomProvider(invoke,'linux').status()).toMatchObject({supported:false,available:false});
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('validates independent ports and legacy defaults',()=>{
    expect(N1MMInterfaceConfigSchema.parse({}).cat.port).toBe(4533);
    expect(N1MMInterfaceConfigSchema.safeParse({cat:{com:'COM20'}}).success).toBe(false);
    expect(N1MMInterfaceConfigSchema.safeParse({cat:{port:70000}}).success).toBe(false);
  });
});
