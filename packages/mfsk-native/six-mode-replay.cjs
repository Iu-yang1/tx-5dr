// Deterministic offline RX/TX probe for all six mfsk-core families.
// Golden compatibility acceptance additionally requires independent WSJT-X
// reference vectors (not produced here). No hardware, no RF and no PTT.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const native = require('./mfsk-native.node');
const REPORT = path.join(__dirname,'six-mode-replay-report.json');
const Fs = 12000;
let rng = 0x51af6d2b;
function random() {
  rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
  return ((rng >>> 0) + 0.5) / 4294967296;
}
function gaussian() {
  return Math.sqrt(-2 * Math.log(Math.max(1e-10,random()))) * Math.cos(2*Math.PI*random());
}
function withChannel(tx,slotSeconds,offsetSeconds=0.5) {
  const n = Math.round(Fs * slotSeconds);
  assert(n > 0 && n <= Fs*300);
  const out=Buffer.allocUnsafe(n*4);
  const start=Math.round(Fs*offsetSeconds);
  const gain=0.35;
  for(let i=0;i<n;i++) {
    const s=i>=start && i-start<tx.sampleCount ?
      tx.pcmF32Le.readFloatLE(4*(i-start))*gain:0;
    out.writeFloatLE(s+0.002*gaussian(),i*4);
  }
  return out;
}
const results=[];
function record(name, fn, expected) {
  const started=performance.now();
  try{
    const messages=fn();
    const texts=messages.map(row=>row.text??row.message??'');
    const pass=expected.test(texts.join(' | '));
    results.push({name,pass,elapsedMs:Math.round(performance.now()-started),texts});
  }catch(err){
    results.push({name,pass:false,elapsedMs:Math.round(performance.now()-started),error:String(err)});
  }
  fs.writeFileSync(REPORT,JSON.stringify({codec:native.codecVersion(),results},null,2)+'\n');
}
for(const [name,seconds,text,offset] of [
  ['FT8',15,'CQ K1ABC FN42',0.5],
  ['FT4',7.5,'CQ K1ABC FN42',0.5],
  ['Q65-60B',60,'CQ K1ABC FN42',0.5],
  ['WSPR',120,'K1ABC FN42 37',2.0],
]){
  record(name,()=>{
    const tx=native.encodeSlotted(name,text,1500);
    assert.equal(tx.sampleRate,Fs);
    const ch=withChannel(tx,seconds,offset);
    return native.decodeSlotted(name,ch);
  }, /K1ABC/);
}
record('MSK144',()=>{
  const tx=native.encodeMsk144Standard('K1ABC','K2ABC','-10',5);
  const samples=withChannel(tx,5,0);
  return native.decodeMsk144Recording(samples,1500);
}, /K1ABC/);
record('JTTY',()=>{
  const tx=native.encodeJtty('CQ K1ABC',1500);
  const samples=withChannel(tx,Math.max(3,tx.sampleCount/Fs+0.8),0.2);
  return native.decodeJttyRecording(samples,1500);
}, /K1ABC/);
console.log(JSON.stringify(results,null,2));
if(process.env.MFSK_STRICT_LOOPBACK==='1'){
  assert(results.every(r=>r.pass),'six-mode RX/TX loopback acceptance failed; inspect report');
}
