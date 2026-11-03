const native = require('./mfsk-native.node');
const fs = require('node:fs');
const assert = require('node:assert/strict');

function rand(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) + 0.5) / 4294967296;
  };
}
function slotWithAwgn(wave, slotSeconds, seed) {
  const random = rand(seed);
  const count = 12000 * slotSeconds;
  const slot = Buffer.alloc(count * 4);
  for (let i = 0; i < count; ++i) {
    // Box-Muller Gaussian noise, deterministic for repeatability.
    const u = Math.max(random(), 1e-12), v = random();
    slot.writeFloatLE(0.003 * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), i * 4);
  }
  const waveOffset = 6000; // nominal +0.5 s TX start
  const n = Math.min(wave.sampleCount, count - waveOffset);
  for (let i = 0; i < n; ++i) {
    const sample = slot.readFloatLE((waveOffset + i) * 4) + wave.pcmF32Le.readFloatLE(i * 4) * 0.3;
    slot.writeFloatLE(sample, (waveOffset + i) * 4);
  }
  return slot;
}
const report = [];
for (const [mode, period, text] of [
  ['FT8', 15, 'CQ K1ABC FN42'],
  ['FT4', 7.5, 'CQ K1ABC FN42'],
]) {
  const wave = native.encodeSlotted(mode, text, 1500);
  const pcm = slotWithAwgn(wave, period, 0x5ba5a51);
  const start = performance.now();
  const rows = native.decodeSlotted(mode, pcm);
  report.push({ mode, messages: rows.map(row=>row.text), elapsedMs: Math.round(performance.now() - start), 
    loopbackDecoded: rows.some(row=>row.text.includes('K1ABC')) });
}
fs.writeFileSync('packages/mfsk-native/simulation-report.json', JSON.stringify({
  note:'Exploratory offline AWGN, not P3-P9 acceptance. Do not substitute for reference WAV vector tests.',
  report,
}, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (process.env.ENFORCE_MFSK_LOOPBACK === '1') {
  assert(report.every(row => row.loopbackDecoded), 'one or more loopback decodes failed');
}
