import { describe, expect, it, vi } from 'vitest';
import type { DigitalMessagePreflightRequest } from '@tx5dr/plugin-api';
import {
  type MfskNativeModule, type MfskNativeWaveform,
} from '../MfskNativeAdapter.js';
import { DigitalMessagePreflightService } from '../DigitalMessagePreflightService.js';

const sampleWaveform = (): MfskNativeWaveform => {
  const pcmF32Le = Buffer.alloc(8);
  pcmF32Le.writeFloatLE(0.125, 0);
  pcmF32Le.writeFloatLE(-0.125, 4);
  return {
    canonicalText: 'CQ K1ABC FN42',
    sampleRate: 12000,
    sampleCount: 2,
    pcmF32Le,
  };
};
const request = (text:string, mode:'FT8'|'FT4'='FT8') =>
  ({text,mode} as DigitalMessagePreflightRequest);

describe('production FT8/FT4 message preflight without wsjtx-lib', () => {
  it('does not load the codec for empty requests',async () => {
    const load = vi.fn(() => ({ready:false as const,reason:'must not be called'}));
    const service = new DigitalMessagePreflightService(load);
    await expect(service.check(request('  '))).resolves.toMatchObject({
      encodable:false,requestedText:'',reason:'empty',
    });
    expect(load).not.toHaveBeenCalled();
  });

  it.each(['FT8','FT4'] as const)('validates %s with native canonical text and PCM',async mode => {
    const encode = vi.fn(() => sampleWaveform());
    const service = new DigitalMessagePreflightService(() => ({
      ready:true, module:{encodeSlotted:encode} as unknown as MfskNativeModule,
      version:'mfsk-core/0.15.0; tx5dr-napi/0.1.0',nativeModes:['FT8','FT4'],
    }));
    const result=await service.check(request('cq  k1abc fn42',mode));
    expect(result).toEqual({
      encodable:true,requestedText:'CQ K1ABC FN42',transmittedText:'CQ K1ABC FN42',
    });
    expect(encode).toHaveBeenCalledWith(mode,'CQ K1ABC FN42',1500);
  });

  it('rejects a changed / shortened RF message before any transmission',async () => {
    const encode=vi.fn(()=>({...sampleWaveform(),canonicalText:'CQ K1ABC'}));
    const service=new DigitalMessagePreflightService(()=>({
      ready:true,module:{encodeSlotted:encode} as unknown as MfskNativeModule,
      version:'test',nativeModes:['FT8','FT4'],
    }));
    await expect(service.check(request('CQ K1ABC FN42'))).resolves.toMatchObject({
      encodable:false,reason:'encoder_changed_text',transmittedText:'CQ K1ABC',
    });
  });

  it('fails closed for an unavailable packaged addon or invalid native samples',async()=>{
    const missing=new DigitalMessagePreflightService(()=>({
      ready:false,reason:'native addon unavailable in production package',
    }));
    await expect(missing.check(request('CQ K1ABC FN42'))).resolves.toMatchObject({
      encodable:false,reason:'encode_failed',error:'native addon unavailable in production package',
    });

    const wave=sampleWaveform();
    wave.pcmF32Le.writeFloatLE(Number.NaN,4);
    const bad=new DigitalMessagePreflightService(()=>({
      ready:true,module:{
        encodeSlotted:()=>wave,
      } as unknown as MfskNativeModule,
      version:'test',nativeModes:['FT8','FT4'],
    }));
    await expect(bad.check(request('CQ K1ABC FN42'))).resolves.toMatchObject({
      encodable:false,reason:'encode_failed',error:expect.stringMatching(/invalid sample/),
    });
  });
});
