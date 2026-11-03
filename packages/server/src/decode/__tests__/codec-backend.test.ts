import {describe,it,expect} from 'vitest';
import {resolveCodecBackend} from '../codec-backend.js';

describe('production default Rust codec migration',()=>{
  it('defaults to mfsk-native in production and development',()=>{
    expect(resolveCodecBackend(undefined,'production')).toBe('mfsk-native');
    expect(resolveCodecBackend(undefined,'development')).toBe('mfsk-native');
    expect(resolveCodecBackend(undefined,undefined)).toBe('mfsk-native');
  });
  it('keeps deterministic legacy comparison tests available without shipping it as primary',()=>{
    expect(resolveCodecBackend(undefined,'test')).toBe('wsjtx-lib');
    expect(resolveCodecBackend('mfsk-native','test')).toBe('mfsk-native');
    expect(resolveCodecBackend('wsjtx-lib','production')).toBe('wsjtx-lib');
  });
  it('rejects unknown backend values; there is no automatic fallback',()=>{
    expect(()=>resolveCodecBackend('invalid','production')).toThrow(/Unknown/);
  });
});
