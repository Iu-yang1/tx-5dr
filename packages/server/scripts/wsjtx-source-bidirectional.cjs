#!/usr/bin/env node
/**
 * Source-built WSJT-X 3.3.0-beta5 bidirectional protocol reference.
 * The independent oracle is NOT wsjtx-lib. Build the official Qt-free
 * wsjt-codec and wsprd at pinned 40-hex SHA and pass their executable paths.
 *
 * TX reference -> native Rust RX; native Rust TX -> official WSJT-X RX.
 * All audio is actual 12 kHz mono PCM, not the decoder's own matched oracle.
 * Stop on any missing/failed mode; never use this process in production.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const native=require(path.resolve(__dirname,'../../mfsk-native/mfsk-native.node'));

const CODEC=process.env.WSJT_CODEC_BIN;
const WSPRD=process.env.WSPRD_BIN;
assert(CODEC&&WSPRD,'WSJT_CODEC_BIN and WSPRD_BIN must be explicit pinned reference binaries');
const FS=12000;
const normalize=text=>String(text??'').trim().replace(/\s+/g,' ').toUpperCase();
const report={source:'WSJTX/wsjtx @ d89fe30ca1dfd3c38def8f17228f09f042829f95',
  codec:native.codecVersion(),tests:[]};
const output=path.resolve(__dirname,'wsjtx-source-bidirectional-report.json');
const frame=(type,body)=>{
  const h=Buffer.alloc(5);
  h.writeUInt8(type,0);h.writeUInt32LE(body.length,1);
  return Buffer.concat([h,body]);
};
const control=obj=>frame(2,Buffer.from(JSON.stringify(obj),'utf8'));
const HEADER=Buffer.from([0x57,0x53,0x4a,0x54,0,1,12,0]);
function stream(commands,timeoutMs=300000){
  const input=Buffer.concat([HEADER,...commands,control({t:'halt'})]);
  const result=spawnSync(CODEC,['--stream'],{input,maxBuffer:64*1024*1024,
    timeout:timeoutMs,encoding:'utf8'});
  if(result.error)throw result.error;
  const lines=(result.stdout??'').split(/\r?\n/);
  const events=[];
  for(const line of lines){
    if(!line.trim().startsWith('{'))continue;
    try{events.push(JSON.parse(line));}
    catch{throw new Error('Invalid WSJT-X NDJSON: '+line.slice(0,200));}
  }
  const errors=events.filter(x=>x.t==='error'||x.t==='rejected');
  if(result.status!==0||errors.length){
    throw new Error('WSJT-X stream failed: exit='+result.status+' errors='+
      JSON.stringify(errors).slice(0,2500)+' stderr='+
      String(result.stderr??'').slice(-1500));
  }
  return events;
}
function floatToI16(audio){
  const buf=Buffer.alloc(audio.length*2);
  for(let i=0;i<audio.length;i++){
    const x=audio[i];
    assert(Number.isFinite(x),'Invalid native reference audio');
    buf.writeInt16LE(Math.round(Math.max(-1,Math.min(1,x))*32767),i*2);
  }
  return buf;
}
function i16ToFloat(buf){
  assert.equal(buf.length%2,0);
  const out=new Float32Array(buf.length/2);
  for(let i=0;i<out.length;i++)out[i]=buf.readInt16LE(i*2)/32768;
  return out;
}
function nativeF32(wave){
  assert.equal(wave.sampleRate,FS);
  assert.equal(wave.pcmF32Le.length,wave.sampleCount*4);
  const result=new Float32Array(wave.sampleCount);
  for(let i=0;i<result.length;i++)result[i]=wave.pcmF32Le.readFloatLE(i*4);
  return result;
}
function slot(pcm,seconds,offset=0.5){
  const n=Math.round(seconds*FS);
  const out=new Float32Array(n);
  const i0=Math.round(offset*FS);
  // WSJT-X's repeated MSK144 modulator may return one extra trailing
  // sample; never silently drop anything except that documented endpoint.
  assert(pcm.length<=n+1,'Waveform exceeds reference period');
  const actual=pcm.length===n+1?pcm.subarray(0,n):pcm;
  const start=Math.min(i0,n-actual.length);
  out.set(actual,start);
  return out;
}
function audioFrames(pcm){
  const buf=floatToI16(pcm);
  const frames=[];
  for(let start=0;start<buf.length;start+=8192){
    frames.push(frame(1,buf.subarray(start,Math.min(buf.length,start+8192))));
  }
  return frames;
}
function render(config){
  const args={t:'render',id:1,mode:config.mode,text:config.message,
    freq:config.mode==='MSK144'?1000:1500,rate:FS,
    ...(config.periodParam?{trperiod:config.periodParam}:{}),
    ...(config.submode?{submode:config.submode}:{})};
  const e=stream([control({t:'configure',mycall:'K1ABC',mygrid:'FN42'}),control(args)]);
  const ok=e.find(x=>x.t==='rendered'&&x.id===1);
  assert(ok,config.mode+' reference render not completed');
  const pcm=e.filter(x=>x.t==='pcm'&&x.id===1)
    .sort((a,b)=>(a.seq??0)-(b.seq??0)).map(x=>Buffer.from(x.data,'base64'));
  assert(pcm.length,config.mode+' source reference did not return PCM');
  return {audio:i16ToFloat(Buffer.concat(pcm)),events:e};
}
function nativeReceive(config,pcm){
  const mode=config.nativeMode||config.mode;
  if(['FT8','FT4','Q65-60B','WSPR'].includes(mode)){
    return native.decodeSlotted(mode,Buffer.from(pcm.buffer,pcm.byteOffset,pcm.byteLength))
      .map(x=>normalize(x.text));
  }
  if(mode==='MSK144'||mode==='MSK40'){
    const session=new native.Msk144Session(1500,mode==='MSK40'?12:200);
    if(mode==='MSK40')session.configureShorthand(true,'K1ABC','W9XYZ');
    const found=[];
    for(let k=0;k<pcm.length;k+=4096){
      const part=pcm.subarray(k,Math.min(pcm.length,k+4096));
      found.push(...session.push(Buffer.from(part.buffer,part.byteOffset,part.byteLength))
        .map(x=>normalize(x.text)));
    }
    return found;
  }
  if(mode==='JTTY'){
    const session=new native.JttySession(1500);
    const found=[];
    for(let k=0;k<pcm.length;k+=4096){
      const part=pcm.subarray(k,Math.min(pcm.length,k+4096));
      found.push(...session.push(Buffer.from(part.buffer,part.byteOffset,part.byteLength))
        .map(x=>normalize(x.text)));
    }
    found.push(...session.finish().map(x=>normalize(x.text)));
    return found;
  }
  throw Error('Unknown mode '+mode);
}
function wsjtReceive(config,pcm){
  if(config.mode==='WSPR'){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tx5dr-wsjtx-wspr-'));
    try{
      const wav=path.join(dir,'000000_0000.wav');
      const samples=floatToI16(pcm);
      const hdr=Buffer.alloc(44);
      hdr.write('RIFF',0);hdr.writeUInt32LE(36+samples.length,4);
      hdr.write('WAVEfmt ',8);hdr.writeUInt32LE(16,16);
      hdr.writeUInt16LE(1,20);hdr.writeUInt16LE(1,22);hdr.writeUInt32LE(FS,24);
      hdr.writeUInt32LE(FS*2,28);hdr.writeUInt16LE(2,32);hdr.writeUInt16LE(16,34);
      hdr.write('data',36);hdr.writeUInt32LE(samples.length,40);
      fs.writeFileSync(wav,Buffer.concat([hdr,samples]));
      const p=spawnSync(WSPRD,['-a',dir,'-w','-f','14.0956',wav],{
        timeout:180000,encoding:'utf8',maxBuffer:8*1024*1024,cwd:dir});
      if(p.error||p.status!==0)throw new Error('wsprd failed '+p.status+' '+(p.stderr??''));
      return (p.stdout??'').split(/\r?\n/).map(normalize).filter(Boolean);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
  const req={t:'configure',mode:config.mode==='MSK40'?'MSK144':config.mode,
    rxfreq:1500,ntol:200,nfa:200,nfb:3000,depth:3,
    mycall:'K1ABC',hiscall:'W9XYZ',
    ...(config.periodParam?{trperiod:config.periodParam}:{}),
    ...(config.submode?{submode:config.submode}:{})};
  const events=stream([control(req),...audioFrames(pcm)],360000);
  return events.filter(x=>x.t==='decode'||x.t==='jtty_update')
    .map(x=>normalize(x.message??x.text)).filter(Boolean);
}
const configs=[
 {mode:'FT8',nativeMode:'FT8',message:'CQ K1ABC FN42',period:15},
 {mode:'FT4',nativeMode:'FT4',message:'CQ K1ABC FN42',period:7.5},
 {mode:'Q65',nativeMode:'Q65-60B',message:'CQ K1ABC FN42',period:60,
  periodParam:60,submode:'B'},
 {mode:'WSPR',nativeMode:'WSPR',message:'K1ABC FN42 37',period:120},
 {mode:'MSK144',nativeMode:'MSK144',message:'K1ABC W9XYZ -10',period:5,periodParam:5},
 {mode:'MSK144',nativeMode:'MSK40',message:'<K1ABC W9XYZ> RRR',
  period:5,periodParam:5},
 {mode:'JTTY',nativeMode:'JTTY',message:'CQ K1ABC CQ',period:40},
];
(async()=>{
  for(const config of configs){
    const key=config.nativeMode;
    try{
      const reference=render(config);
      const sourcePcm=slot(reference.audio,config.period);
      const rxRust=nativeReceive(config,sourcePcm);
      const sourceText=normalize(config.message);
      report.tests.push({mode:key,direction:'reference-TX -> Rust-RX',
        pass:rxRust.some(x=>x.includes(sourceText)),
        decoded:rxRust.slice(0,15),
        sourceSamples:reference.audio.length});

      let nativeTx;
      if(config.nativeMode==='MSK144')
        nativeTx=native.encodeMsk144Standard('K1ABC','W9XYZ','-10',5);
      else if(config.nativeMode==='MSK40')
        nativeTx=native.encodeMsk40Shorthand('K1ABC','W9XYZ','RRR',5);
      else if(config.nativeMode==='JTTY')
        nativeTx=native.encodeJtty(config.message,1500);
      else nativeTx=native.encodeSlotted(config.nativeMode,config.message,1500);
      const rustPcm=slot(nativeF32(nativeTx),config.period);
      const refRx=wsjtReceive(config,rustPcm);
      report.tests.push({mode:key,direction:'Rust-TX -> reference-RX',
        pass:refRx.some(x=>x.includes(sourceText)),
        decoded:refRx.slice(0,15),sourceSamples:nativeTx.sampleCount});
    }catch(err){
      report.tests.push({mode:key,direction:'both',pass:false,error:String(err)});
    }
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  }
  console.log(JSON.stringify({reference:report.source,tests:report.tests},null,2));
  assert.equal(report.tests.length,configs.length*2,'Reference validation missing a direction');
  assert(report.tests.every(x=>x.pass===true),
    'Independent source-built WSJT-X bidirectional reference tests not accepted');
})().catch(err=>{
  console.error(err);
  fs.writeFileSync(output,JSON.stringify({...report,error:String(err)},null,2)+'\n');
  process.exitCode=1;
});
