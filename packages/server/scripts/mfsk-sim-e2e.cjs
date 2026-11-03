// Exercise the exact TypeScript runtime that the About page POST executes.
// No actual radios, logbooks, TX leases or audio devices are required.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const worker = path.resolve(__dirname,'../dist/decode/mfsk-sim-worker.js');
const cases=[
  ['FT8','CQ K1ABC FN42'],
  ['FT4','CQ K1ABC FN42'],
  ['Q65','CQ K1ABC FN42','Q65-60B'],
  ['WSPR','K1ABC FN42 37'],
  ['MSK144','K1ABC K2ABC -10'],
  ['JTTY','CQ K1ABC'],
];
const evidence=[];
function call(payload) {
  const result=spawnSync(process.execPath,[worker,JSON.stringify(payload)],{
    encoding:'utf8',maxBuffer:1024*1024,timeout:120_000,
  });
  return result;
}
for(const [mode,text,q65Submode] of cases) {
  const p={mode,text,audioFrequencyHz:1500,noiseAmplitude:0.002,
    ...(q65Submode ? {q65Submode}: {})};
  const result=call(p);
  if(result.status!==0){
    evidence.push({mode,ok:false,error:(result.stderr||result.stdout).slice(0,1000)});
    continue;
  }
  try{
    const output=JSON.parse(result.stdout);
    const ok=output.simulationOnly===true && output.physicalTxEnabled===false
      && output.messageRecovered===true && output.mode===mode
      && output.sampleRate===12000 && output.samples>0;
    evidence.push({mode,ok,canonicalText:output.canonicalText,
      receivedTexts:output.receivedTexts,decodeMs:output.decodeMs});
  }catch(e){evidence.push({mode,ok:false,error:String(e),stdout:result.stdout.slice(0,500)})}
}
for(const malicious of [
  {mode:'FT8',text:'CQ K1ABC FN42',q65Submode:'Q65-60B'},
  {mode:'MSK144',text:'CQ K1ABC FN42',audioFrequencyHz:100000},
]){
  const result=call(malicious);
  evidence.push({name:'invalid-input',ok:result.status!==0});
}
console.log(JSON.stringify(evidence,null,2));
assert(evidence.every(x=>x.ok),'Full app-native six-mode simulation failed');
