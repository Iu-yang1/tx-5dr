import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_DEFINITION_MAP,
  isCapabilityTemporarilyDisabled,
} from '../capabilities/definitions.js';

describe('operator-authorized capabilities', () => {
  it('exposes the TX audio input route without a global model-independent ban', () => {
    const definition = CAPABILITY_DEFINITION_MAP.get('tx_audio_input_source');

    expect(isCapabilityTemporarilyDisabled('tx_audio_input_source')).toBe(false);
    expect(definition).toBeDefined();
    expect(definition!.descriptor.readable).toBe(true);
    expect(definition!.descriptor.writable).toBe(true);
    expect(definition!.descriptor.options?.length).toBeGreaterThan(0);
    expect(definition!.read).toBeTypeOf('function');
    expect(definition!.write).toBeTypeOf('function');
  });

  it('requires the connected backend to advertise a route before enabling it', async () => {
    const definition = CAPABILITY_DEFINITION_MAP.get('tx_audio_input_source')!;
    const unsupported = {
      getSupportedTxAudioInputSources: async () => [],
      getTxAudioInputSource: async () => null,
      setTxAudioInputSource: async () => undefined,
    };
    await expect(definition.probeSupport(unsupported as never)).resolves.toMatchObject({
      supported: false,
      source: 'backend-declared',
    });
  });
});
