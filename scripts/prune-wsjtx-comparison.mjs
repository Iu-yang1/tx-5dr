#!/usr/bin/env node
/**
 * Strip explicit development-only WSJT-X comparison entrypoints from an
 * assembled production root. Never mutate the source or the build output:
 * packaging works on a copied staging filesystem.
 *
 * The runtime selection in codec-backend.ts rejects wsjtx-lib for production;
 * removing these modules also makes an accidental test-mode configuration
 * fail closed rather than silently reintroduce the old binary codec.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2);
assert(args.length===1,'Usage: prune-wsjtx-comparison.mjs <staged-app-root>');
const root=path.resolve(args[0]);
const dir=path.join(root,'packages','server','dist','decode');
assert(fs.statSync(dir).isDirectory(),'Packaged server decode directory missing: '+dir);
const modules=['WSJTXDecodeWorkerCore','WSJTXEncodeComparisonBackend'];
let removed=0;
for(const name of modules){
  // TypeScript compile configurations may or may not produce source maps.
  for(const suffix of ['.js','.js.map','.d.ts','.d.ts.map']){
    const file=path.join(dir,name+suffix);
    if(fs.existsSync(file)){fs.unlinkSync(file);removed++;}
  }
  assert(!fs.existsSync(path.join(dir,name+'.js')),
    'Forbidden comparison runtime remains: '+name);
}
console.log(JSON.stringify({audit:'strip-comparison-only-wsjtx',root,
  compiledModules:modules,removedFiles:removed}));
