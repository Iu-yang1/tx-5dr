import type { N1MMEntryFields, N1MMEntryState } from '@tx5dr/contracts';
/** A latest-value mailbox, not a keyboard-event replay queue. The local Windows
 * agent must report actual readback before a requested edit is acknowledged. */
export class N1MMEntryBridge {
  private revision=0;
  private fields:N1MMEntryFields={call:'',zone:''};
  private pending?: N1MMEntryState['pending'];
  private error?:string;
  private heartbeat=0;
  private updatedAt=0;
  constructor(private readonly clock=()=>Date.now()){}
  get online(){return this.heartbeat>0&&this.clock()-this.heartbeat<3000;}
  request(fields:N1MMEntryFields):N1MMEntryState{
    if(!this.online)throw new Error('N1MM Entry agent is offline');
    this.pending={revision:++this.revision,fields:{...fields},expiresAt:this.clock()+2500};
    this.error=undefined;
    return this.snapshot();
  }
  agent(update:{fields:N1MMEntryFields;appliedRevision?:number;error?:string}):N1MMEntryState{
    this.heartbeat=this.clock();
    const pending=this.pending;
    if(pending&&pending.expiresAt<=this.clock()){this.pending=undefined;this.error='Entry edit expired';}
    if(this.pending&&update.appliedRevision===this.pending.revision){
      const match=this.pending.fields.call===update.fields.call&&this.pending.fields.zone===update.fields.zone;
      this.error=update.error??(match?undefined:'N1MM Entry readback mismatch');
      this.pending=undefined;
    } else if(update.error) this.error=update.error;
    if(this.fields.call!==update.fields.call||this.fields.zone!==update.fields.zone){
      this.fields={...update.fields};this.updatedAt=this.clock();
    }
    return this.snapshot();
  }
  snapshot():N1MMEntryState{
    if(this.pending&&(!this.online||this.pending.expiresAt<=this.clock())){this.pending=undefined;this.error='Entry edit expired or agent disconnected';}
    return {online:this.online,fields:{...this.fields},revision:this.revision,pending:this.pending,error:this.error,updatedAt:this.updatedAt};
  }
}
