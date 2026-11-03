/**
 * One-shot isolated MFSK transmitter encoder.
 * A healthy worker returns PCM; it has no radio, audio output, PTT or logbook.
 */
import { MfskCodecSimulationRequestSchema } from '@tx5dr/contracts';
import { MfskMultimodeRuntime } from './MfskMultimodeRuntime.js';
const timeout=setTimeout(()=>process.exit(124),90_000);
timeout.unref();

process.once('message',(raw:unknown)=>{
  try{
    const input=MfskCodecSimulationRequestSchema.parse(raw);
    const runtime=new MfskMultimodeRuntime();
    const tx=runtime.encodeVirtual({
      mode:input.mode,
      ...(input.mode==='Q65'?{q65Submode:input.q65Submode??'Q65-60B'}:{}),
      audioFrequencyHz:input.audioFrequencyHz,
    },input.text,5);
    const bytes=Buffer.from(tx.pcm.buffer,tx.pcm.byteOffset,tx.pcm.byteLength);
    process.send?.({type:'waveform',data:bytes,sampleRate:tx.sampleRate,
      canonicalText:tx.canonicalText});
  }catch(error){
    process.send?.({type:'error',message:error instanceof Error?error.message:String(error)});
  }
  setTimeout(()=>process.exit(0),10).unref();
});
process.on('disconnect',()=>process.exit(0));
