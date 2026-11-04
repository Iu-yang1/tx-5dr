/**
 * Reproducible two-path Gaussian scatter / linear Doppler HF test channel.
 *
 * Approximation of ITU-R F.1487's simplified Watterson two-path model:
 *  - independent proper complex Gaussian fading per path
 *  - paths have delays 0 and 2 ms and equal average powers
 *  - each path's Doppler spectrum is Gaussian, with 2*sigma = spreadHz
 *  - optional deterministic chirp frequency drift
 *
 * Fading uses a finite sum of 96 random Doppler sinusoids per path and
 * interpolation between 400 Hz envelope samples. Analytic audio uses a
 * windowed 63-tap FIR Hilbert approximation (phase-aware, not magnitude-only).
 * This is a reproducible software approximation, not a calibrated ITU test rig.
 */
'use strict';
const Fs=12_000,EnvelopeRate=400,STEP=Fs/EnvelopeRate;
function uniform(seed){
 let s=seed>>>0;
 return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return ((s>>>0)+0.5)/4294967296;};
}
function normal(rng){
 return Math.sqrt(-2*Math.log(Math.max(1e-12,rng())))*
   Math.cos(2*Math.PI*rng());
}
function gaussianGain(length,spreadHz,seed){
 const rng=uniform(seed),sigma=spreadHz/2,tones=[];
 const count=96;
 for(let i=0;i<count;i++)tones.push([sigma*normal(rng),2*Math.PI*rng()]);
 const samples=Math.ceil(length/STEP)+2;
 const re=new Float32Array(samples),im=new Float32Array(samples);
 for(let i=0;i<samples;i++){
  const t=i/EnvelopeRate;let a=0,b=0;
  for(const [f,p] of tones){
    const ph=2*Math.PI*f*t+p;a+=Math.cos(ph);b+=Math.sin(ph);
  }
  re[i]=a/Math.sqrt(count);im[i]=b/Math.sqrt(count);
 }
 return {re,im};
}
function analyticQuadrature(input){
 const n=input.length,output=new Float32Array(n),radius=31,taps=[];
 for(let k=-radius;k<=radius;k++){
   if(k===0 || k%2===0)continue;
   const w=.42+.5*Math.cos(Math.PI*k/radius)+.08*Math.cos(2*Math.PI*k/radius);
   taps.push([k,2*w/(Math.PI*k)]);
 }
 for(let i=0;i<n;i++){
   let sum=0;
   for(const [k,coef] of taps){
     const j=i-k;if(j>=0&&j<n)sum+=coef*input[j];
   }
   output[i]=sum;
 }
 return output;
}
function interpolate(gain,index){
 const x=index/STEP,j=Math.floor(x),t=x-j;
 return [gain.re[j]*(1-t)+gain.re[j+1]*t,
   gain.im[j]*(1-t)+gain.im[j+1]*t];
}
function wattersonApprox(input,options={}){
 if(!(input instanceof Float32Array)||input.length<1||input.length>Fs*310)
   throw new RangeError('Expected nonempty 12 kHz Float32Array up to 310 seconds');
 if(input.some(x=>!Number.isFinite(x)))throw new TypeError('Non-finite channel PCM');
 const spreadHz=options.spreadHz??1;
 const chirpRate=options.dopplerRateHzPerSec??0;
 const delayMs=options.delayMs??2;
 const seed=options.seed??0x1357af;
 if(!Number.isFinite(spreadHz)||spreadHz<=0||spreadHz>30)
   throw new RangeError('Two-sigma Doppler spread must lie in (0, 30] Hz');
 if(!Number.isFinite(chirpRate)||Math.abs(chirpRate)>20)
   throw new RangeError('Doppler drift must not exceed 20 Hz/s');
 if(!Number.isFinite(delayMs)||delayMs<0||delayMs>20)
   throw new RangeError('Delay must lie in [0,20] ms');
 if(!Number.isSafeInteger(seed))throw new RangeError('Invalid random seed');
 const quadrature=analyticQuadrature(input);
 const a=gaussianGain(input.length,spreadHz,seed^0x72a351);
 const b=gaussianGain(input.length,spreadHz,seed^0x5ba129);
 const delay=Math.round(Fs*delayMs/1000);
 const output=new Float32Array(input.length);
 for(let i=0;i<output.length;i++){
  const j=i-delay;
  const [ar,ai]=interpolate(a,i),[br,bi]=interpolate(b,i);
  const xr=input[i],xi=quadrature[i];
  const yr=j>=0?input[j]:0,yi=j>=0?quadrature[j]:0;
  const real=(ar*xr-ai*xi+br*yr-bi*yi)/Math.SQRT2;
  const imag=(ar*xi+ai*xr+br*yi+bi*yr)/Math.SQRT2;
  const time=i/Fs,phase=Math.PI*chirpRate*time*time;
  output[i]=real*Math.cos(phase)-imag*Math.sin(phase);
 }
 return output;
}
/**
 * Ideal feed-forward Doppler tracking for controlled channel comparisons.
 *
 * If the channel's deterministic frequency rate is known a priori (for
 * example from an ephemeris), remove exp(+j*pi*rate*t^2) from its analytic
 * audio without altering the stochastic Watterson fading spectrum.
 * This does NOT estimate Doppler or prove real receiver acquisition.
 * Hilbert conversion is finite-tap and introduces documented approximation.
 */
function derampKnownDoppler(input,rateHzPerSecond){
 if(!(input instanceof Float32Array)||input.length<1||input.length>Fs*310)
  throw new RangeError('Expected 12 kHz float PCM');
 if(!Number.isFinite(rateHzPerSecond)||Math.abs(rateHzPerSecond)>20)
  throw new RangeError('Known Doppler rate exceeds supported range');
 if(rateHzPerSecond===0)return input.slice();
 const q=analyticQuadrature(input),out=new Float32Array(input.length);
 for(let i=0;i<input.length;i++){
  const t=i/Fs,p=Math.PI*rateHzPerSecond*t*t;
  // Re[(I+jQ) exp(-j*p)] = I*cos(p)+Q*sin(p).
  out[i]=input[i]*Math.cos(p)+q[i]*Math.sin(p);
 }
 return out;
}
module.exports={wattersonApprox,analyticQuadrature,derampKnownDoppler};
