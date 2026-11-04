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
assert(native.codecVersion().includes('tx5dr-fork/ff302c4f30ce'));
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
console.log('Six-mode NAPI load, TX and experimental MSK40 offline loopback passed.');
