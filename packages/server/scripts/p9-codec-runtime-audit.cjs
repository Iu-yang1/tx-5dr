// P9 runtime migration audit: prove production selection no longer imports
// wsjtx-lib eagerly and the pinned Rust Node-API module is loadable.
// This checks dependency/ABI identity, not BER, QSO or RF performance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root=path.resolve(__dirname,'..','..','..');
const service=JSON.parse(fs.readFileSync(path.join(root,'packages/server/package.json'),'utf8'));
assert.equal(service.dependencies['wsjtx-lib'],undefined,
  'legacy wsjtx-lib is still a production dependency');
assert.equal(service.devDependencies['wsjtx-lib'],'2.2.0',
  'legacy library should remain only as a versioned test baseline');

const addon=path.join(root,'packages/mfsk-native/mfsk-native.node');
assert(fs.statSync(addon).size>10_000,'native addon missing or suspiciously small');
const native=require(addon);
assert.match(native.codecVersion(),/^mfsk-core\/0\.15\.0;/);
for(const mode of ['FT8','FT4','WSPR','Q65-60B','MSK144','JTTY']){
  assert(native.supportedModes().includes(mode),`native mode absent: ${mode}`);
}

for(const relative of [
  'packages/server/dist/decode/decode-worker-entry.js',
  'packages/server/dist/decode/WSJTXEncodeWorkQueue.js',
]){
  const compiled=fs.readFileSync(path.join(root,relative),'utf8');
  assert(!/^\s*import\s+.*?from\s+['"]wsjtx-lib['"]/m.test(compiled),
    `legacy static import still exists in ${relative}`);
}
(async()=>{
  const selection=await import(pathToFileURL(
    path.join(root,'packages/server/dist/decode/codec-backend.js')).href);
  assert.equal(selection.resolveCodecBackend(undefined,'production'),'mfsk-native');
  assert.equal(selection.resolveCodecBackend(undefined,'development'),'mfsk-native');
  assert.throws(()=>selection.resolveCodecBackend('wsjtx-lib','production'),
    /development and test/);
  assert.equal(selection.resolveCodecBackend('wsjtx-lib','test'),'wsjtx-lib');
  assert.throws(()=>selection.resolveCodecBackend('bogus','production'));
  console.log('P9 Rust default + native ABI + zero eager legacy imports verified.');
})().catch(error=>{console.error(error);process.exitCode=1});
