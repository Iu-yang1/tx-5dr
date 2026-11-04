// Minimal load-and-codec smoke. This proves the native .node is loadable
// on this runner; it does NOT certify production TX, PTT or P3-P9.
const assert = require('node:assert/strict');
const path = require('node:path');
const native = require(path.resolve(__dirname, 'mfsk-native.node'));
const modes = native.supportedModes();
for (const mode of ['FT8', 'FT4', 'WSPR', 'Q65-60B', 'MSK144', 'JTTY']) {
  assert(modes.includes(mode), `native module missing ${mode}`);
}
assert.match(native.codecVersion(), /mfsk-core\/0\.15\.1/);
for (const [mode, message] of [
  ['FT8', 'CQ K1ABC FN42'],
  ['FT4', 'CQ K1ABC FN42'],
  ['WSPR', 'K1ABC FN42 37'],
  ['Q65-60B', 'CQ K1ABC FN42'],
]) {
  const tx = native.encodeSlotted(mode, message, 1500);
  assert.equal(tx.sampleRate, 12000);
  assert(tx.sampleCount > 0);
  assert.equal(tx.pcmF32Le.length, tx.sampleCount * 4);
  console.log(mode, tx.canonicalText, tx.sampleCount, 'samples');
}
const jtty = native.encodeJtty('CQ K1ABC CQ', 1500);
assert(jtty.sampleCount > 0);
console.log('JTTY', jtty.sampleCount, 'samples');
assert.throws(() => native.encodeMsk144Standard('K1ABC','K2ABC','-10',17), /period/);
// Experimental MSK40 is deliberately separate from the general supportedModes
// list until the full legacy short-ping receiver and adaptive equalizer exist.
assert.equal(typeof native.encodeMsk40Shorthand,'function');
assert.equal(typeof native.decodeMsk40KnownCalls,'function');
assert(native.codecVersion().includes('tx5dr-fork/cd0ba5a3eb27'));
const eqSession=new native.Msk144Session(1500,12);
assert.equal(eqSession.equalizerStatus().enabled,false);
eqSession.configureEqualizer(true,'W9XYZ');
assert.equal(eqSession.equalizerStatus().enabled,true);
assert.equal(eqSession.equalizerStatus().trained,false);
eqSession.configureShorthand(true,'K1ABC','W9XYZ');
eqSession.configureEqualizer(false,'');
assert.equal(eqSession.equalizerStatus().enabled,false);
const sh=native.encodeMsk40Shorthand('K1ABC','W9XYZ','RRR',5);
assert.equal(sh.sampleCount,54_000);
assert.equal(native.decodeMsk40KnownCalls(sh.pcmF32Le,'K1ABC','W9XYZ'),'<K1ABC W9XYZ> RRR');
assert.equal(native.decodeMsk40KnownCalls(Buffer.alloc(240*3*4),'K1ABC','W9XYZ'),null);
// Exercise actual streaming MSK40 sync/demod/BP, not just the template matcher.
const burst=Buffer.alloc(7168*4);
for(let i=0;i<1200;i++)burst.writeFloatLE(sh.pcmF32Le.readFloatLE(i*4),(920+i)*4);
const rx=eqSession.push(burst);
assert(rx.some(row=>row.text==='<K1ABC W9XYZ> RRR'),
  'MSK40 native sliding-window receiver did not decode the offset burst');
// Train through the real native streaming RX for multiple 5s periods.
// Do not accept a polynomial trained from arbitrary peak correlation or
// repeated frames within one period as equivalent to independent QSO cycles.
const trainedSession=new native.Msk144Session(1500,40);
trainedSession.configureEqualizer(true,'W9XYZ');
const repeated=native.encodeMsk144Standard('K1ABC','W9XYZ','-10',5);
assert.equal(repeated.sampleRate,12000);
let observed=0;
for(let period=0;period<7;period++){
  trainedSession.newPeriod();
  for(let offset=0;offset<repeated.sampleCount;offset+=4096){
    const end=Math.min(repeated.sampleCount,offset+4096);
    const chunk=repeated.pcmF32Le.subarray(offset*4,end*4);
    observed+=trainedSession.push(chunk).filter(row=>row.text.includes('W9XYZ')).length;
  }
}
const training=trainedSession.equalizerStatus();
assert(observed>=5,'MSK144 native streaming decoder failed to acquire 5 on-air-like periods');
assert(training.trainingFrames>=5,
  'MSK144 trainer never accumulated 5 verified independent frames: '+JSON.stringify(training));
assert(training.trained,
  'MSK144 adaptive phase equalizer never promoted a coherent clean training set: '+JSON.stringify(training));
trainedSession.configureEqualizer(true,'K2ABC');
assert.equal(trainedSession.equalizerStatus().trained,false,
  'Changing DX identity must invalidate prior equalizer coefficients');
trainedSession.reset();
assert.equal(trainedSession.equalizerStatus().enabled,false,
  'Receiver reset must discard adaptive equalizer state');
console.log('Six-mode NAPI load, TX and experimental MSK40 offline loopback passed.');
