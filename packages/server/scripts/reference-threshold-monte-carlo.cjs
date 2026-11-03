/**
 * Full-reference weak-signal study. Independent wsjtx-lib transmitter,
 * identical AWGN PCM delivered to the Rust and WSJT-X-derived decoders.
 * 2.5 kHz reference noise bandwidth; one fixed random channel per trial.
 * This is OFFLINE evidence only, not a claim of RF or Watterson performance.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const native=require(path.resolve(__dirname,'../../mfsk-native/mfsk-native.node'));
const MODE=process.env.MFSK_MODE||'FT8',TRIALS=Number(process.env.MFSK_TRIALS||'20');
const Fs=12000,B=2500;
assert(['FT8','FT4'].includes(MODE),'mode must be FT8 or FT4');
assert(Number.isInteger(TRIALS)&&TRIALS>=1&&TRIALS<=200);
// One-dB grid: a 2-dB sweep cannot resolve a 0.5-dB P9 target.
const SNR=Array.from({length:19},(_,i)=>-30+i);
function generator(seed) {
 let state=seed>>>0;
 return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return ((state>>>0)+0.5)/4294967296};
}
function normal(random) {
 return Math.sqrt(-2*Math.log(Math.max(random(),1e-12)))*Math.cos(2*Math.PI*random());
}
function wilson(success,total){
 const z=1.96,p=success/total,denom=1+z*z/total;
 const center=(p+z*z/(2*total))/denom;
 const delta=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/denom;
 return [Math.max(0,center-delta),Math.min(1,center+delta)];
}
function threshold(rows,key){
 for(let i=1;i<rows.length;i++){
  const a=rows[i-1],b=rows[i];
  if(a[key]<0.5&&b[key]>=0.5) {
   return {bracket:[a.snrDb,b.snrDb],
    interpolatedDb:a.snrDb+(0.5-a[key])*(b.snrDb-a.snrDb)/(b[key]-a[key])};
  }
 }
 return null;
}
function makeChannel(tx,snrDb,trial){
 const n=Math.round((MODE==='FT8'?15:7.5)*Fs),offset=6000;
 let power=0;for(const s of tx)power+=s*s;power/=tx.length;
 const noiseSigma=Math.sqrt(power*(Fs/2/B)*Math.pow(10,-snrDb/10));
 const rand=generator((0x8a17b46^trial*1664525^((snrDb+60)*7919))>>>0);
 const out=new Float32Array(n);
 let peak=0;
 for(let i=0;i<n;i++){
  const index=i-offset,signal=index>=0&&index<tx.length?tx[index]:0;
  const sample=signal+noiseSigma*normal(rand);
  out[i]=sample;peak=Math.max(peak,Math.abs(sample));
 }
 // Avoid differential clipping in the reference int16 conversion.
 if(peak>0.85){const scale=0.85/peak;for(let i=0;i<n;i++)out[i]*=scale;}
 return out;
}
function normalize(s){return String(s??'').trim().toUpperCase().replace(/\s+/g,' ');}
/**
 * Paired nonparametric bootstrap over independent channel realizations at
 * every SNR. A single trial index contributes BOTH decoder decisions so the
 * strong correlation from identical noise and waveform is preserved.
 * Thresholds without a 50% crossing are explicitly inconclusive.
 */
function pairedThresholdBootstrap(samplesBySnr,replicates=500){
 const rnd=generator(0x65a22ef7);
 const delta=[];
 let missing=0;
 for(let replicate=0;replicate<replicates;replicate++){
  const stats=samplesBySnr.map((pairs,i)=>{
   let rust=0,ref=0;
   for(let k=0;k<pairs.length;k++){
    const sample=pairs[Math.floor(rnd()*pairs.length)];
    rust+=sample[0];ref+=sample[1];
   }
   return {snrDb:SNR[i],rustRate:rust/pairs.length,
    referenceRate:ref/pairs.length};
  });
  const rust50=threshold(stats,'rustRate');
  const wsjt50=threshold(stats,'referenceRate');
  if(!rust50||!wsjt50){missing++;continue;}
  delta.push(rust50.interpolatedDb-wsjt50.interpolatedDb);
 }
 if(!delta.length)return {replicates,valid:0,missing,lower95:null,upper95:null,median:null};
 delta.sort((a,b)=>a-b);
 const quantile=q=>{
  const position=q*(delta.length-1),lo=Math.floor(position),hi=Math.ceil(position);
  return delta[lo]+(delta[hi]-delta[lo])*(position-lo);
 };
 return {replicates,valid:delta.length,missing,lower95:quantile(.025),
  median:quantile(.5),upper95:quantile(.975)};
}

