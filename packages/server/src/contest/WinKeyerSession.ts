/**
 * K1EL Host Mode compatibility subset (WK2 host framing, single output).
 * RF timing is owned by CWKeyerManager at the station, not TCP/COM timing.
 * CAT backends send complete text blocks, so echo is emitted on block
 * completion, not falsely represented as a per-element hardware observation.
 */
export interface WinKeyerBackend {
  send(text: string, wpm: number, valid: () => boolean): Promise<void>;
  stop(): Promise<void>;
  speed(wpm: number): Promise<void>;
  key?(down: boolean, valid: () => boolean): Promise<void>;
}
type Job = { text: string } | { wpm: number } | { wait: number } | { keyFor: number };
const PROSIGNS = new Set(['AR','SK','BT','KN','BK','CL']);
export class WinKeyerSession {
  private input: number[] = [];
  private queue: Job[] = [];
  private draft = '';
  private opened = false;
  private closed = false;
  private running = false;
  private paused = false;
  private epoch = 0;
  private wpm = 25;
  private baseWpm = 25;
  private minWpm = 10;
  private echo = true;
  private timer?: ReturnType<typeof setTimeout>;
  private waitTimer?: ReturnType<typeof setTimeout>;
  private releaseWait?: () => void;
  private stopTail = Promise.resolve();
  private keyTransition = Promise.resolve();
  private tuneTimer?: ReturnType<typeof setTimeout>;
  private tuning = false;
  private error?: string;
  constructor(private readonly backend: WinKeyerBackend, private readonly output: (bytes: Buffer) => void) {}
  get status() { return { opened: this.opened, busy: this.tuning || this.running || !!this.draft || this.queue.length > 0, wpm: this.wpm, error: this.error }; }
  private reply(...bytes: number[]) { if (!this.closed) this.output(Buffer.from(bytes)); }
  private report() {
    if (this.opened) this.reply(0xc0 | (this.status.busy ? 4 : 0) | (this.queuedChars() >= 106 ? 1 : 0) | ((this.paused || this.tuning || this.waitTimer) ? 0x10 : 0));
  }
  private queuedChars() { return this.draft.length + this.queue.reduce((n,j) => n + ('text' in j ? j.text.length : 1),0); }
  feed(bytes: Buffer) {
    if (this.closed) return;
    for(const byte of bytes)this.input.push(byte);
    while (this.input.length) {
      const code = this.input[0];
      let count = 1;
      if (code === 0) {
        if (this.input.length < 2) return;
        const admin = this.input[1];
        count = 2 + ([4,14,15,16].includes(admin) ? 1 : admin === 13 ? 256 : 0);
      } else if (code === 0x16) {
        if (this.input.length < 2) return;
        count = this.input[1] === 0 ? 2 : 3;
      } else if (code < 32) {
        const lengths: Record<number, number> = {1:2,2:2,3:2,4:3,5:4,6:2,7:1,8:1,9:2,10:1,11:2,12:2,13:2,14:2,15:16,16:2,17:2,18:2,19:1,20:2,21:1,23:2,24:2,25:2,26:2,27:3,28:2,29:2,30:1,31:1};
        count = lengths[code] ?? 1;
      }
      if (this.input.length < count) return;
      const command = this.input.splice(0,count);
      this.execute(command);
    }
  }
  private execute(b: number[]) {
    const c = b[0], v = b[1];
    if (c === 0) {
      if (v === 2) { this.opened = true; this.error = undefined; this.reply(23); return; }
      if (v === 4) { this.reply(b[2]); return; }
      if (v === 1 || v === 3) { this.opened = false; this.cancel(); return; }
      if (v === 9) { this.reply(23); return; }
      if ([5,6,7].includes(v)) { this.reply(0); return; }
      if (![0,10,11,15,16].includes(v)) this.error = 'Unsupported WinKeyer admin command ' + v;
      return;
    }
    if (!this.opened) return;
    if (c >= 32) {
      const text = String.fromCharCode(c).toUpperCase();
      if (!/^[A-Z0-9 .,?/=@+\-:;'!&()_$"]$/.test(text)) return;
      if (this.queuedChars() >= 160) { this.error = 'WinKeyer input buffer overflow'; this.cancel(); return; }
      this.draft += text;
      this.schedule();
      this.report();
      return;
    }
    switch(c) {
      case 0x02:
        if (v >= 5 && v <= 60) { this.baseWpm = v; this.flush(); this.enqueue({wpm:v}); }
        break;
      case 0x05: this.minWpm = v; break;
      case 0x06: this.paused = v !== 0; if (!this.paused) this.schedule(); this.report(); break;
      case 0x07: this.reply(0x80 | Math.max(0,Math.min(63,this.wpm-this.minWpm))); break;
      case 0x08: if (this.draft) this.draft = this.draft.slice(0,-1); else {const last=this.queue[this.queue.length-1]; if(last && 'text' in last) last.text=last.text.slice(0,-1);} break;
      case 0x0a: this.cancel(); break;
      case 0x0b:
        if (v === 1) this.beginTune();
        else if (v === 0 && this.tuning) this.cancel();
        break;
      case 0x0e: this.echo = !!(v & 4); break;
      case 0x0f:
        this.echo = !!(v & 4);
        if(b[2]>=5 && b[2]<=60) {this.baseWpm=b[2];this.flush();this.enqueue({wpm:b[2]});}
        this.minWpm=b[7]; break;
      case 0x15: this.report(); break;
      case 0x19:
        if(v<=99){this.flush();this.enqueue({keyFor:v*1000});}
        break;
      case 0x1a: if(v<=99){this.flush();this.enqueue({wait:v*1000});} break;
      case 0x1b: {
        const pair=String.fromCharCode(v,b[2]).toUpperCase();
        if(PROSIGNS.has(pair)) {this.draft+='<'+pair+'>';this.schedule();this.report();}
        else this.error='Unsupported merged CW characters: '+pair;
        break;
      }
      case 0x1c: if(v>=5&&v<=60){this.flush();this.enqueue({wpm:v});} break;
      case 0x1e: this.flush(); this.enqueue({wpm:this.baseWpm}); break;
      // The radio owns its own sidetone, lead/tail, weight and paddle settings.
      // Consume framing without claiming that those physical parameters changed.
      case 0x01: case 0x03: case 0x04: case 0x09: case 0x0d:
      case 0x10: case 0x11: case 0x12: case 0x17: case 0x13: case 0x1f: break;
      default: this.error = 'Unsupported WinKeyer command 0x' + c.toString(16); break;
    }
  }
  private async transitionKey(down: boolean, valid: () => boolean): Promise<void> {
    if (!this.backend.key) throw new Error('Physical CW backend does not support direct keying');
    const task = this.keyTransition.catch(()=>undefined).then(async()=>{
      if (!down || valid()) await this.backend.key!(down,valid);
    });
    this.keyTransition = task;
    await task;
  }
  private beginTune(): void {
    if (this.tuning) return;
    if (this.status.busy) { this.error='CW keyer is busy';return; }
    if (!this.backend.key) { this.error='Physical CW backend does not support direct keying';return; }
    this.tuning=true;
    const epoch=this.epoch;
    const valid=()=>this.opened&&!this.closed&&this.epoch===epoch&&this.tuning;
    this.report();
    const priorStop=this.stopTail;
    void priorStop.then(async()=>{
      if(!valid())return;
      await this.transitionKey(true,valid);
      if(valid())this.tuneTimer=setTimeout(()=>this.cancel(),100_000);
    }).catch(error=>{
      if(valid()){this.error=String(error);this.cancel();}
    });
  }
  private wait(ms:number):Promise<void> {
    return new Promise(resolve=>{
      this.releaseWait=resolve;
      this.waitTimer=setTimeout(()=>{this.waitTimer=undefined;this.releaseWait=undefined;resolve();},ms);
      this.report();
    });
  }
  private flush() {
    if (this.draft) { this.queue.push({text:this.draft}); this.draft=''; }
  }
  private enqueue(job: Job) { this.queue.push(job); this.schedule(); }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer=undefined; this.flush(); void this.drain(); }, 30);
  }
  private async drain() {
    if (this.running || this.paused || this.tuning || !this.opened || this.closed) return;
    this.running=true; const epoch=this.epoch;
    const valid=()=>this.opened && !this.closed && this.epoch===epoch;
    this.report();
    try {
      await this.stopTail;
      while(valid()&&!this.paused&&this.queue.length){
        const job=this.queue.shift()!;
        if ('wpm' in job) { this.wpm=job.wpm; await this.backend.speed(job.wpm); }
        else if ('wait' in job) await this.wait(job.wait);
        else if ('keyFor' in job) {
          await this.transitionKey(true,valid);
          try { if(valid())await this.wait(job.keyFor); }
          finally { await this.transitionKey(false,valid); }
        }
        else if(job.text.trim()){
          await this.backend.send(job.text,this.wpm,valid);
          if(valid()&&this.echo) this.reply(...Buffer.from(job.text.replace(/<([A-Z]+)>/g,'$1'),'ascii'));
        }
      }
    } catch(error) { if(valid()){this.error=String(error);this.queue=[];this.draft='';} }
    finally {this.running=false;this.releaseWait=undefined;if(this.waitTimer)clearTimeout(this.waitTimer);this.report();if(this.queue.length&&this.opened&&!this.paused&&!this.closed)this.schedule();}
  }
  private cancel() {
    this.epoch++;this.queue=[];this.draft='';this.paused=false;this.tuning=false;
    if(this.tuneTimer)clearTimeout(this.tuneTimer);
    this.tuneTimer=undefined;
    if(this.timer)clearTimeout(this.timer);this.timer=undefined;
    if(this.waitTimer)clearTimeout(this.waitTimer);this.releaseWait?.();this.releaseWait=undefined;
    // Wait for any in-flight direct key transition before releasing this host's lease.
    const transition=this.keyTransition;
    this.stopTail=this.stopTail.catch(()=>undefined).then(()=>transition.catch(()=>undefined)).then(()=>this.backend.stop()).catch(error=>{this.error=String(error);});
    this.report();
  }
  async abort() { this.cancel(); await this.stopTail; }
  async close() { this.closed=true;this.opened=false;this.input=[];await this.abort(); }
}
