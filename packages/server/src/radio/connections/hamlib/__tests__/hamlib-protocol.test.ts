import { describe, expect, it } from 'vitest';
import { decodeHamlibResult, deserializeHamlibError, encodeHamlibResult, HamlibCommandSchema, HAMLIB_OPERATIONS, HamlibSpectrumLineSchema, serializeHamlibError } from '../hamlib-protocol.js';
import { RadioError, RadioErrorCode } from '../../../../utils/errors/RadioError.js';

describe('Hamlib protocol', () => {
  it('preserves radio errors and errors nested in a compound operating-state result', () => {
    const error = new RadioError({ code: RadioErrorCode.OPERATION_TIMEOUT, message: 'mode read timed out',
      userMessageKey: 'radio:error.operationTimeout', userMessageParams: { operation: 'mode' },
      suggestions: ['Reconnect'], context: { operation: 'getMode', optional: true } });
    const restored = deserializeHamlibError(serializeHamlibError(error));
    expect(restored).toBeInstanceOf(RadioError);
    expect(restored).toMatchObject({ code: error.code, userMessageKey: error.userMessageKey, userMessageParams: error.userMessageParams, context: error.context, suggestions: error.suggestions });
    const result = decodeHamlibResult('applyOperatingState', encodeHamlibResult('applyOperatingState', { frequencyApplied: true, modeApplied: false, modeError: error }));
    expect(result).toMatchObject({ frequencyApplied: true, modeError: { code: RadioErrorCode.OPERATION_TIMEOUT } });
    expect((result as { modeError: Error }).modeError).toBeInstanceOf(RadioError);
  });

  it('retains correlated Yaesu A/B readback fields across worker IPC', () => {
    const output = decodeHamlibResult('applyOperatingState', encodeHamlibResult('applyOperatingState', {
      frequencyApplied: true, modeApplied: true, targetVfo: 'VFOB',
      frequencyConfirmed: true, observedFrequency: 14074000,
      modeConfirmed: true, observedMode: 'USB',
    }));
    expect(output).toMatchObject({ targetVfo: 'VFOB', observedFrequency: 14074000, observedMode: 'USB' });
    expect(HamlibCommandSchema.safeParse({ type: 'call', generation: 'session', id: 2, operation: 'getVfo', args: [] }).success).toBe(true);
    expect(HamlibCommandSchema.safeParse({ type: 'call', generation: 'session', id: 3, operation: 'setVfo', args: ['VFOB'] }).success).toBe(true);
  });

  it('accepts safe manual-mode and normalized RF gain worker commands', () => {
    const command = (operation: string, args: unknown[]) => ({
      type: 'call', generation: 'test', id: 4, operation, args,
    });
    expect(HamlibCommandSchema.safeParse(command('setManualMode', ['PKTUSB'])).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setManualMode.args.safeParse(['']).success).toBe(false);
    expect(HamlibCommandSchema.safeParse(command('getRFGain', [])).success).toBe(true);
    expect(HamlibCommandSchema.safeParse(command('setRFGain', [0.8])).success).toBe(true);
    expect(HamlibCommandSchema.safeParse(command('getSplitMode', [])).success).toBe(true);
    expect(HamlibCommandSchema.safeParse(command('setSplitMode', ['PKTUSB'])).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setSplitMode.args.safeParse(['']).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setSplitMode.args.safeParse([123]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.getSplitMode.result.safeParse(null).success).toBe(true);
    expect(HAMLIB_OPERATIONS.getSplitMode.result.safeParse('CW').success).toBe(true);
    expect(HamlibCommandSchema.safeParse(command('getApfEnabled', [])).success).toBe(true);
    expect(HamlibCommandSchema.safeParse(command('getRoofingFilter', [])).success).toBe(true);
    expect(HamlibCommandSchema.safeParse(command('getContourLevel', [])).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setRoofingFilter.args.safeParse([1]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setRoofingFilter.args.safeParse([2]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setRoofingFilter.args.safeParse([4]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setRoofingFilter.args.safeParse([5]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setRoofingFilter.args.safeParse([3]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setRoofingFilter.args.safeParse(['500']).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setContourEnabled.args.safeParse([true]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setContourEnabled.args.safeParse([1]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setContourFrequency.args.safeParse([800]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setContourFrequency.args.safeParse([3201]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setContourLevel.args.safeParse([-12]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setContourLevel.args.safeParse([-41]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setContourWidth.args.safeParse([5]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setContourWidth.args.safeParse([0]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setApfEnabled.args.safeParse([true]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setApfEnabled.args.safeParse(['on']).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setManualModeBandwidth.args.safeParse([1800]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setManualModeBandwidth.args.safeParse([0]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setManualModeBandwidth.args.safeParse([30000]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setManualModeBandwidth.args.safeParse(['wide']).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setIFShift.args.safeParse([-1200]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setIFShift.args.safeParse([1500]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setCwPitch.args.safeParse([650]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setCwPitch.args.safeParse([655]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setKeySpeed.args.safeParse([20]).success).toBe(true);
    expect(HAMLIB_OPERATIONS.setKeySpeed.args.safeParse([49]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setRFGain.args.safeParse([-0.01]).success).toBe(false);
    expect(HAMLIB_OPERATIONS.setRFGain.args.safeParse([1.01]).success).toBe(false);
  });

  it('does not expose private runtime methods through IPC', () => {
    expect(HamlibCommandSchema.safeParse({ type: 'call', generation: 'session', id: 1, operation: 'cleanup', args: [] }).success).toBe(false);
    expect(HamlibCommandSchema.safeParse({ type: 'call', generation: 'session', id: 1, operation: 'convertError', args: [] }).success).toBe(false);
  });

  it('rejects live functions in diagnostic context', () => {
    const error = new RadioError({ code: RadioErrorCode.DEVICE_ERROR, message: 'bad context', context: { callback: () => {} } });
    expect(() => serializeHamlibError(error)).toThrow();
  });

  it('rejects spectrum lengths that exceed the actual buffer', () => {
    expect(HamlibSpectrumLineSchema.safeParse({ scopeId: 0, dataLevelMin: 0, dataLevelMax: 255, signalStrengthMin: -120, signalStrengthMax: 0, mode: 0, centerFreq: 7100000, spanHz: 100000, lowEdgeFreq: 7050000, highEdgeFreq: 7150000, dataLength: 3, data: Buffer.alloc(2), timestamp: 0 }).success).toBe(false);
  });
});
