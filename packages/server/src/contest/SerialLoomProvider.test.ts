import {describe,it,expect,vi} from 'vitest';
import {N1MMInterfaceConfigSchema} from '@tx5dr/contracts';
import {SerialLoomProvider} from './SerialLoomProvider.js';
// Exercise the production CLI adapter without launching a Windows process in unit tests.
const {cliExec}=vi.hoisted(()=>({cliExec:vi.fn()}));
vi.mock('node:child_process',async importOriginal=>{
  const original=await importOriginal<typeof import('node:child_process')>();
  return {...original,execFile:cliExec};
});

describe('Windows SerialLoom provider',()=>{
  it('allows USB enumeration and helper time for mutations while keeping status queries short',async()=>{
    const hubs:unknown[]=[];
    cliExec.mockReset();
    cliExec.mockImplementation((_exe:string,args:string[],_options:unknown,callback:(error:Error|null,result?:{stdout:string;stderr:string})=>void)=>{
      const request=JSON.parse(args[3]);
      if(request.command==='createHub'){
        const spec=request.request;
        hubs.push({spec:{id:'cat',name:spec.name,kind:'bridge',master:{spec:{kind:'virtual',port:spec.master.name},created:true},members:[{spec:spec.members[0],created:false}]},status:{running:true,endpoints:[]}});
      }
      callback(null,{stdout:JSON.stringify({ok:true,result:request.command==='listHubs'?hubs:{}}),stderr:''});
    });
    try{
      const provider=new SerialLoomProvider(undefined,'win32');
      const config=N1MMInterfaceConfigSchema.parse({cat:{enabled:true}});
      await provider.apply({channel:'cat',action:'start'},config);
      expect(cliExec).toHaveBeenCalledTimes(3);
      expect(cliExec.mock.calls[0][1].slice(0,3)).toEqual(['--timeout','10','send']);
      expect(cliExec.mock.calls[0][2]).toMatchObject({timeout:55000});
      expect(cliExec.mock.calls[1][1].slice(0,3)).toEqual(['--timeout','120','send']);
      expect(cliExec.mock.calls[1][2]).toMatchObject({timeout:165000});
    }finally{cliExec.mockReset();}
  });
  it('does not repeat a mutation after an ambiguous CLI failure',async()=>{
    cliExec.mockReset();
    cliExec.mockImplementation((_exe:string,args:string[],_options:unknown,callback:(error:Error|null,result?:{stdout:string;stderr:string})=>void)=>{
      const request=JSON.parse(args[3]);
      if(request.command==='createHub'){
        callback(new Error('CLI timed out after device request'));
        return;
      }
      callback(null,{stdout:JSON.stringify({ok:true,result:[]}),stderr:''});
    });
    try{
      const provider=new SerialLoomProvider(undefined,'win32');
      await expect(provider.apply({channel:'cat',action:'start'},N1MMInterfaceConfigSchema.parse({cat:{enabled:true}}))).rejects.toThrow('CLI timed out');
      expect(cliExec.mock.calls.filter(call=>JSON.parse(call[1][3]).command==='createHub')).toHaveLength(1);
    }finally{cliExec.mockReset();}
  });
  it('creates separate direct COM to TCP bridges using the documented API',async()=>{
    const hubs:unknown[]=[];
    const invoke=vi.fn(async(request:Record<string,unknown>)=>{
      if(request.command==='listHubs')return hubs;
      const spec=request.request as {name:string;master:{name:string};members:{kind:string;address:string}[]};
      hubs.push({spec:{id:spec.name,name:spec.name,kind:'bridge',master:{spec:{kind:'virtual',port:spec.master.name},created:true},members:[{spec:spec.members[0],created:false}]},status:{running:true,endpoints:[]}});
      return {};
    });
    const provider=new SerialLoomProvider(invoke,'win32');
    const config=N1MMInterfaceConfigSchema.parse({cat:{enabled:true},winkey:{enabled:true}});
    await provider.apply({channel:'cat',action:'start'},config);
    await provider.apply({channel:'winkey',action:'start'},config);
    expect(invoke).toHaveBeenCalledWith({command:'createHub',request:{name:'TX-5DR N1MM CAT',kind:'bridge',master:{kind:'newVirtual',name:'COM22'},members:[{kind:'tcpClient',address:'127.0.0.1:4533'}],autostart:false,start:true}});
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({request:expect.objectContaining({master:{kind:'newVirtual',name:'COM20'},members:[{kind:'tcpClient',address:'127.0.0.1:4534'}]})}));
  });
  it('reports a different COM number assigned by the provider instead of accepting the requested number',async()=>{
    const invoke=vi.fn(async(request:Record<string,unknown>)=>{
      if(request.command==='createHub')return {};
      if(invoke.mock.calls.length===1)return [];
      return [{spec:{id:'cat',name:'TX-5DR N1MM CAT',kind:'bridge',master:{spec:{kind:'virtual',port:'COM7'},created:true},members:[{spec:{kind:'tcpClient',address:'127.0.0.1:4533'},created:false}]},status:{running:true,endpoints:[]}}];
    });
    const provider=new SerialLoomProvider(invoke,'win32');
    await expect(provider.apply({channel:'cat',action:'start'},N1MMInterfaceConfigSchema.parse({cat:{enabled:true}}))).rejects.toThrow('COM7 instead of COM22');
    expect((await provider.status()).connections[0].com).toBe('COM7');
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
