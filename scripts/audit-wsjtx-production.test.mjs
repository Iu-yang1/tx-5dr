import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'tx5dr-legacy-package-audit-'));
const compiledDir=path.join(root,'packages','server','dist');
const nodeModules=path.join(root,'node_modules');
const packageJson=path.join(root,'package.json');
const compiledJs=path.join(compiledDir,'index.js');
const audit=path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  'audit-wsjtx-production.mjs');
fs.mkdirSync(compiledDir,{recursive:true});
fs.mkdirSync(nodeModules,{recursive:true});
after(()=>fs.rmSync(root,{recursive:true,force:true}));

function check(){
 return spawnSync(process.execPath,[audit,root],{encoding:'utf8',timeout:15000});
}
function updateManifest(fields={}){
 fs.writeFileSync(packageJson,JSON.stringify({
  name:'tx5dr-compiled-fixture',version:'1.0.0',...fields
 }));
}
function reset(){
 updateManifest();
 fs.writeFileSync(compiledJs,'module.exports={ready:true};');
 fs.rmSync(path.join(nodeModules,'wsjtx-lib'),{recursive:true,force:true});
 fs.rmSync(path.join(nodeModules,'alternate-legacy'),{recursive:true,force:true});
}
test('clean production fixture with optional dev-only wsjtx-lib declaration passes',()=>{
 reset();
 updateManifest({devDependencies:{'wsjtx-lib':'^2.2.0'}});
 const result=check();
 assert.equal(result.status,0,result.stderr);
 assert.equal(JSON.parse(result.stdout).productionModules,1);
});
test('top-level installed wsjtx-lib package is rejected',()=>{
 reset();
 fs.mkdirSync(path.join(nodeModules,'wsjtx-lib'));
 const result=check();
 assert.equal(result.status,1,'Installed production module must fail');
 assert.match(result.stderr,/wsjtx-lib/);
});
test('aliased nested package named wsjtx-lib is rejected',()=>{
 reset();
 const dir=path.join(nodeModules,'alternate-legacy');
 fs.mkdirSync(dir);
 fs.writeFileSync(path.join(dir,'package.json'),
  JSON.stringify({name:'wsjtx-lib',version:'2.2.0'}));
 const result=check();
 assert.equal(result.status,1,'Renamed installed dependency must fail');
 assert.match(result.stderr,/production dependency on wsjtx-lib/);
});
test('compiled server CommonJS dynamic require is rejected even with no installed package',()=>{
 reset();
 fs.writeFileSync(compiledJs,'const ref=require("wsjtx-lib");');
 const result=check();
 assert.equal(result.status,1,'Compiled legacy imports must fail');
 assert.match(result.stderr,/compiled production import/);
});
test('compiled server ESM import is rejected even with no installed package',()=>{
 reset();
 fs.writeFileSync(compiledJs,'const ref=import("wsjtx-lib");');
 const result=check();
 assert.equal(result.status,1,'Runtime dynamic import must fail');
});
test('production optional dependency on wsjtx-lib is rejected',()=>{
 reset();
 updateManifest({optionalDependencies:{'wsjtx-lib':'^2.2.0'}});
 const result=check();
 assert.equal(result.status,1);
});
test('unrelated production code mentioning wsjtx-lib in a string is allowed',()=>{
 reset();
 fs.writeFileSync(compiledJs,'const warning = "Do not install wsjtx-lib in production";');
 const result=check();
 assert.equal(result.status,0,result.stderr);
});