async function main(){
 const {WSJTXLib,WSJTXMode}=await import('wsjtx-lib');
 const lib=new WSJTXLib({maxThreads:1});
 const mode=MODE==='FT8'?WSJTXMode.FT8:WSJTXMode.FT4;
 const message='CQ K1ABC FN42';
 const legacyTx=await lib.encode(mode,message,1500);
 const sourceRate=legacyTx.sampleRate??lib.getSampleRate(mode);
 assert.equal(sourceRate,Fs);
 const tx=legacyTx.audioData instanceof Float32Array
  ?legacyTx.audioData:new Float32Array(legacyTx.audioData);
 assert(tx.length>Fs);
 const rows=[];
 const pairedOutcomes=[];
 for(const snrDb of SNR){
  let rustHits=0,referenceHits=0,unexpectedRust=0,unexpectedReference=0;
  const paired=[];
  for(let trial=0;trial<TRIALS;trial++){
   const shared=makeChannel(tx,snrDb,trial);
   const asBuffer=Buffer.from(shared.buffer,shared.byteOffset,shared.byteLength);
   const nr=native.decodeSlotted(MODE,asBuffer);
   const nativeMessages=nr.map(x=>normalize(x.text));
   const nativeHit=nativeMessages.includes(message);
   if(nativeHit)rustHits++;
   if(nativeMessages.some(x=>x!==message))unexpectedRust++;
   const int16=await lib.convertAudioFormat(shared,'int16');
   const result=await lib.decode(mode,int16,{
     frequency:0,txFrequency:0,threads:1,apDecode:false,decodeDepth:3,qsoProgress:0,
   });
   const referenceMessages=(result.messages??[]).map(x=>normalize(x.text));
   const referenceHit=referenceMessages.includes(message);
   if(referenceHit)referenceHits++;
   if(referenceMessages.some(x=>x!==message))unexpectedReference++;
   paired.push([Number(nativeHit),Number(referenceHit)]);
  }
  const row={
   snrDb,trialCount:TRIALS,
   rust:{hits:rustHits,rate:rustHits/TRIALS,wilson95:wilson(rustHits,TRIALS),
     unexpectedFrames:unexpectedRust},
   wsjt:{hits:referenceHits,rate:referenceHits/TRIALS,wilson95:wilson(referenceHits,TRIALS),
     unexpectedFrames:unexpectedReference},
  };
  rows.push(row);pairedOutcomes.push(paired);console.log(JSON.stringify(row));
 }
 const reduced=rows.map(r=>({...r,rustRate:r.rust.rate,referenceRate:r.wsjt.rate}));
 const rust50=threshold(reduced,'rustRate'),reference50=threshold(reduced,'referenceRate');
 const deltaDb=rust50&&reference50?rust50.interpolatedDb-reference50.interpolatedDb:null;
 const pairedDelta95=pairedThresholdBootstrap(pairedOutcomes);
 const result={protocol:MODE,source:'Independent wsjtx-lib@2.2.0 transmit samples',
   codec:native.codecVersion(),reference:'wsjtx-lib@2.2.0',
   noiseReferenceBandwidthHz:B,sampleRateHz:Fs,TRIALS,
   randomizedBy:'seeded xorshift + Box-Muller; same waveform and noise to both decoders',
   rows,rust50,reference50,rustDegradationDb:deltaDb,pairedDelta95,
   underHalfDbTarget:deltaDb===null||pairedDelta95.upper95===null?null:
     (deltaDb<=0.5&&pairedDelta95.upper95<=0.5&&pairedDelta95.valid>=.95*pairedDelta95.replicates),
   caveats:['50% crossing is linearly interpolated, not an MLE or a fitted psychometric curve',
     'Per-SNR Wilson intervals and a paired nonparametric bootstrap interval for the 50% threshold difference are reported',
     'The 1 dB threshold interpolation grid is an approximation; refinement should use sub-dB measurements',
     'AWGN only; Watterson, drifting Doppler and strong QRM require independent tests'],
 };
 const output=path.join(__dirname,'reference-threshold-'+MODE.toLowerCase()+'.json');
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({output,rust50,reference50,deltaDb}));
 if(process.env.MFSK_ENFORCE_THRESHOLD==='1'){
  assert(TRIALS>=60,'P9 0.5 dB acceptance needs at least 60 paired trials per SNR');
  assert(deltaDb!==null,'Cannot claim P9 sensitivity: 50% threshold not bracketed');
  assert(pairedDelta95.valid>=.95*pairedDelta95.replicates,
    'P9 sensitivity inconclusive: too many bootstrap samples lack a 50% crossing');
  assert(pairedDelta95.upper95!==null&&pairedDelta95.upper95<=0.5,
    'P9 sensitivity not accepted: upper 95% paired-bootstrap degradation >0.5 dB');
  assert(deltaDb<=0.5,'mfsk-core 50% decode threshold is >0.5 dB worse than reference');
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
