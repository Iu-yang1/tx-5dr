#!/usr/bin/env node
/**
 * Fail-closed P9 reference interoperability evidence ledger.
 * A decodable off-air golden WAV proves a receiver, not a WSJT-X reference
 * transmitter or a Rust-TX-to-reference-RX pair. The legacy wsjtx-lib
 * supports FT8/FT4 bidirectional production-independent oracle tests but
 * cannot be silently treated as a six-mode modern WSJT-X reference.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const here=__dirname;
const read=name=>JSON.parse(fs.readFileSync(path.resolve(here,name),'utf8'));
const protocols=['FT8','FT4','Q65','JTTY','MSK144','WSPR'];
const directions=['reference-TX -> Rust-RX','Rust-TX -> reference-RX'];
const cross=read('reference-crosscodec-report.json');
const golden=read('wsjtx-golden-replay-report.json');
assert(!cross.error,'Reference codec report contains an error');
const known=new Set(
  (cross.results??[]).filter(x=>x.pass===true&&directions.includes(x.direction))
    .map(x=>x.mode+'|'+x.direction));
const goldenLabels={
  FT8:[],
  FT4:['FT4'],
  Q65:['Q65-60A'],
  JTTY:['JTTY WSJT-X rc1 off-air'],
  MSK144:['MSK144 181211_120500.wav','MSK144 181211_120800.wav'],
  WSPR:['WSPR'],
};
const goldenResults=new Map((golden.tests??[]).map(x=>[x.name,x.pass===true]));
const entries=protocols.map(mode=>{
  const required=directions.map(direction=>({
    direction,passed:known.has(mode+'|'+direction),
    evidence:known.has(mode+'|'+direction)
      ? 'wsjtx-lib dev-only reference cross-codec report' : null,
  }));
  const captures=goldenLabels[mode].map(name=>({name,passed:goldenResults.get(name)===true}));
  return {mode,required,captures,
    complete:required.every(x=>x.passed)&&captures.every(x=>x.passed)};
});
const errors=[];
for(const e of entries){
  for(const d of e.required)if(!d.passed)errors.push(e.mode+': '+d.direction);
  for(const c of e.captures)if(!c.passed)errors.push(e.mode+': golden '+c.name);
}
const report={
  codec:cross.codec??null,gate:'complete independent WSJT-X bidirectional interoperability',
  pass:errors.length===0,entries,missing:errors,
  caveats:[
    'FT4/WSPR/Q65/JTTY/MSK144 pinned off-air WAVs are receive-only evidence, not bidirectional references.',
    'Legacy wsjtx-lib does not independently cover every modern TX mode; use real WSJT-X source-built jt9/wsprd/JTTY golden oracles.',
    'MSK40 short ping requires an additional known-call and unknown-call reference validation gate.'
  ],
};
const out=path.resolve(here,'p9-reference-coverage-report.json');
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({path:out,passed:report.pass,missing:errors},null,2));
assert(report.pass,'P9 FAIL: full six-mode WSJT-X reference interoperability has missing evidence');
