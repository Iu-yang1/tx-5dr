const assert=require('node:assert/strict');
const {test}=require('node:test');
const {wattersonApprox,analyticQuadrature}=require('./watterson-channel.cjs');
function signal(){
 const out=new Float32Array(12_000);
 for(let i=0;i<out.length;i++)out[i]=.2*Math.cos(2*Math.PI*1500*i/12_000);
 return out;
}
test('two paths are deterministically reproducible and phase-dependent',()=>{
 const x=signal();
 const opts={spreadHz:10,dopplerRateHzPerSec:10,seed:42,delayMs:2};
 const a=wattersonApprox(x,opts),b=wattersonApprox(x,opts);
 const c=wattersonApprox(x,{...opts,seed:43});
 assert.equal(a.length,x.length);
 assert.deepEqual(a,b);
 assert(a.every(Number.isFinite));
 assert(a.some((s,i)=>Math.abs(s-c[i])>1e-5));
});
test('finite FIR quadrature and invalid channel parameters are rejected',()=>{
 const q=analyticQuadrature(Float32Array.from([0,1,0,-1,0]));
 assert.equal(q.length,5);assert(q.every(Number.isFinite));
 const x=signal();
 for(const p of [{spreadHz:0},{spreadHz:31},{dopplerRateHzPerSec:21},
   {delayMs:-1},{delayMs:25}]) assert.throws(()=>wattersonApprox(x,p));
});
