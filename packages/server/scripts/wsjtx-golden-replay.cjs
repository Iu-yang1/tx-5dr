/**
 * Independent WSJT-X off-air reference recording acceptance.
 * Corpus: pinned jl1nie/mfsk-core v0.15.0 Golden tier B (itself copied
 * from WSJT-X/samples). No corpus -> hard failure; no silent skips.
 *
 * Native Node API is the exact .node packaged into TX-5DR, rather than
 * a separate Rust unit-test build. Recall, extra decodes and frequency
 * deviation are reported independently. This is not an SNR sweep.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const native=require(path.resolve(__dirname,'../../mfsk-native/mfsk-native.node'));
const upstream=process.argv[2];
if(!upstream)throw Error('Usage: node wsjtx-golden-replay.cjs <upstream-golden-dir>');
const root=path.resolve(upstream);
const reportFile=path.resolve(__dirname,'wsjtx-golden-replay-report.json');
const results=[];
function wav(relative){
  const p=path.join(root,relative);
  assert(fs.existsSync(p),`Missing mandatory official golden WAV: ${relative}`);
  const data=fs.readFileSync(p);
  assert(data.toString('ascii',0,4)==='RIFF' &&
    data.toString('ascii',8,12)==='WAVE',`Bad RIFF: ${relative}`);
  let offset=12,format=null,pcm=null;
  while(offset+8<=data.length){
    const id=data.toString('ascii',offset,offset+4);
    const size=data.readUInt32LE(offset+4);
    const start=offset+8;
    assert(size<=data.length-start,`WAV truncated chunk ${relative}: ${id}`);
    if(id==='fmt '){
      assert(size>=16);
      format={type:data.readUInt16LE(start),channels:data.readUInt16LE(start+2),
        rate:data.readUInt32LE(start+4),bits:data.readUInt16LE(start+14)};
    }
    if(id==='data')pcm=data.subarray(start,start+size);
    offset=start+size+(size%2);
  }
  assert(format&&pcm, `Missing fmt/data: ${relative}`);
  assert.equal(format.channels,1,`Not mono: ${relative}`);
  assert.equal(format.rate,12000,`Not 12 kHz: ${relative}`);
  let samples;
  if(format.type===1 && format.bits===16){
    assert.equal(pcm.length%2,0);
    samples=new Float32Array(pcm.length/2);
    for(let i=0;i<samples.length;i++)samples[i]=pcm.readInt16LE(i*2)/32768;
  }else if(format.type===3 && format.bits===32){
    assert.equal(pcm.length%4,0);
    samples=new Float32Array(pcm.length/4);
    for(let i=0;i<samples.length;i++)samples[i]=pcm.readFloatLE(i*4);
  }else throw Error(`Unsupported WAV PCM format ${relative}: ${format.type}/${format.bits}`);
  assert(samples.length>12000,`WAV unexpectedly short: ${relative}`);
  return Buffer.from(samples.buffer,samples.byteOffset,samples.byteLength);
}
const norm=x=>String(x??'').toUpperCase().trim().replace(/\s+/g,' ');
function score(name,decoded,expected,minRecall,maxExtra,evaluationBand=null){
  const all=decoded.map(row=>({
    text:norm(row.text),frequencyHz:Number(row.frequencyHz),
    snrDb:Number(row.snrDb),dtSeconds:Number(row.dtSeconds),
  })).filter(row=>row.text);
  const observed=evaluationBand ? all.filter(row=>
    row.frequencyHz>=evaluationBand[0]&&row.frequencyHz<=evaluationBand[1]) : all;
  const outsideReferencePassband=evaluationBand ? all.filter(row=>
    row.frequencyHz<evaluationBand[0]||row.frequencyHz>evaluationBand[1]) : [];
  // Decoder may emit multiple versions of the same message on one real
  // recording. A duplicate with a new frequency is treated as a separate
  // hit so false multi-frequency ghosts cannot hide behind deduplication.
  const matched=[];
  const unused=[...observed];
  for(const reference of expected){
    const index=unused.findIndex(r=>r.text===reference.text
      && (!Number.isFinite(reference.freq) || Math.abs(r.frequencyHz-reference.freq)<reference.tolHz));
    if(index>=0){matched.push(reference.text);unused.splice(index,1);}
  }
  const extras=unused.map(x=>({text:x.text,frequencyHz:x.frequencyHz}));
  const pass=matched.length>=minRecall && extras.length<=maxExtra;
  results.push({name,pass,minRecall,maxExtra,recall:matched.length,
    totalExpected:expected.length,extraCount:extras.length,
    missing:expected.filter(x=>!matched.includes(x.text)).map(x=>x.text),
    extras,outsideReferencePassband,decoded:observed.slice(0,60)});
  console.log(`${pass?'PASS':'FAIL'} ${name}: recall ${matched.length}/${expected.length} (min ${minRecall}), extras ${extras.length} (max ${maxExtra})`);
}
const exp=(text,freq,tolHz=15)=>({text:norm(text),freq,tolHz});
function slotted(name,filename,expected,minRecall,maxExtra){
  const pcm=wav(filename);
  const decoder=new native.SlottedSession(name);
  decoder.setParameters(3,false);
  const rows=decoder.decode(pcm,0,false);
  // WSJT-X FT4 oracle used -L 300 -H 2700, while one of its genuine
  // reference decodes is measured at 297 Hz. Allow the upstream
  // documented ±12 Hz frequency tolerance at each band edge; still
  // report all out-of-band detections and reject every in-band phantom.
  const band=name==='FT4'?[300-12,2700+12]:null;
  score(name,rows,expected,minRecall,maxExtra,band);
}
// Reference lists transcribed from upstream mfsk-core/tests/{ft4,wspr,
// q65,msk144}_wsjtx_samples.rs, explicitly derived from WSJT-X jt9/wsprd.
// Do not change an expected item to match new decoder output.
slotted('FT4','ft4/000000_000002.wav',[
  exp('AC6BW KR9A R 559 WI',2300),exp('CQ RU AB5XS EM12',560),
  exp('CQ RU N9OY EN43',1640),exp('CQ RU W0FRC DM79',2560),
  exp('K1JT WB4HXE 559 GA',1910),exp('KB0VHA KA1YQC R 539 MA',1149),
  exp('N1TRK KB7RUQ RR73',422),exp('N1TRK N4FKH 569 VA',297),
  exp('NI6G W7DRW 569 AZ',2567),exp('NZ7P WA7JAY 589 CA',727),
  exp('VE3LON K7RL R 549 WA',2067),exp('W7BOB KJ7G RR73',2413),
  exp('W9JA PY2APK RRR',520),exp('WD9IGY KX1X 73',2310),
],14,0);
slotted('WSPR','wspr/150426_0918.wav',[
  exp('ND6P DM04 30',1446,4),exp('W5BIT EL09 17',1460,4),
  exp('WD4LHT EL89 30',1489,4),exp('NM7J DM26 30',1503,4),
  exp('KI7CI DM09 37',1517,4),exp('DJ6OL JO52 37',1530,4),
  exp('W3HH EL89 30',1587,4),exp('W3BI FN20 30',1594,4),
  exp('G8VDQ IO91 37',1465,4),
],9,0);
slotted('Q65-60A','q65/60A_EME_6m/210106_1621.wav',[
  exp('W7GJ N8JX EN73',697,4),exp('W7GJ N0TB -15',943,4),
  exp('W7GJ W1VD FN31',1420,4),exp('W7GJ VE1JF RRR',1620,4),
],4,0);
for(const [file,golden] of [
 ['181211_120500.wav',[exp('K1JT WA4CQG EM72',1488,15)]],
 ['181211_120800.wav',[exp('CQ W4IMD EM84',1458,15),exp('CQ KD9VV EN71',1496,15)]],
]){
  const rows=native.decodeMsk144Recording(wav('msk144/'+file),1477);
  score('MSK144 '+file,rows,golden,golden.length,0);
}
{
  const updates=native.decodeJttyRecording(wav('jtty/260807_134110.wav'),1500);
  const final=updates.filter(u=>u.state==='complete'||u.state==='reception-ended');
  const byId=new Map();
  for(const u of final)byId.set(u.id,{text:u.text,frequencyHz:u.frequencyHz});
  // The original rjtty rc1 knows one false accept "4>-P'" at 1695.6 Hz.
  // Treat exactly this legacy debt as documented, never a blanket budget.
  const all=[...byId.values()];
  const real='RAN ALL NIGHT ON BAND NOISE - NO FALSE DECODES!';
  const hits=all.filter(x=>norm(x.text)===real);
  const extras=all.filter(x=>norm(x.text)!==real);
  const known=extras.every(x=>norm(x.text)==="4>-P'"&&Math.abs(x.frequencyHz-1695.6)<=1);
  const pass=hits.length>=1&&extras.length<=1&&known;
  results.push({name:'JTTY WSJT-X rc1 off-air',pass,
    recall:hits.length,extraCount:extras.length,knownHistoricalFalseAccept:known,
    decoded:all});
  console.log(`${pass?'PASS':'FAIL'} JTTY off-air: real ${hits.length}, extras ${extras.length}, known ${known}`);
}
fs.writeFileSync(reportFile,JSON.stringify({
  source:'WSJT-X samples vendored in jl1nie/mfsk-core v0.15.0 (GPL-3.0-only)',
  addon:native.codecVersion(),tests:results,
},null,2)+'\n');
assert(results.length===6&&results.every(r=>r.pass),
  'Independent WSJT-X WAV golden acceptance failed; inspect JSON artifact');
