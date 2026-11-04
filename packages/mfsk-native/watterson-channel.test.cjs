'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {derampKnownDoppler}=require('./watterson-channel.cjs');
test('known rate removes deterministic FM chirp without hiding Watterson fading',()=>{
 const fs=12000,rate=20,n=fs*8,source=new Float32Array(n),chirp=new Float32Array(n);
 for(let k=0;k<n;k++){
  const t=k/fs;
  source[k]=Math.cos(2*Math.PI*1500*t);
  chirp[k]=Math.cos(2*Math.PI*1500*t+Math.PI*rate*t*t);
 }
 const recovered=derampKnownDoppler(chirp,rate);
 let signalPower=0,errorPower=0;
 for(let i=100;i<n-100;i++){
  signalPower+=source[i]*source[i];
  errorPower+=(recovered[i]-source[i])**2;
 }
 const rms=Math.sqrt(errorPower/signalPower);
 assert(rms<0.025,'known-rate residual RMS relative to stable carrier: '+rms);
});
test('zero rate is a transparent copy and invalid rates are rejected',()=>{
 const samples=Float32Array.of(0.2,-0.1,0.4);
 const output=derampKnownDoppler(samples,0);
 assert.deepEqual([...output],[...samples]);
 assert.notStrictEqual(output,samples);
 assert.throws(()=>derampKnownDoppler(samples,30),/supported/);
});
