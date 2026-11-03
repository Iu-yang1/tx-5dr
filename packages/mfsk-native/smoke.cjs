// Minimal load-and-codec smoke. This proves the native .node is loadable
// on this runner; it does NOT certify production TX, PTT or P3-P9.
const assert = require('node:assert/strict');
const path = require('node:path');
const native = require(path.resolve(__dirname, 'mfsk-native.node'));
const modes = native.supportedModes();
for (const mode of ['FT8', 'FT4', 'WSPR', 'Q65-60B', 'MSK144', 'JTTY']) {
  assert(modes.includes(mode), `native module missing ${mode}`);
}
assert.match(native.codecVersion(), /mfsk-core\/0\.15\.0/);
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
console.log('Six-mode NAPI load and TX smoke passed (not a production acceptance).');
