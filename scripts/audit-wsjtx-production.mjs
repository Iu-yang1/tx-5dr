#!/usr/bin/env node
/**
 * Audit a REAL extracted production filesystem, not the source dependency graph.
 * Exits nonzero for any direct/nested/aliased production wsjtx-lib dependency.
 * Preserve wsjtx-lib as a development-only reference in source workspaces.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const roots=process.argv.slice(2);
assert(roots.length>0,'Usage: node scripts/audit-wsjtx-production.mjs /path/to/packaged/app');
let directories=0,manifests=0,entries=0;
const forbidden=[];
for(const given of roots){
 const root=path.resolve(given);
 assert(fs.statSync(root).isDirectory(),'Packaged directory missing: '+root);
 const stack=[root];
 while(stack.length){
  const directory=stack.pop();
  directories++;
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   entries++;
   const full=path.join(directory,entry.name);
   if(entry.name.toLowerCase()==='wsjtx-lib')forbidden.push(full);
   if(entry.isSymbolicLink()){
     const target=fs.readlinkSync(full);
     if(/(^|[/\\])wsjtx-lib([/\\]|$)/i.test(target))forbidden.push(full+' -> '+target);
     continue; // do not follow symlinks outside the extracted package
   }
   if(entry.isDirectory()){
     stack.push(full);
   }else if(entry.name==='package.json' && entry.isFile()){
     manifests++;
     let manifest;
     try{manifest=JSON.parse(fs.readFileSync(full,'utf8'));}
     catch(error){throw new Error('Invalid packaged package.json '+full+': '+error);}
     if(manifest.name==='wsjtx-lib'
       || Object.hasOwn(manifest.dependencies??{},'wsjtx-lib')
       || Object.hasOwn(manifest.optionalDependencies??{},'wsjtx-lib')){
       forbidden.push(full+' production dependency on wsjtx-lib');
     }
     // devDependencies are intentionally excluded: an uninstalled reference
     // declaration is not evidence of a production runtime dependency.
   }
  }
 }
}
assert.equal(forbidden.length,0,
  'Legacy WSJT-X runtime package found in production tree:\n'+forbidden.join('\n'));
console.log(JSON.stringify({audit:'production-wsjtx-lib-absence',pass:true,
  roots:roots.map(p=>path.resolve(p)),directories,manifests,entries}));
