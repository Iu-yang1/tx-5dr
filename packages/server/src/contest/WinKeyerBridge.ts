import { createServer, type Server, type Socket } from 'node:net';
import { WinKeyerSession, type WinKeyerBackend } from './WinKeyerSession.js';
export class WinKeyerBridge {
  private server?: Server;
  private socket?: Socket;
  private session?: WinKeyerSession;
  private closing = Promise.resolve();
  private error?: string;
  private nextId=0;
  constructor(private readonly config:{enabled:boolean;host:string;port:number},private readonly backend:(id:string)=>WinKeyerBackend){}
  async start():Promise<void>{
    if(!this.config.enabled||this.server)return;
    const server=createServer(socket=>{
      // One physical CW output: a second simultaneous WinKey host would corrupt
      // both hosts' FIFO/status association. Existing TX-5DR presets remain usable.
      if(this.socket){socket.destroy();return;}
      this.socket=socket; socket.setNoDelay(true);
      const session=new WinKeyerSession(this.backend('n1mm-wk-'+(++this.nextId)),bytes=>{if(!socket.destroyed)socket.write(bytes);});
      this.session=session;
      socket.on('data',data=>session.feed(data));
      socket.on('error',()=>socket.destroy());
      socket.once('close',()=>{
        this.closing=session.close().finally(()=>{if(this.socket===socket){this.socket=undefined;this.session=undefined;}});
      });
    });
    this.server=server;
    await new Promise<void>(resolve=>{
      server.on('error',error=>{this.error=error.message;if(!server.listening&&this.server===server)this.server=undefined;resolve();});
      server.listen(this.config.port,this.config.host,()=>{this.error=undefined;resolve();});
    });
  }
  status(){
    const address=this.server?.address();
    return {...this.config,port:typeof address==='object'&&address?address.port:this.config.port,listening:!!this.server?.listening,connected:!!this.socket,
      opened:this.session?.status.opened??false,busy:this.session?.status.busy??false,wpm:this.session?.status.wpm??25,error:this.session?.status.error??this.error};
  }
  async abort(){ await this.session?.abort(); }
  async stop(){
    const server=this.server;this.server=undefined;
    if(this.socket){const socket=this.socket;await new Promise<void>(resolve=>{socket.once('close',()=>resolve());socket.destroy();});}
    await this.closing;
    if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}
