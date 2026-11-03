/**
 * Independent FT8/FT4 interoperability gate.
 * Legacy wsjtx-lib@2.2.0 is a development-only reference decoder/encoder.
 * The production Rust implementation MUST decode another encoder's waveform
 * and the legacy reference MUST decode the Rust TX waveform.
 *
 * This is two-way protocol compatibility under clean AWGN, NOT BER threshold
 * equivalence, RF readiness, or a claim about all WSJT-X framing variants.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const native=require(path.resolve(__dirname,'../../mfsk-native/mfsk-native.node'));
const SAMPLE_RATE=12000;
const report=[];
const normalize=x=>String(x??'').trim().replace(/\s+/g,' ').toUpperCase();
function pcmSlot(samples,periodSeconds,offsetSeconds=0.5,scale=0.5){
  assert(samples instanceof Float32Array);
  const count=Math.round(periodSeconds*SAMPLE_RATE);
  const out=new Float32Array(count);
  const start=Math.round(offsetSeconds*SAMPLE_RATE);
  for(let i=0;i<samples.length && i+start<count;i++){
    const value=samples[i]*scale;
    assert(Number.isFinite(value));
    out[start+i]=value;
  }
  return out;
}
function toBuffer(samples){
  return Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength);
}
async function run(){
  const {WSJTXLib,WSJTXMode}=await import('wsjtx-lib');
  const legacy=new WSJTXLib({maxThreads:1});
  for(const [name,period,mode] of [
    ['FT8',15,WSJTXMode.FT8],
    ['FT4',7.5,WSJTXMode.FT4],
  ]){
    const message='CQ K1ABC FN42';
    const legacyTx=await legacy.encode(mode,message,1500);
    const sourceRate=legacyTx.sampleRate??legacy.getSampleRate(mode);
    assert.equal(sourceRate,SAMPLE_RATE,`Unexpected reference sample rate for ${name}`);
    const legacyFloat=legacyTx.audioData instanceof Float32Array
      ? legacyTx.audioData : new Float32Array(legacyTx.audioData);
    const referenceChannel=pcmSlot(legacyFloat,period);
    const nativeRows=native.decodeSlotted(name,toBuffer(referenceChannel));
    const nativeDecoded=nativeRows.map(x=>normalize(x.text));
    const refToNative=nativeDecoded.includes(message);
    report.push({mode:name,direction:'reference-TX -> Rust-RX',pass:refToNative,
      decoded:nativeDecoded.slice(0,12),referenceSampleCount:legacyFloat.length});

    const newTx=native.encodeSlotted(name,message,1500);
    assert.equal(newTx.sampleRate,SAMPLE_RATE);
    const samples=new Float32Array(newTx.sampleCount);
    for(let i=0;i<samples.length;i++)samples[i]=newTx.pcmF32Le.readFloatLE(4*i);
    const rustChannel=pcmSlot(samples,period);
    const int16=await legacy.convertAudioFormat(rustChannel,'int16');
    const refResult=await legacy.decode(mode,int16,{
      frequency:0,txFrequency:0,threads:1,apDecode:false,
      decodeDepth:3,qsoProgress:0,
    });
    const legacyDecoded=(refResult.messages??[]).map(x=>normalize(x.text));
    report.push({mode:name,direction:'Rust-TX -> reference-RX',
      pass:legacyDecoded.includes(message),
      decoded:legacyDecoded.slice(0,12),rustSampleCount:samples.length});
  }
  fs.writeFileSync(path.resolve(__dirname,'reference-crosscodec-report.json'),
    JSON.stringify({codec:native.codecVersion(),
      reference:'wsjtx-lib@2.2.0 (development-only)',results:report},null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  assert(report.every(x=>x.pass),
    'FT8/FT4 cross-codec reference interoperability failed; inspect report');
}
run().catch(err=>{
  console.error(err);
  process.exitCode=1;
  fs.writeFileSync(path.resolve(__dirname,'reference-crosscodec-report.json'),
    JSON.stringify({results:report,error:String(err)},null,2)+'\n');
});
