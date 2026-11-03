// Reproducible native FT8/FT4 AWGN sensitivity survey.
// This is not a validated Watterson model or an independent WSJT-X comparison.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const native=require('./mfsk-native.node');
const fsHz=12000,bw=2500,mode=process.env.MFSK_MODE||'FT8';
const ntrials=Number(process.env.MFSK_TRIALS||'20');
assert(['FT8','FT4'].includes(mode));
assert(Number.isInteger(ntrials)&&ntrials>=1&&ntrials<=500);
const period=mode==='FT8'?15:7.5;
const text='CQ K1ABC FN42',tx=native.encodeSlotted(mode,text,1500);
assert.equal(tx.sampleRate,fsHz);
let signalPower=0;
for(let i=0;i<tx.sampleCount;i++){
 const sample=tx.pcmF32Le.readFloatLE(i*4);signalPower+=sample*sample;
}
signalPower/=tx.sampleCount;
function rng(seed){
 let s=seed>>>0;
 return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return ((s>>>0)+.5)/4294967296};
}
function normal(random){return Math.sqrt(-2*Math.log(Math.max(random(),1e-12)))*Math.cos(2*Math.PI*random())}
function make(snr,seed){
 const rand=rng(seed),n=Math.round(period*fsHz),offset=6000;
 const noise=Math.sqrt(signalPower*(fsHz/2/bw)*Math.pow(10,-snr/10));
 const out=Buffer.allocUnsafe(n*4);
 for(let i=0;i<n;i++){
   const j=i-offset;
   const sig=j>=0&&j<tx.sampleCount?tx.pcmF32Le.readFloatLE(j*4):0;
   out.writeFloatLE(sig+noise*normal(rand),i*4);
 }
 return out;
}
function wilson(k,n){
 const z=1.96,p=k/n,denom=1+z*z/n;
 const mean=(p+z*z/(2*n))/denom;
 const delta=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom;
 return [Math.max(0,mean-delta),Math.min(1,mean+delta)];
}
const rows=[];
for(const snr of [-30,-28,-26,-24,-22,-20,-18,-16,-14,-12]){
 let hits=0,unrelated=0;
 const start=performance.now();
 for(let trial=0;trial<ntrials;trial++){
   const seed=(0x67aa5599^(trial*1664525)^((snr+50)*1013904223))>>>0;
   const messages=native.decodeSlotted(mode,make(snr,seed))
     .map(row=>String(row.text).trim().toUpperCase().replace(/\s+/g,' '));
   if(messages.includes(text))hits++;
   if(messages.some(m=>m!==text))unrelated++;
 }
 const result={snrDb:snr,success:hits,total:ntrials,rate:hits/ntrials,
   wilson95:wilson(hits,ntrials),unrelatedMessages:unrelated,
   meanDecodeMs:(performance.now()-start)/ntrials};
 console.log(result);rows.push(result);
}
let crossing=null;
for(let i=1;i<rows.length;i++){
 if(rows[i-1].rate<0.5&&rows[i].rate>=0.5){
   const a=rows[i-1],b=rows[i];
   crossing={bracket:[a.snrDb,b.snrDb],
     interpolatedDb:a.snrDb+(0.5-a.rate)*(b.snrDb-a.snrDb)/(b.rate-a.rate)};
   break;
 }
}
const result={codec:native.codecVersion(),mode,channel:'deterministic AWGN',
 referenceBandwidthHz:bw,sampleRateHz:fsHz,trialsPerSnr:ntrials,
 rows,threshold50:crossing,
 limitations:['Self-coded frames, not an independent WSJT-X source',
 'SNR calibration uses active signal RMS; no equipment noise temperature',
 'No formal Watterson/Doppler model; not sufficient alone for P9']};
fs.writeFileSync(path.join(__dirname,'sensitivity-'+mode.toLowerCase()+'.json'),
 JSON.stringify(result,null,2)+'\n');
console.log('50% threshold estimate',crossing??'outside measured SNR window');
