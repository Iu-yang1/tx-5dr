#!/usr/bin/env node
/**
 * Rigorous FT8/FT4 Watterson+linear Doppler 50% sensitivity acceptance.
 *
 * A preliminary 20-pair broad-SNR survey selects a ONE-dB measurement
 * window which brackets BOTH Rust and independent WSJT-X crossings.
 * The final survey runs >=80 paired realizations per SNR (same noise/fade
 * across both decoders and all SNR points), with joint paired bootstrap.
 * Null crossings, insufficient bootstrap coverage, excessive degradation,
 * non-finite statistics, and unsupported channel settings all FAIL CLOSED.
 *
 * This is an offline deterministic approximation of Watterson, not an
 * ITU F.1487 calibrated fading-channel instrument.
 */
'use strict';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

const mode=process.env.MFSK_MODE;
const spread=Number(process.env.MFSK_SPREAD_HZ);
const rate=Number(process.env.MFSK_DOPPLER_RATE);
assert(['FT8','FT4'].includes(mode),'MFSK_MODE must be FT8 or FT4');
assert([1,10,30].includes(spread),'Spread must be one of 1,10,30 Hz');
assert([0,10,20].includes(rate),'Rate must be one of 0,10,20 Hz/s');
const refPath=path.join(__dirname,'reference-threshold-monte-carlo.cjs');
const reportPath=path.join(__dirname,
  'reference-threshold-'+mode.toLowerCase()+'-watterson-'+spread+'hz-'+rate+'hzps.json');
const baseEnv={
  ...process.env,MFSK_MODE:mode,MFSK_CHANNEL:'watterson',
  MFSK_SPREAD_HZ:String(spread),MFSK_DOPPLER_RATE:String(rate),
};
function run({trials,grid,enforce}){
  execFileSync(process.execPath,[refPath],{
    env:{...baseEnv,MFSK_TRIALS:String(trials),
      MFSK_SNR_POINTS:grid.join(','),MFSK_ENFORCE_THRESHOLD:enforce?'1':'0'},
    stdio:'inherit',
    timeout:110*60*1000,
  });
  const record=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  assert.equal(record.protocol,mode);
  assert.equal(record.channelModel,'watterson');
  assert.deepEqual(record.snrPoints,grid);
  assert(record.rows.every(row=>row.trialCount===trials));
  return record;
}
const pilotGrid=[-35,-30,-25,-20,-15,-10,-5,0,5,10,15,20];
const pilot=run({trials:20,grid:pilotGrid,enforce:false});
fs.copyFileSync(reportPath,reportPath.replace(/\.json$/, '-pilot.json'));
assert(pilot.rust50 && pilot.reference50,
  'INCONCLUSIVE: pilot did not bracket BOTH 50% thresholds; no P9 acceptance');
const endpoints=[...pilot.rust50.bracket,...pilot.reference50.bracket];
const lo=Math.max(-40,Math.floor(Math.min(...endpoints))-3);
const hi=Math.min(20,Math.ceil(Math.max(...endpoints))+3);
assert(hi>lo && hi-lo<=28,
  'INCONCLUSIVE: Rust/reference crossings are too far apart or outside allowed SNR sweep');
const strictGrid=Array.from({length:hi-lo+1},(_,k)=>lo+k);
console.log(JSON.stringify({mode,channel:'watterson',spreadHz:spread,dopplerRate:rate,
  pilotRust50:pilot.rust50,pilotReference50:pilot.reference50,
  strictGrid,pairedTrialsPerSnr:80}));
const strict=run({trials:80,grid:strictGrid,enforce:true});
assert.equal(strict.underHalfDbTarget,true,
  'Strict 95% upper-bound degradation gate did not pass');
assert(strict.pairedDelta95.valid>=.95*strict.pairedDelta95.replicates);
console.log(JSON.stringify({mode,spreadHz:spread,dopplerRate:rate,
  rust50:strict.rust50,reference50:strict.reference50,
  degradationDb:strict.rustDegradationDb,paired95:strict.pairedDelta95,
  accepted:true}));
