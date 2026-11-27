import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {z} from 'zod';
import type {N1MMInterfaceConfig,N1MMVirtualSerialAction,N1MMVirtualSerialStatus} from '@tx5dr/contracts';

const execute=promisify(execFile);
const endpoint=z.object({kind:z.string(),port:z.string().optional(),address:z.string().optional()});
const hubSchema=z.object({
  spec:z.object({id:z.string(),name:z.string(),kind:z.string(),master:z.object({spec:endpoint,created:z.boolean()}),members:z.array(z.object({spec:endpoint,created:z.boolean()}))}),
  status:z.object({running:z.boolean(),endpoints:z.array(z.object({connected:z.boolean(),peerOpen:z.boolean()}))}),
});
type Hub=z.infer<typeof hubSchema>;
type Channel=N1MMVirtualSerialAction['channel'];
const name=(channel:Channel)=>'TX-5DR N1MM '+channel.toUpperCase();
type Invoke=(request:Record<string,unknown>)=>Promise<unknown>;

async function invokeCli(request:Record<string,unknown>):Promise<unknown>{
  const exe=join(process.env.ProgramFiles??'C:\\Program Files','SerialLoom','serialloom-cli.exe');
  const {stdout}=await execute(exe,['--timeout','10','send',JSON.stringify(request)],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});
  const response=z.object({ok:z.boolean(),result:z.unknown().optional(),error:z.string().optional()}).parse(JSON.parse(stdout));
  if(!response.ok)throw new Error(response.error??'SerialLoom request failed');
  return response.result;
}
function owned(hub:Hub,channel:Channel){
  return hub.spec.name===name(channel)&&hub.spec.kind==='bridge'&&hub.spec.master.created&&hub.spec.master.spec.kind==='virtual'&&hub.spec.members.length===1&&hub.spec.members[0].spec.kind==='tcpClient';
}
export class SerialLoomProvider{
  constructor(private readonly invoke:Invoke=invokeCli,private readonly platform=process.platform){}
  private async hubs(){return z.array(hubSchema).parse(await this.invoke({command:'listHubs'}));}
  async status():Promise<N1MMVirtualSerialStatus>{
    if(this.platform!=='win32')return {supported:false,available:false,connections:[]};
    try{
      const hubs=await this.hubs();
      const connections=(['cat','winkey'] as const).flatMap(channel=>hubs.filter(h=>owned(h,channel)).map(h=>({
        channel,com:h.spec.master.spec.port??'',address:h.spec.members[0].spec.address??'',running:h.status.running,
        connected:h.status.endpoints[1]?.connected??false,peerOpen:h.status.endpoints[0]?.peerOpen??false,
      })));
      return {supported:true,available:true,connections};
    }catch(error){return {supported:true,available:false,connections:[],error:String(error)};}
  }
  async apply(action:N1MMVirtualSerialAction,config:N1MMInterfaceConfig):Promise<N1MMVirtualSerialStatus>{
    if(this.platform!=='win32')throw new Error('Virtual COM provider requires Windows');
    const channel=action.channel;
    const matches=(await this.hubs()).filter(h=>h.spec.name===name(channel));
    if(matches.length>1||matches.some(h=>!owned(h,channel)))throw new Error('SerialLoom connection name conflict; inspect provider');
    const current=matches[0];
    if(action.action==='start'){
      const settings=config[channel];
      if(!settings.enabled)throw new Error('Enable and save the TCP listener first');
      const host=settings.host==='0.0.0.0'||settings.host==='::'?'127.0.0.1':settings.host;
      const address=(host.includes(':')?'['+host+']':host)+':'+settings.port;
      if(current){
        if(current.spec.master.spec.port!==settings.com||current.spec.members[0].spec.address!==address)throw new Error('Remove the previous TX-5DR virtual connection before changing its COM or TCP endpoint');
        if(!current.status.running)await this.invoke({command:'startHub',id:current.spec.id});
      }else{
        await this.invoke({command:'createHub',request:{name:name(channel),kind:'bridge',master:{kind:'newVirtual',name:settings.com},members:[{kind:'tcpClient',address}],autostart:false,start:true}});
      }
    }else if(current){
      await this.invoke(action.action==='stop'?{command:'stopHub',id:current.spec.id}:{command:'deleteHub',id:current.spec.id,removeVirtualPorts:true});
    }
    const status=await this.status();
    if(action.action==='start'){
      const connection=status.connections.find(item=>item.channel===channel);
      if(!status.available||!connection||!connection.running)throw new Error('SerialLoom did not start the requested bridge: '+(status.error??name(channel)));
      if(connection.com.toUpperCase()!==config[channel].com.toUpperCase())throw new Error('SerialLoom assigned '+connection.com+' instead of '+config[channel].com+'; inspect the virtual port in SerialLoom or remove the bridge and choose a free COM number');
    }
    return status;
  }
}
