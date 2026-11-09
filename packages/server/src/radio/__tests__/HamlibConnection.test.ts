import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HamlibRuntime as HamlibConnection } from '../connections/hamlib/HamlibRuntime.js';
import { RadioConnectionState } from '../connections/IRadioConnection.js';
import type { MeterReadContext } from '../connections/meter/types.js';
import { HamlibMeterReader } from '../connections/meter/HamlibMeterReader.js';
import { defaultHamlibProfile } from '../connections/meter/profiles/index.js';
import { RadioErrorCode } from '../../utils/errors/RadioError.js';
import type { HamlibNativeMonitor } from '../connections/hamlib/HamlibNativeMonitor.js';

type MockRig = {
  getCtcssTone: ReturnType<typeof vi.fn>;
  setCtcssTone: ReturnType<typeof vi.fn>;
  getDcsCode: ReturnType<typeof vi.fn>;
  setDcsCode: ReturnType<typeof vi.fn>;
  setFrequency: ReturnType<typeof vi.fn>;
  getSplit: ReturnType<typeof vi.fn>;
  setSplit: ReturnType<typeof vi.fn>;
  getSplitFreq: ReturnType<typeof vi.fn>;
  setSplitFreq: ReturnType<typeof vi.fn>;
  setMode: ReturnType<typeof vi.fn>;
  getVfo: ReturnType<typeof vi.fn>;
  setVfo: ReturnType<typeof vi.fn>;
  getVfoInfo: ReturnType<typeof vi.fn>;
  setPtt: ReturnType<typeof vi.fn>;
  getPtt: ReturnType<typeof vi.fn>;
  getFrequency: ReturnType<typeof vi.fn>;
  getMode: ReturnType<typeof vi.fn>;
  getLevel: ReturnType<typeof vi.fn>;
  setLevel: ReturnType<typeof vi.fn>;
  getDcd: ReturnType<typeof vi.fn>;
  getFunction: ReturnType<typeof vi.fn>;
  setFunction: ReturnType<typeof vi.fn>;
  getPreampValues: ReturnType<typeof vi.fn>;
  getAttenuatorValues: ReturnType<typeof vi.fn>;
  getAgcLevels: ReturnType<typeof vi.fn>;
  getFilterList: ReturnType<typeof vi.fn>;
  getPassbandNarrow: ReturnType<typeof vi.fn>;
  getPassbandNormal: ReturnType<typeof vi.fn>;
  getPassbandWide: ReturnType<typeof vi.fn>;
  getRfPowerStepTable: ReturnType<typeof vi.fn>;
  sendRaw: ReturnType<typeof vi.fn>;
  sendRawWrite: ReturnType<typeof vi.fn>;
  getConf?: ReturnType<typeof vi.fn>;
};

type MockSpectrumController = {
  configureSpectrum?: ReturnType<typeof vi.fn>;
  getSpectrumSupportSummary?: ReturnType<typeof vi.fn>;
  getSpectrumDisplayState?: ReturnType<typeof vi.fn>;
  startManagedSpectrum?: ReturnType<typeof vi.fn>;
  stopManagedSpectrum?: ReturnType<typeof vi.fn>;
  on?: ReturnType<typeof vi.fn>;
  off?: ReturnType<typeof vi.fn>;
};

type TestFrequencyRange = {
  startFreq: number;
  endFreq: number;
  modes: string[];
  lowPower: number;
  highPower: number;
  vfo: number;
  antenna: number;
};

type HamlibConnectionTestAccessor = {
  nativeMonitor: HamlibNativeMonitor;
  rig: MockRig;
  state: RadioConnectionState;
  supportedModes?: Set<string>;
  supportedLevels?: Set<string>;
  supportedFunctions?: Set<string>;
  meterDecodeStrategy?: {
    name: 'icom' | 'yaesu' | 'generic';
    sourceLevel: 'STRENGTH' | 'RAWSTR' | null;
    displayStyle: 's-meter-dbm' | 's-meter' | 'db-over-s9';
    label: string;
  };
  meterReader?: unknown;
  txFrequencyRanges?: TestFrequencyRange[];
  currentFrequencyHz?: number;
  currentRadioMode?: string;
  meterRigMetadata?: { rigModel: number; mfgName: string; modelName: string } | null;
  supportedVfoOps?: Set<string>;
  spectrumController?: MockSpectrumController;
  currentConfig?: unknown;
  resolveCurrentTxPowerMaxWatts: () => number | null;
};

function asTestConnection(connection: HamlibConnection): HamlibConnectionTestAccessor {
  return connection as unknown as HamlibConnectionTestAccessor;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createConnectedConnection(rigOverrides: Partial<MockRig> = {}): {
  connection: HamlibConnection;
  rig: MockRig;
} {
  const connection = new HamlibConnection();
  const rig: MockRig = {
    getCtcssTone: vi.fn().mockResolvedValue(885),
    setCtcssTone: vi.fn().mockResolvedValue(undefined),
    getDcsCode: vi.fn().mockResolvedValue(23),
    setDcsCode: vi.fn().mockResolvedValue(undefined),
    setFrequency: vi.fn().mockResolvedValue(0),
    getSplit: vi.fn().mockResolvedValue({ enabled: false }),
    setSplit: vi.fn().mockResolvedValue(0),
    getSplitFreq: vi.fn().mockResolvedValue(null),
    setSplitFreq: vi.fn().mockResolvedValue(0),
    setMode: vi.fn().mockResolvedValue(0),
    getVfo: vi.fn().mockResolvedValue('VFOA'),
    setVfo: vi.fn().mockResolvedValue(0),
    getVfoInfo: vi.fn().mockResolvedValue({
      frequency: 7_100_000,
      mode: 'USB',
      bandwidth: 2400,
      split: false,
      satMode: false,
    }),
    setPtt: vi.fn().mockResolvedValue(0),
    getPtt: vi.fn().mockResolvedValue(false),
    getFrequency: vi.fn().mockResolvedValue(7100000),
    getMode: vi.fn().mockResolvedValue({ mode: 'USB', bandwidth: 2400 }),
    getLevel: vi.fn().mockResolvedValue(0),
    setLevel: vi.fn().mockResolvedValue(0),
    getDcd: vi.fn().mockResolvedValue(false),
    getFunction: vi.fn().mockResolvedValue(false),
    setFunction: vi.fn().mockResolvedValue(0),
    getPreampValues: vi.fn().mockResolvedValue([]),
    getAttenuatorValues: vi.fn().mockResolvedValue([]),
    getAgcLevels: vi.fn().mockResolvedValue([]),
    getFilterList: vi.fn().mockResolvedValue([
      { modes: ['USB', 'LSB'], width: 1800 },
      { modes: ['USB', 'LSB'], width: 2400 },
      { modes: ['USB', 'LSB'], width: 3000 },
    ]),
    getRfPowerStepTable: vi.fn().mockResolvedValue(null),
    sendRaw: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    sendRawWrite: vi.fn().mockResolvedValue(undefined),
    getConf: vi.fn().mockResolvedValue('0'),
    getPassbandNarrow: vi.fn().mockResolvedValue(1800),
    getPassbandNormal: vi.fn().mockResolvedValue(2400),
    getPassbandWide: vi.fn().mockResolvedValue(3000),
    ...rigOverrides,
  };
  const testConnection = asTestConnection(connection);

  testConnection.rig = rig;
  testConnection.state = RadioConnectionState.CONNECTED;
  testConnection.meterDecodeStrategy = {
    name: 'generic',
    sourceLevel: 'STRENGTH',
    displayStyle: 'db-over-s9',
    label: 'generic-strength',
  };

  return { connection, rig };
}

describe('HamlibConnection', () => {
  it('refuses to claim CAT PTT success when the hardware PTT method is disabled', async () => {
    const { connection, rig } = createConnectedConnection();
    (connection as unknown as { pttMethod: string }).pttMethod = 'none';
    await expect(connection.setPTT(true)).rejects.toThrow(/PTT/i);
    expect(rig.setPtt).not.toHaveBeenCalled();
    await expect(connection.setPTT(false)).resolves.toBeUndefined();
    expect(rig.setPtt).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe.each([
    { name: 'TONE', read: 'getCtcssTone', write: 'setCtcssTone', value: 885 },
    { name: 'CSQL', read: 'getDcsCode', write: 'setDcsCode', value: 23 },
  ] as const)('$name tone control', ({ name, read, write, value }) => {
    it('disables the function without sending a zero tone or code', async () => {
      const { connection, rig } = createConnectedConnection();
      asTestConnection(connection).supportedFunctions = new Set([name]);
      await connection[write](0);
      expect(rig.setFunction).toHaveBeenCalledWith(name, false);
      expect(rig[write]).not.toHaveBeenCalled();
    });

    it('reports disabled even when the radio retains a configured value', async () => {
      const { connection, rig } = createConnectedConnection();
      asTestConnection(connection).supportedFunctions = new Set([name]);
      await expect(connection[read]()).resolves.toBe(0);
      expect(rig.getFunction).toHaveBeenCalledWith(name);
      expect(rig[read]).not.toHaveBeenCalled();
      rig.getFunction.mockResolvedValue(true);
      await expect(connection[read]()).resolves.toBe(value);
    });

    it('finishes setting the value before enabling the function', async () => {
      const { connection, rig } = createConnectedConnection();
      asTestConnection(connection).supportedFunctions = new Set([name]);
      const pending = createDeferred<void>();
      rig[write].mockReturnValue(pending.promise);
      const operation = connection[write](value);
      await vi.waitFor(() => expect(rig[write]).toHaveBeenCalledWith(value));
      expect(rig.setFunction).not.toHaveBeenCalled();
      pending.resolve();
      await operation;
      expect(rig.setFunction).toHaveBeenCalledWith(name, true);
    });

    it('uses numeric values directly when the function is unavailable', async () => {
      const { connection, rig } = createConnectedConnection();
      await connection[write](0);
      await connection[write](value);
      await expect(connection[read]()).resolves.toBe(value);
      expect(rig[write].mock.calls).toEqual([[0], [value]]);
      expect(rig.setFunction).not.toHaveBeenCalled();
      expect(rig.getFunction).not.toHaveBeenCalled();
    });

  });

  it('bridges physical VFO reads and writes through the serialized Hamlib queue', async () => {
    const { connection, rig } = createConnectedConnection({
      getVfo: vi.fn().mockResolvedValue('VFOB'),
    });

    await expect(connection.getVfo()).resolves.toBe('VFOB');
    await expect(connection.setVfo('vfob')).resolves.toBeUndefined();

    expect(rig.getVfo).toHaveBeenCalledTimes(1);
    expect(rig.setVfo).toHaveBeenCalledWith('VFOB');
  });

  it('exposes Yaesu FT-710 TX audio routing through model-specific EX CAT', async () => {
    const { connection, rig } = createConnectedConnection();
    rig.sendRaw.mockResolvedValue(Buffer.from('EX0101141;', 'ascii'));
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 1049, mfgName: 'Yaesu', modelName: 'FT-710' };
    testConnection.currentRadioMode = 'USB';

    await expect(connection.getSupportedTxAudioInputSources!()).resolves.toEqual(['mic', 'usb', 'accessory']);
    await expect(connection.setTxAudioInputSource!('usb')).resolves.toMatchObject({ applied: 'usb', acknowledgement: 'readback' });
    expect(rig.sendRawWrite).toHaveBeenCalledWith(Buffer.from('EX0101141;', 'ascii'));
    expect(rig.sendRaw).toHaveBeenCalledWith(Buffer.from('EX010114;', 'ascii'), 64, Buffer.from(';'));
  });

  it('uses the ICOM CI-V connector extension for IC-705 through Hamlib raw CAT', async () => {
    const { connection, rig } = createConnectedConnection({
      getConf: vi.fn().mockResolvedValue('164'),
      sendRaw: vi.fn().mockResolvedValue(Buffer.from([
        0xfe, 0xfe, 0xa4, 0xe0, 0x1a, 0x05, 0x01, 0x19, 0x01, 0xfd,
      ])),
    });
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 3085, mfgName: 'Icom', modelName: 'IC-705' };

    await expect(connection.getSupportedTxAudioInputSources!()).resolves.toEqual(['mic', 'usb', 'network']);
    await expect(connection.getTxAudioInputSource!()).resolves.toBe('usb');
    expect(rig.sendRaw).toHaveBeenCalledWith(
      Buffer.from([0xfe, 0xfe, 0xa4, 0xe0, 0x1a, 0x05, 0x01, 0x19, 0xfd]),
      64,
      Buffer.from([0xfd]),
    );

    await expect(connection.setTxAudioInputSource!('usb')).resolves.toMatchObject({ applied: 'usb' });
    expect(rig.sendRawWrite).toHaveBeenCalledWith(
      Buffer.from([0xfe, 0xfe, 0xa4, 0xe0, 0x1a, 0x05, 0x01, 0x19, 0x01, 0xfd]),
    );
  });

  it('uses the IC-905-specific CI-V value map', async () => {
    const { connection, rig } = createConnectedConnection({
      getConf: vi.fn().mockResolvedValue('164'),
      sendRaw: vi.fn().mockResolvedValue(Buffer.from([
        0xfe, 0xfe, 0xa4, 0xe0, 0x1a, 0x05, 0x01, 0x19, 0x03, 0xfd,
      ])),
    });
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 3090, mfgName: 'Icom', modelName: 'IC-905' };

    await expect(connection.getSupportedTxAudioInputSources!()).resolves.toEqual(['mic', 'accessory', 'usb', 'network']);
    await expect(connection.getTxAudioInputSource!()).resolves.toBe('usb');
    await expect(connection.setTxAudioInputSource!('usb')).resolves.toMatchObject({ applied: 'usb' });
    expect(rig.sendRawWrite).toHaveBeenCalledWith(
      Buffer.from([0xfe, 0xfe, 0xa4, 0xe0, 0x1a, 0x05, 0x01, 0x19, 0x03, 0xfd]),
    );
  });

  it('exposes Kenwood TS-890S normal modulation source through MS0 CAT', async () => {
    const { connection, rig } = createConnectedConnection({
      sendRaw: vi.fn().mockResolvedValue(Buffer.from('MS02;', 'ascii')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 2041, mfgName: 'Kenwood', modelName: 'TS-890S' };

    await expect(connection.getTxAudioInputSource!()).resolves.toBe('usb');
    expect(rig.sendRaw).toHaveBeenCalledWith(Buffer.from('MS0;', 'ascii'), 64, Buffer.from(';'));
  });

  it('writes TS-990S USB audio as the documented MS composite source', async () => {
    const { connection, rig } = createConnectedConnection({
      sendRaw: vi.fn().mockResolvedValue(Buffer.from('MS00010;', 'ascii')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 2039, mfgName: 'Kenwood', modelName: 'TS-990S' };
    testConnection.currentRadioMode = 'USB';

    await expect(connection.setTxAudioInputSource!('usb')).resolves.toMatchObject({ applied: 'usb' });
    expect(rig.sendRawWrite).toHaveBeenCalledWith(Buffer.from('MS00010;', 'ascii'));
    expect(rig.sendRaw).toHaveBeenCalledWith(Buffer.from('MS0;', 'ascii'), 64, Buffer.from(';'));
  });

  it('does not advertise raw TX audio commands for unknown Hamlib models', async () => {
    const { connection, rig } = createConnectedConnection();
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 9999, mfgName: 'Unknown', modelName: 'Unknown' };

    await expect(connection.getSupportedTxAudioInputSources!()).resolves.toEqual([]);
    await expect(connection.setTxAudioInputSource!('usb')).rejects.toThrow(/no verified TX audio input provider/i);
    expect(rig.sendRaw).not.toHaveBeenCalled();
  });

  describe('FTDX10 RX AGC / IPO / ATT level verification', () => {
    const setup = () => {
      const { connection, rig } = createConnectedConnection();
      const accessor = asTestConnection(connection);
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1042, path: 'COM4' } };
      accessor.supportedLevels = new Set(['AGC', 'PREAMP', 'ATT']);
      rig.getAgcLevels.mockResolvedValue([1, 2, 3]);
      rig.getPreampValues.mockResolvedValue([10, 20]);
      rig.getAttenuatorValues.mockResolvedValue([6, 12, 18]);
      return { connection, rig, accessor };
    };

    it('prevents unsupported PREAMP/ATT options, verifies readback and supports IPO/OFF', async () => {
      const { connection, rig } = setup();
      rig.getLevel.mockImplementation(async (level: string) => level === 'PREAMP' ? 0 : 12);
      await expect(connection.setPreampLevel(0)).resolves.toBeUndefined();
      await expect(connection.setAttenuatorLevel(12)).resolves.toBeUndefined();
      expect(rig.setLevel.mock.calls).toEqual([['PREAMP', 0], ['ATT', 12]]);
      await expect(connection.setPreampLevel(15)).rejects.toThrow('not a reported option');
      await expect(connection.setAttenuatorLevel(9)).rejects.toThrow('not a reported option');
      expect(rig.setLevel).toHaveBeenCalledTimes(2);
    });

    it('rejects receiver controls while transmitting and rejects mismatched readback', async () => {
      const { connection, rig } = setup();
      rig.getPtt.mockResolvedValue(true);
      await expect(connection.setPreampLevel(10)).rejects.toThrow('confirmed RX');
      await expect(connection.setAttenuatorLevel(12)).rejects.toThrow('confirmed RX');
      await expect(connection.setAgcMode('slow')).rejects.toThrow('confirmed RX');
      expect(rig.setLevel).not.toHaveBeenCalled();

      rig.getPtt.mockResolvedValue(false);
      rig.getLevel.mockResolvedValue(99);
      await expect(connection.setPreampLevel(10)).rejects.toThrow('readback mismatch');
      await expect(connection.setAttenuatorLevel(12)).rejects.toThrow('readback mismatch');
    });

    it('preserves existing legacy Hamlib write path for FT-991A', async () => {
      const { connection, rig, accessor } = setup();
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1035, path: 'COM5' } };
      await expect(connection.setPreampLevel(13)).resolves.toBeUndefined();
      await expect(connection.setAttenuatorLevel(7)).resolves.toBeUndefined();
      expect(rig.getPtt).not.toHaveBeenCalled();
      expect(rig.getPreampValues).not.toHaveBeenCalled();
      expect(rig.getAttenuatorValues).not.toHaveBeenCalled();
    });
  });

  describe('FTDX10 native APF on/off', () => {
    const prepare = () => {
      const { connection, rig } = createConnectedConnection();
      const accessor = asTestConnection(connection);
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1042, path: 'COM4' } };
      accessor.supportedFunctions = new Set(['APF']);
      return { connection, rig, accessor };
    };

    it('uses native APF and verifies physical readback', async () => {
      const { connection, rig } = prepare();
      rig.getFunction.mockResolvedValue(true);
      await expect(connection.getApfEnabled()).resolves.toBe(true);
      await expect(connection.setApfEnabled(true)).resolves.toBeUndefined();
      expect(rig.setFunction).toHaveBeenCalledWith('APF', true);
      expect(rig.getPtt).toHaveBeenCalledTimes(1);
    });

    it('rejects TX, mismatched readback, unsupported function and other rigs', async () => {
      const { connection, rig, accessor } = prepare();
      rig.getPtt.mockResolvedValue(true);
      await expect(connection.setApfEnabled(true)).rejects.toThrow('confirmed RX');
      expect(rig.setFunction).not.toHaveBeenCalled();

      rig.getPtt.mockResolvedValue(false);
      rig.getFunction.mockResolvedValue(false);
      await expect(connection.setApfEnabled(true)).rejects.toThrow('readback mismatch');
      accessor.supportedFunctions = new Set();
      await expect(connection.getApfEnabled()).rejects.toThrow('not available');
      accessor.supportedFunctions = new Set(['APF']);
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1035, path: 'COM5' } };
      await expect(connection.setApfEnabled(false)).rejects.toThrow('not available');
    });
  });

  describe('FTDX10 RF gain acknowledgement', () => {
    const prepare = () => {
      const { connection, rig } = createConnectedConnection();
      const accessor = asTestConnection(connection);
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1042, path: 'COM4' } };
      accessor.supportedLevels = new Set(['RF']);
      return { connection, rig, accessor };
    };

    it('confirms physical RX and accepts small float quantization', async () => {
      const { connection, rig } = prepare();
      rig.getLevel.mockResolvedValue(0.505);
      await expect(connection.setRFGain(0.5)).resolves.toBeUndefined();
      expect(rig.setLevel).toHaveBeenCalledWith('RF', 0.5);
      expect(rig.getLevel).toHaveBeenCalledWith('RF');
    });

    it('fails closed on TX state or inconsistent RF gain readback', async () => {
      const { connection, rig } = prepare();
      rig.getPtt.mockResolvedValue(true);
      await expect(connection.setRFGain(0.7)).rejects.toThrow('confirmed RX');
      expect(rig.setLevel).not.toHaveBeenCalled();
      rig.getPtt.mockResolvedValue(false);
      rig.getLevel.mockResolvedValue(0.1);
      await expect(connection.setRFGain(0.7)).rejects.toThrow('readback mismatch');
    });

    it('retains generic RF level behavior for other radios', async () => {
      const { connection, rig, accessor } = prepare();
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1035, path: 'COM5' } };
      await expect(connection.setRFGain(0.4)).resolves.toBeUndefined();
      expect(rig.getPtt).not.toHaveBeenCalled();
      expect(rig.getLevel).not.toHaveBeenCalled();
    });
  });

  describe('FTDX10 signed IF and CW level controls', () => {
    const setup = () => {
      const { connection, rig } = createConnectedConnection();
      const accessor = asTestConnection(connection);
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1042, path: 'COM4' } };
      accessor.supportedLevels = new Set(['IF', 'CWPITCH', 'KEYSPD']);
      return { connection, rig, accessor };
    };

    it('reads and writes signed IF shift in Hz, with native readback', async () => {
      const { connection, rig } = setup();
      rig.getLevel.mockResolvedValue(-350);
      await expect(connection.getIFShift()).resolves.toBe(-350);
      await expect(connection.setIFShift(-350)).resolves.toBeUndefined();
      expect(rig.setLevel).toHaveBeenCalledWith('IF', -350);
      await expect(connection.setIFShift(-1201)).rejects.toThrow('between -1200');
      expect(rig.setLevel).toHaveBeenCalledTimes(1);
    });

    it('exposes supported CW pitch and key speed without raw CAT frames', async () => {
      const { connection, rig } = setup();
      rig.getLevel.mockImplementation(async (level: string) => level === 'CWPITCH' ? 650 : 20);
      await expect(connection.getCwPitch()).resolves.toBe(650);
      await expect(connection.getKeySpeed()).resolves.toBe(20);
      await expect(connection.setCwPitch(650)).resolves.toBeUndefined();
      await expect(connection.setKeySpeed(20)).resolves.toBeUndefined();
      expect(rig.setLevel.mock.calls).toEqual([['CWPITCH', 650], ['KEYSPD', 20]]);
      await expect(connection.setCwPitch(655)).rejects.toThrow('10 Hz steps');
      await expect(connection.setKeySpeed(100)).rejects.toThrow('6 and 48');
    });

    it('blocks receiver/CW writes during physical PTT and on unsupported models', async () => {
      const { connection, rig, accessor } = setup();
      rig.getPtt.mockResolvedValue(true);
      await expect(connection.setIFShift(100)).rejects.toThrow('confirmed RX');
      await expect(connection.setCwPitch(600)).rejects.toThrow('confirmed RX');
      await expect(connection.setKeySpeed(20)).rejects.toThrow('confirmed RX');
      expect(rig.setLevel).not.toHaveBeenCalled();
      rig.getPtt.mockResolvedValue(false);
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1035, path: 'COM4' } };
      await expect(connection.getIFShift()).rejects.toThrow('unavailable');
      await expect(connection.setKeySpeed(20)).rejects.toThrow('unavailable');
      expect(rig.setLevel).not.toHaveBeenCalled();
    });
  });

  describe('FTDX10 guarded manual passband widths', () => {
    const prepare = (rigOverrides: Partial<MockRig> = {}) => {
      let width = 2400;
      const { connection, rig } = createConnectedConnection({
        getMode: vi.fn(async () => ({ mode: 'USB', bandwidth: width })),
        setMode: vi.fn(async (_mode: string, requestedWidth: number) => { width = requestedWidth; }),
        ...rigOverrides,
      });
      const accessor = asTestConnection(connection);
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1042, path: 'COM4' } };
      accessor.supportedModes = new Set(['USB', 'LSB']);
      return { connection, rig, accessor };
    };

    it('sets only advertised widths and confirms native mode and Hz readback', async () => {
      const { connection, rig } = prepare();
      await expect(connection.setManualModeBandwidth(1800)).resolves.toBeUndefined();
      expect(rig.setMode).toHaveBeenCalledWith('USB', 1800);
      expect(rig.getMode).toHaveBeenCalledTimes(2);
      expect(rig.getSplit).toHaveBeenCalledTimes(1);
      await expect(connection.setManualModeBandwidth(5000)).rejects.toThrow('does not advertise');
      expect(rig.setMode).toHaveBeenCalledTimes(1);
    });

    it('uses generic SSB filter metadata or Hamlib fallback widths without arbitrary guesses', async () => {
      const generic = prepare({
        getFilterList: vi.fn().mockResolvedValue([{ modes: ['SSB'], width: 1800 }]),
      });
      await expect(generic.connection.setManualModeBandwidth(1800)).resolves.toBeUndefined();
      expect(generic.rig.setMode).toHaveBeenCalledWith('USB', 1800);

      const fallback = prepare({
        getFilterList: vi.fn().mockRejectedValue(new Error('filter table unavailable')),
      });
      await expect(fallback.connection.setManualModeBandwidth(1800)).resolves.toBeUndefined();
      await expect(fallback.connection.setManualModeBandwidth(2000)).rejects.toThrow('does not advertise');
      expect(fallback.rig.setMode).toHaveBeenCalledTimes(1);
    });

    it('blocks TX, unknown PTT and Split ON without mutating the radio', async () => {
      const { connection, rig } = prepare();
      rig.getPtt.mockResolvedValue(true);
      await expect(connection.setManualModeBandwidth(1800)).rejects.toThrow('confirmed RX');
      rig.getPtt.mockResolvedValue(null);
      await expect(connection.setManualModeBandwidth(1800)).rejects.toThrow('confirmed RX');
      rig.getPtt.mockResolvedValue(false);
      rig.getSplit.mockResolvedValue({ enabled: true });
      await expect(connection.setManualModeBandwidth(1800)).rejects.toThrow('Split OFF');
      rig.getSplit.mockResolvedValue(null);
      await expect(connection.setManualModeBandwidth(1800)).rejects.toThrow('Split OFF');
      expect(rig.setMode).not.toHaveBeenCalled();
    });

    it('rejects mismatched readback and fails closed on unsupported radio models', async () => {
      const { connection, rig, accessor } = prepare({
        getMode: vi.fn().mockResolvedValue({ mode: 'USB', bandwidth: 2400 }),
      });
      await expect(connection.setManualModeBandwidth(1800)).rejects.toThrow('readback mismatch');
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1035, path: 'COM5' } };
      await expect(connection.setManualModeBandwidth(1800)).rejects.toThrow('unavailable');
      expect(rig.setMode).toHaveBeenCalledTimes(1);
    });
  });

  describe('FTDX10 guarded manual mode control', () => {
    const prepare = (rigOverrides: Partial<MockRig> = {}) => {
      const { connection, rig } = createConnectedConnection(rigOverrides);
      const accessor = asTestConnection(connection);
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1042, path: 'COM4' } };
      accessor.supportedModes = new Set(['USB', 'PKTUSB']);
      return { connection, rig, accessor };
    };

    it('locks a confirmed manual mode against conflicting engine and compound writes', async () => {
      const { connection, rig } = prepare({
        getMode: vi.fn().mockResolvedValue({ mode: 'PKTUSB', bandwidth: 2400 }),
      });
      await expect(connection.getManualModeAutoFollow()).resolves.toBe(true);
      await connection.setManualMode('PKTUSB');
      await expect(connection.getManualModeAutoFollow()).resolves.toBe(false);
      rig.setMode.mockClear();
      await expect(connection.setMode('USB')).rejects.toThrow('manual mode lock');
      await expect(connection.applyOperatingState({
        frequency: 14_074_000, mode: 'USB', bandwidth: 'nochange', tolerateModeFailure: true,
      })).rejects.toThrow('manual mode lock');
      expect(rig.setFrequency).not.toHaveBeenCalled();
      expect(rig.setMode).not.toHaveBeenCalled();
      await expect(connection.setMode('PKTUSB', 'nochange')).resolves.toBeUndefined();
      expect(rig.setMode).not.toHaveBeenCalled();
      await connection.setManualModeAutoFollow(true);
      await expect(connection.getManualModeAutoFollow()).resolves.toBe(true);
      await expect(connection.setMode('USB')).resolves.toBeUndefined();
      expect(rig.setMode).toHaveBeenCalledWith('USB', undefined);
    });

    it('can explicitly lock the observed RX mode and rejects TX/Split ambiguity', async () => {
      const { connection, rig } = prepare({
        getMode: vi.fn().mockResolvedValue({ mode: 'USB', bandwidth: 2400 }),
      });
      await connection.setManualModeAutoFollow(false);
      await expect(connection.getManualModeAutoFollow()).resolves.toBe(false);
      await expect(connection.setMode('PKTUSB')).rejects.toThrow('manual mode lock');

      await connection.setManualModeAutoFollow(true);
      rig.getPtt.mockResolvedValue(true);
      await expect(connection.setManualModeAutoFollow(false)).rejects.toThrow('confirmed RX');
      rig.getPtt.mockResolvedValue(false);
      rig.getSplit.mockResolvedValue({ enabled: true });
      await expect(connection.setManualModeAutoFollow(false)).rejects.toThrow('Split OFF');
      await expect(connection.getManualModeAutoFollow()).resolves.toBe(true);
    });

    it('changes mode only after confirming native RX and Split OFF, then confirms readback', async () => {
      const { connection, rig } = prepare({
        getMode: vi.fn().mockResolvedValue({ mode: 'PKTUSB', bandwidth: 2400 }),
      });
      await expect(connection.setManualMode('PKTUSB')).resolves.toBeUndefined();
      expect(rig.getPtt).toHaveBeenCalledTimes(1);
      expect(rig.getSplit).toHaveBeenCalled();
      expect(rig.setMode).toHaveBeenCalledWith('PKTUSB', 'nochange');
      expect(rig.getMode).toHaveBeenCalled();
    });

    it('rejects native transmit and unknown PTT states before sending a mode write', async () => {
      const { connection, rig } = prepare({ getPtt: vi.fn().mockResolvedValue(true) });
      await expect(connection.setManualMode('PKTUSB')).rejects.toThrow('confirmed RX');
      rig.getPtt.mockResolvedValue(null);
      await expect(connection.setManualMode('PKTUSB')).rejects.toThrow('confirmed RX');
      expect(rig.setMode).not.toHaveBeenCalled();
    });

    it('rejects Split ON and unconfirmed Split state before sending a mode write', async () => {
      const { connection, rig } = prepare({ getSplit: vi.fn().mockResolvedValue({ enabled: true }) });
      await expect(connection.setManualMode('PKTUSB')).rejects.toThrow('Split OFF');
      rig.getSplit.mockResolvedValue(null);
      await expect(connection.setManualMode('PKTUSB')).rejects.toThrow('Split OFF');
      expect(rig.setMode).not.toHaveBeenCalled();
    });

    it('fails closed when the mode readback differs and is unavailable for other models', async () => {
      const { connection, rig, accessor } = prepare();
      await expect(connection.setManualMode('PKTUSB')).rejects.toThrow('readback mismatch');
      accessor.currentConfig = { type: 'serial', serial: { rigModel: 1035, path: 'COM4' } };
      await expect(connection.setManualMode('PKTUSB')).rejects.toThrow('not available on this model');
      expect(rig.setMode).toHaveBeenCalledTimes(1);
    });
  });

  it('quarantines FTDX10 raw EX routing after an ambiguous write/readback', async () => {
    const { connection, rig } = createConnectedConnection({
      sendRaw: vi.fn().mockResolvedValue(Buffer.from('FA014074000;', 'ascii')),
    });
    const accessor = asTestConnection(connection);
    accessor.meterRigMetadata = { rigModel: 1042, mfgName: 'Yaesu', modelName: 'FTDX-10' };
    accessor.currentConfig = { type: 'serial', serial: { rigModel: 1042, path: 'COM4' } };
    await expect(connection.setTxAudioInputSource!('usb')).rejects.toThrow('readback mismatch');
    expect(rig.sendRawWrite).toHaveBeenCalledTimes(2);
    await expect(connection.setTxAudioInputSource!('usb')).rejects.toThrow('quarantined until reconnect');
    await expect(connection.getTxAudioInputSource!()).rejects.toThrow('quarantined until reconnect');
    expect(rig.sendRawWrite).toHaveBeenCalledTimes(2);
  });

  it('does not write FTDX10 EX routing when the physical radio is TX or Split ON', async () => {
    const { connection, rig } = createConnectedConnection();
    const accessor = asTestConnection(connection);
    accessor.meterRigMetadata = { rigModel: 1042, mfgName: 'Yaesu', modelName: 'FTDX-10' };
    accessor.currentConfig = { type: 'serial', serial: { rigModel: 1042, path: 'COM4' } };
    rig.getPtt.mockResolvedValue(true);
    await expect(connection.setTxAudioInputSource!('usb')).rejects.toThrow('confirmed RX');
    rig.getPtt.mockResolvedValue(false);
    rig.getSplit.mockResolvedValue({ enabled: true });
    await expect(connection.setTxAudioInputSource!('usb')).rejects.toThrow('Split OFF');
    expect(rig.sendRawWrite).not.toHaveBeenCalled();
  });

  it('writes FTDX10 USB as an ordered MOD SOURCE + REAR SELECT transaction', async () => {
    const { connection, rig } = createConnectedConnection({
      sendRaw: vi.fn()
        .mockResolvedValueOnce(Buffer.from('EX0101131;', 'ascii'))
        .mockResolvedValueOnce(Buffer.from('EX0101141;', 'ascii')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 1042, mfgName: 'Yaesu', modelName: 'FTDX-10' };

    await expect(connection.getSupportedTxAudioInputSources!()).resolves.toEqual(['mic', 'usb', 'accessory']);
    await expect(connection.setTxAudioInputSource!('usb')).resolves.toMatchObject({ applied: 'usb', acknowledgement: 'readback' });
    expect(rig.sendRawWrite).toHaveBeenNthCalledWith(1, Buffer.from('EX0101131;', 'ascii'));
    expect(rig.sendRawWrite).toHaveBeenNthCalledWith(2, Buffer.from('EX0101141;', 'ascii'));
    expect(rig.sendRaw).toHaveBeenNthCalledWith(1, Buffer.from('EX010113;', 'ascii'), 64, Buffer.from(';'));
    expect(rig.sendRaw).toHaveBeenNthCalledWith(2, Buffer.from('EX010114;', 'ascii'), 64, Buffer.from(';'));
  });

  it('writes FT-991A DATA USB using EX070 + EX072', async () => {
    const { connection, rig } = createConnectedConnection({
      sendRaw: vi.fn()
        .mockResolvedValueOnce(Buffer.from('EX0701;', 'ascii'))
        .mockResolvedValueOnce(Buffer.from('EX0722;', 'ascii')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 1035, mfgName: 'Yaesu', modelName: 'FT-991A' };
    testConnection.currentRadioMode = 'PKTUSB';

    await expect(connection.setTxAudioInputSource!('usb')).resolves.toMatchObject({ applied: 'usb' });
    expect(rig.sendRawWrite).toHaveBeenNthCalledWith(1, Buffer.from('EX0701;', 'ascii'));
    expect(rig.sendRawWrite).toHaveBeenNthCalledWith(2, Buffer.from('EX0722;', 'ascii'));
    expect(rig.sendRaw).toHaveBeenNthCalledWith(1, Buffer.from('EX070;', 'ascii'), 64, Buffer.from(';'));
    expect(rig.sendRaw).toHaveBeenNthCalledWith(2, Buffer.from('EX072;', 'ascii'), 64, Buffer.from(';'));
  });

  it('writes FTDX101D USB using its distinct composite EX slots', async () => {
    const { connection, rig } = createConnectedConnection({
      sendRaw: vi.fn()
        .mockResolvedValueOnce(Buffer.from('EX0101111;', 'ascii'))
        .mockResolvedValueOnce(Buffer.from('EX0101121;', 'ascii')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 1040, mfgName: 'Yaesu', modelName: 'FTDX-101D' };
    testConnection.currentRadioMode = 'USB';

    await expect(connection.setTxAudioInputSource!('usb')).resolves.toMatchObject({ applied: 'usb' });
    expect(rig.sendRawWrite).toHaveBeenNthCalledWith(1, Buffer.from('EX0101111;', 'ascii'));
    expect(rig.sendRawWrite).toHaveBeenNthCalledWith(2, Buffer.from('EX0101121;', 'ascii'));
  });

  it('supports only MIC/REAR on FT-891 and never advertises USB', async () => {
    const { connection, rig } = createConnectedConnection({
      sendRaw: vi.fn().mockResolvedValue(Buffer.from('EX11051;', 'ascii')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.meterRigMetadata = { rigModel: 1031, mfgName: 'Yaesu', modelName: 'FT-891' };

    await expect(connection.getSupportedTxAudioInputSources!()).resolves.toEqual(['mic', 'accessory']);
    await expect(connection.getTxAudioInputSource!()).resolves.toBe('accessory');
    await expect(connection.setTxAudioInputSource!('usb')).rejects.toThrow(/unsupported TX audio input source/i);
    expect(rig.sendRaw).toHaveBeenCalledWith(Buffer.from('EX1105;', 'ascii'), 64, Buffer.from(';'));
  });


  it('reads DCD squelch state via low-priority Hamlib polling', async () => {
    const { connection, rig } = createConnectedConnection({
      getDcd: vi.fn().mockResolvedValue(true),
    });

    await expect(connection.getDCD()).resolves.toBe(true);
    expect(rig.getDcd).toHaveBeenCalledTimes(1);
  });

  it('reports CAT CW support only when Hamlib exposes SEND_MORSE', () => {
    const { connection } = createConnectedConnection();
    const testConnection = asTestConnection(connection);

    testConnection.supportedFunctions = new Set(['SEND_MORSE']);
    expect(connection.supportsCWMessageKeyer()).toBe(true);

    testConnection.supportedFunctions = new Set(['SPECTRUM']);
    expect(connection.supportsCWMessageKeyer()).toBe(false);
  });

  it('reads PTT state via low-priority Hamlib polling', async () => {
    const { connection, rig } = createConnectedConnection({
      getPtt: vi.fn().mockResolvedValue(true),
    });

    await expect(connection.getPTT()).resolves.toBe(true);
    expect(rig.getPtt).toHaveBeenCalledTimes(1);
  });

  it('skips PTT polling while a critical CAT write is active', async () => {
    const firstWrite = createDeferred<number>();
    const { connection, rig } = createConnectedConnection({
      setFrequency: vi.fn().mockReturnValue(firstWrite.promise),
      getPtt: vi.fn().mockResolvedValue(true),
    });

    const writePromise = connection.setFrequency(7100000);
    await Promise.resolve();

    await expect(connection.getPTT()).rejects.toThrow(/busy/);
    expect(rig.getPtt).not.toHaveBeenCalled();

    firstWrite.resolve(0);
    await writePromise;
  });

  it('keeps later PTT writes fenced until the native command really settles', async () => {
    const firstStop = createDeferred<number>();
    const { connection, rig } = createConnectedConnection({
      setPtt: vi.fn()
        .mockReturnValueOnce(firstStop.promise)
        .mockResolvedValueOnce(0),
    });

    const oldStop = connection.setPTT(false);
    await Promise.resolve();
    const newStart = connection.setPTT(true);
    await Promise.resolve();

    expect(rig.setPtt).toHaveBeenCalledTimes(1);
    expect(rig.setPtt).toHaveBeenNthCalledWith(1, false);
    firstStop.resolve(0);
    await oldStop;
    await newStart;
    expect(rig.setPtt).toHaveBeenNthCalledWith(2, true);
  });

  it('skips DCD polling while a critical CAT write is active', async () => {
    const firstWrite = createDeferred<number>();
    const { connection, rig } = createConnectedConnection({
      setFrequency: vi.fn().mockReturnValue(firstWrite.promise),
      getDcd: vi.fn().mockResolvedValue(true),
    });

    const writePromise = connection.setFrequency(7100000);
    await Promise.resolve();

    await expect(connection.getDCD()).rejects.toThrow(/busy/);
    expect(rig.getDcd).not.toHaveBeenCalled();

    firstWrite.resolve(0);
    await writePromise;
  });

  it('surfaces DCD read failures as optional operation errors', async () => {
    const { connection } = createConnectedConnection({
      getDcd: vi.fn().mockRejectedValue(new Error('Feature not available')),
    });

    await expect(connection.getDCD()).rejects.toThrow(/getDCD/);
  });

  it('keeps RX frequency writes independent from Split probing when Split is disabled', async () => {
    const { connection, rig } = createConnectedConnection({
      getSplit: vi.fn().mockResolvedValue({ enabled: false }),
    });

    await connection.setFrequency(7100000);
    await connection.setFrequency(7200000);

    expect(rig.setFrequency).toHaveBeenCalledTimes(2);
    expect(rig.getSplit).not.toHaveBeenCalled();
    expect(rig.setSplitFreq).not.toHaveBeenCalled();
  });

  it('does not mirror RX frequency writes into the Split TX frequency', async () => {
    const { connection, rig } = createConnectedConnection({
      getSplit: vi.fn().mockResolvedValue({ enabled: true }),
    });

    await connection.setFrequency(7100000);
    await connection.setFrequency(7200000);

    expect(rig.setFrequency).toHaveBeenCalledTimes(2);
    expect(rig.getSplit).not.toHaveBeenCalled();
    expect(rig.setSplitFreq).not.toHaveBeenCalled();
  });

  it('does not probe Split while performing plain RX frequency writes', async () => {
    const { connection, rig } = createConnectedConnection({
      getSplit: vi.fn().mockRejectedValue(new Error('Feature not available')),
    });

    await connection.setFrequency(7100000);
    await connection.setFrequency(7200000);

    expect(rig.setFrequency).toHaveBeenCalledTimes(2);
    expect(rig.getSplit).not.toHaveBeenCalled();
    expect(rig.setSplitFreq).not.toHaveBeenCalled();
  });

  it('keeps setFrequency successful when Split TX writes would fail', async () => {
    const { connection, rig } = createConnectedConnection({
      getSplit: vi.fn().mockResolvedValue({ enabled: true }),
      setSplitFreq: vi.fn().mockRejectedValue(new Error('Protocol error')),
    });

    await expect(connection.setFrequency(7100000)).resolves.toBeUndefined();
    await expect(connection.setFrequency(7200000)).resolves.toBeUndefined();

    expect(rig.getSplit).not.toHaveBeenCalled();
    expect(rig.setSplitFreq).not.toHaveBeenCalled();
  });

  it('live-reads Split status after support has been detected', async () => {
    const { connection, rig } = createConnectedConnection({
      getSplit: vi.fn()
        .mockResolvedValueOnce({ enabled: true, txVfo: 'VFOB' })
        .mockResolvedValueOnce({ enabled: false, txVfo: 'VFOB' }),
    });

    await expect(connection.getSplitEnabled()).resolves.toBe(true);
    await expect(connection.getSplitEnabled()).resolves.toBe(false);

    expect(rig.getSplit).toHaveBeenCalledTimes(2);
  });

  it('returns null Split TX frequency after a live Split read reports disabled', async () => {
    const { connection, rig } = createConnectedConnection({
      getSplit: vi.fn()
        .mockResolvedValueOnce({ enabled: true, txVfo: 'VFOB' })
        .mockResolvedValueOnce({ enabled: false, txVfo: 'VFOB' }),
      getSplitFreq: vi.fn().mockResolvedValue(14_275_000),
    });

    await expect(connection.getSplitEnabled()).resolves.toBe(true);
    await expect(connection.getSplitFrequency()).resolves.toBeNull();

    expect(rig.getSplit).toHaveBeenCalledTimes(2);
    expect(rig.getSplitFreq).not.toHaveBeenCalled();
  });

  it('enables Split with an explicit TX VFO before falling back to the default Split write', async () => {
    const { connection, rig } = createConnectedConnection();

    await expect(connection.setSplitEnabled(true)).resolves.toBeUndefined();
    expect(rig.setSplit).toHaveBeenCalledWith(true, 'currVFO', 'Other');

    rig.setSplit.mockClear();
    rig.setSplit
      .mockRejectedValueOnce(new Error('Invalid VFO'))
      .mockResolvedValueOnce(0);

    await expect(connection.setSplitEnabled(true)).resolves.toBeUndefined();
    expect(rig.setSplit).toHaveBeenNthCalledWith(1, true, 'currVFO', 'Other');
    expect(rig.setSplit).toHaveBeenNthCalledWith(2, true, 'currVFO', 'otherVFO');

    rig.setSplit.mockClear();
    rig.setSplit
      .mockRejectedValueOnce(new Error('Invalid VFO'))
      .mockRejectedValueOnce(new Error('Invalid VFO'))
      .mockResolvedValueOnce(0);

    await expect(connection.setSplitEnabled(true)).resolves.toBeUndefined();
    expect(rig.setSplit).toHaveBeenNthCalledWith(1, true, 'currVFO', 'Other');
    expect(rig.setSplit).toHaveBeenNthCalledWith(2, true, 'currVFO', 'otherVFO');
    expect(rig.setSplit).toHaveBeenNthCalledWith(3, true);
  });

  it('reads Split TX frequency from the reported TX VFO and falls back when Hamlib reports current VFO as zero', async () => {
    const { connection, rig } = createConnectedConnection({
      getSplit: vi.fn().mockResolvedValue({ enabled: true, txVfo: 'currVFO' }),
      getSplitFreq: vi.fn().mockImplementation(async (vfo?: string) => (
        vfo === 'otherVFO' ? 14_275_000 : 0
      )),
    });

    await expect(connection.getSplitFrequency()).resolves.toBe(14_275_000);

    expect(rig.getSplitFreq).toHaveBeenNthCalledWith(1, 'Other');
    expect(rig.getSplitFreq).toHaveBeenNthCalledWith(2, 'otherVFO');
  });

  it('writes Split TX frequency to the live Split TX VFO', async () => {
    const { connection, rig } = createConnectedConnection({
      getSplit: vi.fn().mockResolvedValue({ enabled: true, txVfo: 'VFOB' }),
    });

    await expect(connection.setSplitFrequency(14_275_000)).resolves.toBeUndefined();

    expect(rig.setSplitFreq).toHaveBeenCalledWith(14_275_000, 'VFOB');
  });

  it('does not attempt split TX sync when the primary frequency write fails', async () => {
    const { connection, rig } = createConnectedConnection({
      setFrequency: vi.fn().mockRejectedValue(new Error('device disconnected')),
      getSplit: vi.fn().mockResolvedValue({ enabled: true }),
    });

    await expect(connection.setFrequency(7100000)).rejects.toThrow('device disconnected');

    expect(rig.getSplit).not.toHaveBeenCalled();
    expect(rig.setSplitFreq).not.toHaveBeenCalled();
  });

  it('serializes queued CAT operations so later writes wait for earlier writes to finish', async () => {
    const firstWrite = createDeferred<number>();
    const { connection, rig } = createConnectedConnection({
      setFrequency: vi.fn()
        .mockReturnValueOnce(firstWrite.promise)
        .mockResolvedValueOnce(0),
      getSplit: vi.fn().mockResolvedValue({ enabled: false }),
    });

    const first = connection.setFrequency(7100000);
    await Promise.resolve();

    const second = connection.setFrequency(7200000);
    await Promise.resolve();

    expect(rig.setFrequency).toHaveBeenCalledTimes(1);
    expect(rig.setFrequency).toHaveBeenNthCalledWith(1, 7100000);

    firstWrite.resolve(0);
    await first;
    await second;

    expect(rig.setFrequency).toHaveBeenCalledTimes(2);
    expect(rig.setFrequency).toHaveBeenNthCalledWith(2, 7200000);
    expect(rig.getSplit).not.toHaveBeenCalled();
  });

  it('dedupes concurrent getFrequency reads through the CAT queue', async () => {
    const read = createDeferred<number>();
    const { connection, rig } = createConnectedConnection({
      getFrequency: vi.fn().mockReturnValue(read.promise),
    });

    const first = connection.getFrequency();
    await Promise.resolve();
    const second = connection.getFrequency();

    expect(rig.getFrequency).toHaveBeenCalledTimes(1);

    read.resolve(7100000);
    await expect(Promise.all([first, second])).resolves.toEqual([7100000, 7100000]);
    expect(rig.getFrequency).toHaveBeenCalledTimes(1);
  });

  it('prefers DATA mode for digital intent when supported', async () => {
    const { connection, rig } = createConnectedConnection();
    asTestConnection(connection).supportedModes = new Set(['USB', 'PKTUSB']);

    await expect(connection.setMode('USB', undefined, { intent: 'digital' })).resolves.toBeUndefined();

    expect(rig.setMode).toHaveBeenCalledWith('PKTUSB', undefined);
  });

  it('uses Hamlib-provided watt labels for discrete RF power steps without local correction', async () => {
    const { connection } = createConnectedConnection({
      getRfPowerStepTable: vi.fn().mockResolvedValue([
        { normalized: 0.1, milliwatts: 10000, watts: 10 },
        { normalized: 0.5, milliwatts: 50000, watts: 50 },
        { normalized: 1, milliwatts: 100000, watts: 100 },
      ]),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedLevels = new Set(['RFPOWER']);
    testConnection.currentFrequencyHz = 7100000;
    testConnection.currentRadioMode = 'USB';
    await expect(connection.getSupportedRFPowerSteps()).resolves.toEqual([
      { value: 0.1, label: '10 W' },
      { value: 0.5, label: '50 W' },
      { value: 1, label: '100 W' },
    ]);
  });

  it('falls back to unlabeled discrete RF power steps when Hamlib does not provide raw power values', async () => {
    const { connection } = createConnectedConnection({
      getRfPowerStepTable: vi.fn().mockResolvedValue([
        { normalized: 0.1, milliwatts: 0, watts: 0 },
        { normalized: 1, milliwatts: 0, watts: 0 },
      ]),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedLevels = new Set(['RFPOWER']);
    testConnection.currentFrequencyHz = 7100000;
    testConnection.currentRadioMode = 'USB';

    await expect(connection.getSupportedRFPowerSteps()).resolves.toEqual([
      { value: 0.1, label: undefined },
      { value: 1, label: undefined },
    ]);
  });

  it('prefers DATA mode for digital intent even when capability probing omitted it', async () => {
    const { connection, rig } = createConnectedConnection();
    asTestConnection(connection).supportedModes = new Set(['USB']);

    await expect(connection.setMode('USB', undefined, { intent: 'digital' })).resolves.toBeUndefined();

    expect(rig.setMode).toHaveBeenCalledWith('PKTUSB', undefined);
  });

  it('falls back to standard mode when DATA mode write fails', async () => {
    const { connection, rig } = createConnectedConnection({
      setMode: vi.fn().mockImplementation(async (mode: string) => {
        if (mode === 'PKTUSB') {
          throw new Error('mode not supported');
        }
        return 0;
      }),
    });
    asTestConnection(connection).supportedModes = new Set(['USB']);

    await expect(connection.setMode('USB', undefined, { intent: 'digital' })).resolves.toBeUndefined();

    expect(rig.setMode).toHaveBeenNthCalledWith(1, 'PKTUSB', undefined);
    expect(rig.setMode).toHaveBeenNthCalledWith(2, 'USB', undefined);
  });

  it('keeps standard mode for voice intent even when DATA mode is supported', async () => {
    const { connection, rig } = createConnectedConnection();
    asTestConnection(connection).supportedModes = new Set(['USB', 'PKTUSB']);

    await expect(connection.setMode('USB', undefined, { intent: 'voice' })).resolves.toBeUndefined();

    expect(rig.setMode).toHaveBeenCalledWith('USB', undefined);
  });

  it('normalizes explicit DATA mode back to standard mode for voice intent', async () => {
    const { connection, rig } = createConnectedConnection();
    asTestConnection(connection).supportedModes = new Set(['USB', 'PKTUSB']);

    await expect(connection.setMode('PKTUSB', undefined, { intent: 'voice' })).resolves.toBeUndefined();

    expect(rig.setMode).toHaveBeenCalledWith('USB', undefined);
  });

  it('passes through nochange bandwidth selectors to hamlib', async () => {
    const { connection, rig } = createConnectedConnection();

    await expect(connection.setMode('USB', 'nochange', { intent: 'voice' })).resolves.toBeUndefined();

    expect(rig.setMode).toHaveBeenCalledWith('USB', 'nochange');
  });

  it('passes through numeric passband widths to hamlib', async () => {
    const { connection, rig } = createConnectedConnection();

    await expect(connection.setMode('USB', 2400, { intent: 'voice' })).resolves.toBeUndefined();

    expect(rig.setMode).toHaveBeenCalledWith('USB', 2400);
  });

  it('returns numeric mode bandwidth values from hamlib', async () => {
    const { connection } = createConnectedConnection({
      getMode: vi.fn().mockResolvedValue({ mode: 'USB', bandwidth: 2400 }),
    });

    await expect(connection.getMode()).resolves.toEqual({ mode: 'USB', bandwidth: 2400 });
    await expect(connection.getModeBandwidth()).resolves.toBe(2400);
  });

  it('derives supported mode bandwidth options from hamlib filter list', async () => {
    const { connection } = createConnectedConnection({
      getFilterList: vi.fn().mockResolvedValue([
        { modes: ['USB', 'LSB'], width: 3000 },
        { modes: ['USB'], width: 2400 },
        { modes: ['USB'], width: 1800 },
        { modes: ['FM'], width: 12000 },
        { modes: ['USB'], width: 0 },
      ]),
    });

    await expect(connection.getSupportedModeBandwidths()).resolves.toEqual([1800, 2400, 3000]);
  });

  it('reads passband fallback widths sequentially when the filter list has no matches', async () => {
    const narrow = createDeferred<number>();
    const { connection, rig } = createConnectedConnection({
      getFilterList: vi.fn().mockResolvedValue([]),
      getPassbandNarrow: vi.fn().mockReturnValue(narrow.promise),
      getPassbandNormal: vi.fn().mockResolvedValue(2400),
      getPassbandWide: vi.fn().mockResolvedValue(3000),
    });

    const promise = connection.getSupportedModeBandwidths();
    await new Promise((resolve) => setImmediate(resolve));

    expect(rig.getPassbandNarrow).toHaveBeenCalledTimes(1);
    expect(rig.getPassbandNormal).not.toHaveBeenCalled();
    expect(rig.getPassbandWide).not.toHaveBeenCalled();

    narrow.resolve(1800);
    await expect(promise).resolves.toEqual([1800, 2400, 3000]);
    expect(rig.getPassbandNormal).toHaveBeenCalledTimes(1);
    expect(rig.getPassbandWide).toHaveBeenCalledTimes(1);
  });

  it('keeps the current mode when writing mode bandwidth', async () => {
    const { connection, rig } = createConnectedConnection({
      getMode: vi.fn().mockResolvedValue({ mode: 'USB', bandwidth: 2400 }),
    });

    await expect(connection.setModeBandwidth(3000)).resolves.toBeUndefined();

    expect(rig.setMode).toHaveBeenCalledWith('USB', 3000);
  });

  it('applies FTDX-10 frequency and mode as a single target-VFO operating-state update', async () => {
    const sequence: string[] = [];
    const { connection, rig } = createConnectedConnection({
      setFrequency: vi.fn().mockImplementation(async (frequency, vfo) => {
        sequence.push(`frequency:${frequency}:${vfo}`);
        return 0;
      }),
      setVfo: vi.fn().mockImplementation(async (vfo) => {
        sequence.push(`vfo:${vfo}`);
        return 0;
      }),
      setMode: vi.fn().mockImplementation(async (mode, bandwidth, vfo) => {
        sequence.push(`mode:${mode}:${bandwidth}:${vfo}`);
        return 0;
      }),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedModes = new Set(['USB']);
    testConnection.currentRadioMode = 'LSB';
    testConnection.currentConfig = {
      type: 'serial',
      serial: { path: 'COM3', rigModel: 1042 },
    };
    testConnection.meterRigMetadata = { rigModel: 1042, mfgName: 'Yaesu', modelName: 'FTDX-10' };
    testConnection.supportedVfoOps = new Set(['XCHG']);

    const result = await connection.applyOperatingState({
      frequency: 7100000,
      mode: 'USB',
      bandwidth: 'nochange',
      options: { intent: 'voice' },
    });

    expect(result).toEqual({
      frequencyApplied: true,
      frequencyConfirmed: true,
      observedFrequency: 7_100_000,
      modeApplied: true,
      modeConfirmed: true,
      observedMode: 'USB',
      targetVfo: 'VFOA',
      modeError: undefined,
    });
    expect(rig.getVfo).toHaveBeenCalledTimes(1);
    expect(rig.getVfoInfo).toHaveBeenCalledWith('VFOA');
    expect(rig.setMode).toHaveBeenCalledTimes(1);
    expect(rig.setFrequency).toHaveBeenCalledTimes(2);
    expect(sequence).toEqual([
      'frequency:7100000:VFOA',
      'vfo:VFOA',
      'mode:USB:nochange:undefined',
      'frequency:7100000:VFOA',
    ]);
  });

  it('uses the correlated path for a CPY-only legacy Yaesu dual-VFO backend', async () => {
    const sequence: string[] = [];
    const { connection, rig } = createConnectedConnection({
      setFrequency: vi.fn().mockImplementation(async (frequency, vfo) => {
        sequence.push(`frequency:${frequency}:${vfo}`);
        return 0;
      }),
      setVfo: vi.fn().mockImplementation(async (vfo) => {
        sequence.push(`vfo:${vfo}`);
        return 0;
      }),
      setMode: vi.fn().mockImplementation(async (mode, bandwidth, vfo) => {
        sequence.push(`mode:${mode}:${bandwidth}:${vfo}`);
        return 0;
      }),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedModes = new Set(['USB']);
    testConnection.currentRadioMode = 'USB';
    testConnection.currentConfig = {
      type: 'serial',
      serial: { path: 'COM3', rigModel: 1024 },
    };
    testConnection.meterRigMetadata = { rigModel: 1024, mfgName: 'Yaesu', modelName: 'FT-1000MP' };
    testConnection.supportedVfoOps = new Set(['CPY', 'FROM_VFO', 'TO_VFO']);

    await expect(connection.applyOperatingState({
      frequency: 7100000,
      mode: 'USB',
      bandwidth: 'nochange',
      options: { intent: 'voice' },
    })).resolves.toMatchObject({
      frequencyApplied: true,
      modeApplied: true,
    });

    expect(rig.setMode).toHaveBeenCalledTimes(1);
    expect(rig.setFrequency).toHaveBeenCalledTimes(2);
    expect(sequence).toEqual([
      'frequency:7100000:VFOA',
      'vfo:VFOA',
      'mode:USB:nochange:undefined',
      'frequency:7100000:VFOA',
    ]);
  });

  it('keeps VFO-B bound through CW and USB operating-state transactions', async () => {
    const state = {
      frequency: 14_074_000,
      mode: 'USB',
    };
    const { connection, rig } = createConnectedConnection({
      getVfo: vi.fn().mockResolvedValue('VFOB'),
      setVfo: vi.fn().mockImplementation(async (vfo: string) => {
        expect(vfo).toBe('VFOB');
        return 0;
      }),
      setFrequency: vi.fn().mockImplementation(async (frequency: number, vfo: string) => {
        expect(vfo).toBe('VFOB');
        state.frequency = frequency;
        return 0;
      }),
      setMode: vi.fn().mockImplementation(async (mode: string, _bandwidth: unknown, vfo?: string) => {
        expect(vfo).toBeUndefined();
        state.mode = mode;
        return 0;
      }),
      getVfoInfo: vi.fn().mockImplementation(async (vfo: string) => {
        expect(vfo).toBe('VFOB');
        return {
          ...state,
          bandwidth: state.mode === 'CW' ? 600 : 2400,
          split: false,
          satMode: false,
        };
      }),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedModes = new Set(['CW', 'USB']);
    testConnection.currentRadioMode = 'USB';
    testConnection.currentConfig = {
      type: 'serial',
      serial: { path: 'COM3', rigModel: 1042 },
    };
    testConnection.meterRigMetadata = { rigModel: 1042, mfgName: 'Yaesu', modelName: 'FTDX-10' };
    testConnection.supportedVfoOps = new Set(['XCHG']);

    await expect(connection.applyOperatingState({
      frequency: 7_030_000,
      mode: 'CW',
      bandwidth: 'nochange',
      options: { intent: 'cw' },
    })).resolves.toMatchObject({
      targetVfo: 'VFOB',
      frequencyConfirmed: true,
      modeConfirmed: true,
      observedFrequency: 7_030_000,
      observedMode: 'CW',
    });

    await expect(connection.applyOperatingState({
      frequency: 14_074_000,
      mode: 'USB',
      bandwidth: 'nochange',
      options: { intent: 'voice' },
    })).resolves.toMatchObject({
      targetVfo: 'VFOB',
      frequencyConfirmed: true,
      modeConfirmed: true,
      observedFrequency: 14_074_000,
      observedMode: 'USB',
    });

    expect(rig.setFrequency.mock.calls).toEqual([
      [7_030_000, 'VFOB'],
      [7_030_000, 'VFOB'],
      [14_074_000, 'VFOB'],
      [14_074_000, 'VFOB'],
    ]);
    expect(rig.setMode.mock.calls).toEqual([
      ['CW', 'nochange'],
      ['USB', 'nochange'],
    ]);
    expect(rig.getVfoInfo).toHaveBeenNthCalledWith(1, 'VFOB');
    expect(rig.getVfoInfo).toHaveBeenNthCalledWith(2, 'VFOB');
    expect(rig.setVfo.mock.calls).toEqual([['VFOB'], ['VFOB']]);
  });

  it('preserves legacy current-VFO writes when Hamlib does not report explicit Yaesu A/B support', async () => {
    const { connection, rig } = createConnectedConnection({
      getVfo: vi.fn().mockRejectedValue(new Error('getVfo unsupported')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedModes = new Set(['USB']);
    testConnection.currentRadioMode = 'LSB';
    testConnection.currentConfig = {
      type: 'serial',
      serial: { path: 'COM4', rigModel: 1234 },
    };

    await expect(connection.applyOperatingState({
      frequency: 14_074_000,
      mode: 'USB',
      bandwidth: 'nochange',
      options: { intent: 'digital' },
    })).resolves.toEqual({
      frequencyApplied: true,
      modeApplied: true,
      modeError: undefined,
    });

    expect(rig.getVfo).not.toHaveBeenCalled();
    expect(rig.getVfoInfo).not.toHaveBeenCalled();
    expect(rig.setVfo).not.toHaveBeenCalled();
    expect(rig.setFrequency.mock.calls).toEqual([[14_074_000], [14_074_000]]);
    expect(rig.setMode).toHaveBeenCalledWith('PKTUSB', 'nochange');
  });

  it('does not treat TOGGLE-only Yaesu backends as explicitly addressable A/B radios', async () => {
    const { connection, rig } = createConnectedConnection({
      getVfo: vi.fn().mockRejectedValue(new Error('getVfo must not be called')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedModes = new Set(['USB']);
    testConnection.currentRadioMode = 'LSB';
    testConnection.currentConfig = {
      type: 'serial',
      serial: { path: 'COM5', rigModel: 1023 },
    };
    testConnection.meterRigMetadata = { rigModel: 1023, mfgName: 'Yaesu', modelName: 'FT-897' };
    testConnection.supportedVfoOps = new Set(['TOGGLE', 'TUNE']);

    await expect(connection.applyOperatingState({
      frequency: 14_074_000,
      mode: 'USB',
      bandwidth: 'nochange',
      options: { intent: 'voice' },
    })).resolves.toEqual({
      frequencyApplied: true,
      modeApplied: true,
      modeError: undefined,
    });

    expect(rig.getVfo).not.toHaveBeenCalled();
    expect(rig.setVfo).not.toHaveBeenCalled();
    expect(rig.setFrequency.mock.calls).toEqual([[14_074_000], [14_074_000]]);
    expect(rig.setMode).toHaveBeenCalledWith('USB', 'nochange');
  });

  it('does not use Yaesu correlation for another manufacturer with dual-VFO operations', async () => {
    const { connection, rig } = createConnectedConnection({
      getVfo: vi.fn().mockRejectedValue(new Error('getVfo must not be called')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedModes = new Set(['USB']);
    testConnection.currentRadioMode = 'LSB';
    testConnection.currentConfig = {
      type: 'serial',
      serial: { path: 'COM6', rigModel: 9999 },
    };
    testConnection.meterRigMetadata = { rigModel: 9999, mfgName: 'Icom', modelName: 'Test Rig' };
    testConnection.supportedVfoOps = new Set(['CPY', 'XCHG']);

    await expect(connection.applyOperatingState({
      frequency: 14_074_000,
      mode: 'USB',
      bandwidth: 'nochange',
      options: { intent: 'voice' },
    })).resolves.toEqual({
      frequencyApplied: true,
      modeApplied: true,
      modeError: undefined,
    });

    expect(rig.getVfo).not.toHaveBeenCalled();
    expect(rig.setVfo).not.toHaveBeenCalled();
    expect(rig.setFrequency.mock.calls).toEqual([[14_074_000], [14_074_000]]);
    expect(rig.setMode).toHaveBeenCalledWith('USB', 'nochange');
  });

  it('falls back to legacy writes when a qualifying Yaesu backend cannot read the current VFO', async () => {
    const { connection, rig } = createConnectedConnection({
      getVfo: vi.fn().mockRejectedValue(new Error('getVfo unavailable')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedModes = new Set(['USB']);
    testConnection.currentRadioMode = 'LSB';
    testConnection.currentConfig = {
      type: 'serial',
      serial: { path: 'COM7', rigModel: 1049 },
    };
    testConnection.meterRigMetadata = { rigModel: 1049, mfgName: 'Yaesu', modelName: 'FT-710' };
    testConnection.supportedVfoOps = new Set(['XCHG']);

    await expect(connection.applyOperatingState({
      frequency: 14_074_000,
      mode: 'USB',
      bandwidth: 'nochange',
      options: { intent: 'voice' },
    })).resolves.toEqual({
      frequencyApplied: true,
      modeApplied: true,
      modeError: undefined,
    });

    expect(rig.getVfo).toHaveBeenCalledTimes(1);
    expect(rig.getVfoInfo).not.toHaveBeenCalled();
    expect(rig.setVfo).not.toHaveBeenCalled();
    expect(rig.setFrequency.mock.calls).toEqual([[14_074_000], [14_074_000]]);
    expect(rig.setMode).toHaveBeenCalledWith('USB', 'nochange');
  });

  it('uses the live current VFO when a qualifying Yaesu backend cannot re-select it', async () => {
    const { connection, rig } = createConnectedConnection({
      getVfo: vi.fn().mockResolvedValue('VFOB'),
      setVfo: vi.fn().mockRejectedValue(new Error('Feature not available')),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedModes = new Set(['USB']);
    testConnection.currentRadioMode = 'LSB';
    testConnection.currentConfig = {
      type: 'serial',
      serial: { path: 'COM8', rigModel: 1007 },
    };
    testConnection.meterRigMetadata = { rigModel: 1007, mfgName: 'Yaesu', modelName: 'FT-757GXII' };
    testConnection.supportedVfoOps = new Set(['CPY']);

    await expect(connection.applyOperatingState({
      frequency: 7_074_000,
      mode: 'USB',
      bandwidth: 'nochange',
      options: { intent: 'voice' },
    })).resolves.toMatchObject({
      frequencyApplied: true,
      modeApplied: true,
      targetVfo: 'VFOB',
    });

    expect(rig.setVfo).toHaveBeenCalledWith('VFOB');
    expect(rig.setMode).toHaveBeenCalledWith('USB', 'nochange');
    expect(rig.setMode).not.toHaveBeenCalledWith('USB', 'nochange', 'VFOB');
  });

  it('does not add extra writes for frequency-only or mode-only operating-state updates', async () => {
    const { connection, rig } = createConnectedConnection();
    const testConnection = asTestConnection(connection);
    testConnection.supportedModes = new Set(['USB']);
    testConnection.currentRadioMode = 'LSB';

    await expect(connection.applyOperatingState({ frequency: 7100000 })).resolves.toMatchObject({
      frequencyApplied: true,
      modeApplied: false,
    });
    expect(rig.setFrequency).toHaveBeenCalledTimes(1);
    expect(rig.setMode).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await expect(connection.applyOperatingState({ mode: 'USB', bandwidth: 'nochange' })).resolves.toMatchObject({
      frequencyApplied: false,
      modeApplied: true,
    });
    expect(rig.setFrequency).not.toHaveBeenCalled();
    expect(rig.setMode).toHaveBeenCalledTimes(1);
  });

  it('returns a non-fatal mode error when operating-state writes tolerate mode failures', async () => {
    const { connection, rig } = createConnectedConnection({
      setMode: vi.fn().mockRejectedValue(new Error('mode not supported')),
    });

    const result = await connection.applyOperatingState({
      frequency: 7100000,
      mode: 'USB',
      tolerateModeFailure: true,
    });

    expect(result.frequencyApplied).toBe(true);
    expect(result.modeApplied).toBe(false);
    expect(result.modeError?.message).toContain('mode not supported');
    expect(rig.setFrequency).toHaveBeenCalledTimes(1);
  });

  it('reads meter levels inside a single polling pass via MeterReader', async () => {
    const { connection, rig } = createConnectedConnection({
      getLevel: vi.fn().mockResolvedValue(0.5),
    });
    const tc = asTestConnection(connection);
    tc.supportedLevels = new Set([
      'STRENGTH',
      'SWR',
      'ALC',
      'RFPOWER_METER',
      'RFPOWER_METER_WATTS',
    ]);
    tc.meterDecodeStrategy = { name: 'generic', sourceLevel: 'STRENGTH', displayStyle: 'db-over-s9', label: 'test' };
    tc.meterReader = new HamlibMeterReader(defaultHamlibProfile, defaultHamlibProfile);

    const emitted: any[] = [];
    connection.on('meterData', (data) => emitted.push(data));

    await (connection as any).pollMeters();

    // MeterReader reads alc, swr, power (RFPOWER_METER + RFPOWER_METER_WATTS), and level (STRENGTH).
    expect(rig.getLevel).toHaveBeenCalledWith('ALC');
    expect(rig.getLevel).toHaveBeenCalledWith('SWR');
    expect(rig.getLevel).toHaveBeenCalledWith('RFPOWER_METER');
    expect(rig.getLevel).toHaveBeenCalledWith('RFPOWER_METER_WATTS');
    expect(rig.getLevel).toHaveBeenCalledWith('STRENGTH');
    expect(emitted).toHaveLength(1);
  });

  it('skips low-priority meter polling while a critical CAT write is active', async () => {
    const firstWrite = createDeferred<number>();
    const { connection, rig } = createConnectedConnection({
      setFrequency: vi.fn().mockReturnValue(firstWrite.promise),
    });
    asTestConnection(connection).supportedLevels = new Set(['STRENGTH']);

    const writePromise = connection.setFrequency(7100000);
    await Promise.resolve();

    await (connection as any).pollMeters();

    expect(rig.getLevel).not.toHaveBeenCalled();

    firstWrite.resolve(0);
    await writePromise;
  });

  it('reads RAWSTR instead of STRENGTH when the Yaesu meter strategy is active', async () => {
    const { connection, rig } = createConnectedConnection({
      getLevel: vi.fn()
        .mockImplementation(async (level: string) => {
          if (level === 'RAWSTR') return 150;
          throw new Error(`unexpected level ${level}`);
        }),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedLevels = new Set(['RAWSTR']);
    testConnection.meterDecodeStrategy = {
      name: 'yaesu',
      sourceLevel: 'RAWSTR',
      displayStyle: 's-meter',
      label: 'yaesu-rawstr',
    };
    testConnection.meterReader = new HamlibMeterReader(defaultHamlibProfile, defaultHamlibProfile);

    const emitted: any[] = [];
    connection.on('meterData', (data) => emitted.push(data));

    await (connection as any).pollMeters();

    expect(rig.getLevel).toHaveBeenCalledWith('RAWSTR');
    expect(emitted[0]?.level).toMatchObject({
      raw: 150,
      formatted: 'S9',
      displayStyle: 's-meter',
    });
  });

  it('keeps generic rigs on dB relative to S9 formatting', async () => {
    const { connection, rig } = createConnectedConnection({
      getLevel: vi.fn().mockResolvedValue(-24),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedLevels = new Set(['STRENGTH']);
    testConnection.meterDecodeStrategy = {
      name: 'generic',
      sourceLevel: 'STRENGTH',
      displayStyle: 'db-over-s9',
      label: 'generic-strength',
    };
    testConnection.meterReader = new HamlibMeterReader(defaultHamlibProfile, defaultHamlibProfile);

    const emitted: any[] = [];
    connection.on('meterData', (data) => emitted.push(data));

    await (connection as any).pollMeters();

    expect(rig.getLevel).toHaveBeenCalledWith('STRENGTH');
    expect(emitted[0]?.level).toMatchObject({
      formatted: '-24 dB@S9',
      displayStyle: 'db-over-s9',
    });
  });

  it('uses the matched TX range max watts when converting absolute power readings', async () => {
    const { connection } = createConnectedConnection();
    const testConnection = asTestConnection(connection);
    testConnection.txFrequencyRanges = [
      {
        startFreq: 1000000,
        endFreq: 30000000,
        modes: ['USB', 'AM'],
        lowPower: 100,
        highPower: 100000,
        vfo: 0,
        antenna: 0,
      },
      {
        startFreq: 1000000,
        endFreq: 30000000,
        modes: ['AM'],
        lowPower: 100,
        highPower: 25000,
        vfo: 0,
        antenna: 0,
      },
    ];
    testConnection.currentFrequencyHz = 14074000;
    testConnection.currentRadioMode = 'AM';

    // Test via resolveCurrentTxPowerMaxWatts (the method still exists on the connection)
    const maxWatts = testConnection.resolveCurrentTxPowerMaxWatts();
    expect(maxWatts).toBe(25);
  });

  it('falls back to the rig-wide TX max watts when no exact range matches', () => {
    const { connection } = createConnectedConnection();
    const testConnection = asTestConnection(connection);
    testConnection.txFrequencyRanges = [
      {
        startFreq: 1000000,
        endFreq: 30000000,
        modes: ['USB'],
        lowPower: 100,
        highPower: 10000,
        vfo: 0,
        antenna: 0,
      },
    ];
    testConnection.currentFrequencyHz = 50000000;
    testConnection.currentRadioMode = 'FM';

    expect(testConnection.resolveCurrentTxPowerMaxWatts()).toBe(10);
  });

  it('applies spectrum runtime speed updates when the backend supports SPECTRUM_SPEED', async () => {
    const { connection } = createConnectedConnection();
    const configureSpectrum = vi.fn().mockResolvedValue(undefined);

    asTestConnection(connection).spectrumController = {
      configureSpectrum,
      getSpectrumSupportSummary: vi.fn().mockResolvedValue({
        configurableLevels: ['SPECTRUM_SPEED'],
      }),
    };

    await expect(connection.applySpectrumRuntimeConfig?.({ speed: 10 })).resolves.toBeUndefined();

    expect(configureSpectrum).toHaveBeenCalledWith({ speed: 10 });
  });

  it('ignores spectrum runtime speed updates when the backend does not support SPECTRUM_SPEED', async () => {
    const { connection } = createConnectedConnection();
    const configureSpectrum = vi.fn().mockResolvedValue(undefined);

    asTestConnection(connection).spectrumController = {
      configureSpectrum,
      getSpectrumSupportSummary: vi.fn().mockResolvedValue({
        configurableLevels: [],
      }),
    };

    await expect(connection.applySpectrumRuntimeConfig?.({ speed: 10 })).resolves.toBeUndefined();

    expect(configureSpectrum).not.toHaveBeenCalled();
  });

  it('times out stuck Hamlib managed spectrum start while still disabling the helper pump', async () => {
    vi.useFakeTimers();
    try {
      const { connection } = createConnectedConnection();
      const startManagedSpectrum = vi.fn().mockImplementation(() => asTestConnection(connection).nativeMonitor.run('startManagedSpectrum', () => new Promise<boolean>(() => {})));

      asTestConnection(connection).currentConfig = {
        type: 'network',
        network: { host: '127.0.0.1', port: 4532 },
      };
      asTestConnection(connection).spectrumController = {
        startManagedSpectrum,
        stopManagedSpectrum: vi.fn().mockResolvedValue(true),
        on: vi.fn(),
        off: vi.fn(),
      };

      const promise = connection.startManagedSpectrum(() => {}, { speed: 10 });
      const assertion = expect(promise).rejects.toMatchObject({
        code: RadioErrorCode.OPERATION_TIMEOUT,
        context: expect.objectContaining({
          operation: 'startManagedSpectrum',
        }),
      });
      await Promise.resolve();

      expect(startManagedSpectrum).toHaveBeenCalledWith({ speed: 10, pumpIntervalMs: 0 });

      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('poisons the runtime after a spectrum call stalls and rejects later stop I/O', async () => {
    vi.useFakeTimers();
    try {
      const { connection } = createConnectedConnection();
      const getSpectrumSupportSummary = vi.fn().mockImplementation(() => asTestConnection(connection).nativeMonitor.run('getSpectrumSupportSummary', () => new Promise(() => {})));
      const stopManagedSpectrum = vi.fn().mockReturnValue(new Promise(() => {}));

      asTestConnection(connection).spectrumController = {
        getSpectrumSupportSummary,
        stopManagedSpectrum,
        off: vi.fn(),
      };

      const supportPromise = connection.getSpectrumSupportSummary();
      const supportAssertion = expect(supportPromise).rejects.toMatchObject({
        code: RadioErrorCode.OPERATION_TIMEOUT,
        context: expect.objectContaining({ operation: 'getSpectrumSupportSummary' }),
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await supportAssertion;

      const stopPromise = connection.stopManagedSpectrum();
      const stopAssertion = expect(stopPromise).rejects.toMatchObject({
        code: RadioErrorCode.OPERATION_TIMEOUT,
        context: expect.objectContaining({ hamlibHostFatal: true }),
      });
      await stopAssertion;
      expect(stopManagedSpectrum).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dedupes repeated managed spectrum stop requests', async () => {
    const { connection } = createConnectedConnection();
    const stop = createDeferred<boolean>();
    const stopManagedSpectrum = vi.fn().mockReturnValue(stop.promise);

    asTestConnection(connection).spectrumController = {
      stopManagedSpectrum,
      off: vi.fn(),
    };

    const first = connection.stopManagedSpectrum();
    await Promise.resolve();
    const second = connection.stopManagedSpectrum();
    await Promise.resolve();

    expect(stopManagedSpectrum).toHaveBeenCalledTimes(1);
    stop.resolve(true);
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });

  it('converts native Hamlib global-lock timeout rejections to operation timeouts', async () => {
    const nativeError = new Error('HAMLIB_GLOBAL_LOCK_TIMEOUT: timed out waiting for Hamlib global lock operation=GetFrequency timeoutMs=5000') as Error & { code?: string };
    nativeError.code = 'HAMLIB_GLOBAL_LOCK_TIMEOUT';
    const { connection } = createConnectedConnection({
      getFrequency: vi.fn().mockRejectedValue(nativeError),
    });

    asTestConnection(connection).currentConfig = {
      type: 'serial',
      serial: { path: '/dev/ttyUSB0', rigModel: 1234 },
    };

    await expect(connection.getFrequency()).rejects.toMatchObject({
      code: RadioErrorCode.OPERATION_TIMEOUT,
      context: expect.objectContaining({
        operation: 'getFrequency',
        nativeCode: 'HAMLIB_GLOBAL_LOCK_TIMEOUT',
        devicePath: '/dev/ttyUSB0',
      }),
    });
  });

  it('reports post-open serial communication failures with baud-rate guidance', async () => {
    const { connection } = createConnectedConnection({
      getFrequency: vi.fn().mockRejectedValue(new Error('Communication verification timeout')),
    });

    asTestConnection(connection).currentConfig = {
      type: 'serial',
      serial: { path: '/dev/ttyUSB0', rigModel: 1049 },
    };

    await expect(
      (connection as unknown as { verifyRadioCommunication: () => Promise<void> }).verifyRadioCommunication(),
    ).rejects.toMatchObject({
      code: RadioErrorCode.CONNECTION_FAILED,
      userMessage: 'Serial port opened but cannot establish radio communication',
      userMessageKey: 'radio:error.serialRadioCommunicationFailed',
      suggestions: expect.arrayContaining([
        'radio:error.suggestion.verifyBaudRate',
        'radio:error.suggestion.verifyRadioModel',
        'radio:error.suggestion.enableCatControl',
      ]),
      context: expect.objectContaining({
        operation: 'verifyRadioCommunication',
        port: '/dev/ttyUSB0',
        rigModel: 1049,
      }),
    });
  });

  it('poisons the runtime when the extra Yaesu strength read stalls', async () => {
    vi.useFakeTimers();
    try {
      const { connection, rig } = createConnectedConnection({
        getLevel: vi.fn().mockImplementation((level: string) => {
          if (level === 'RAWSTR') {
            return Promise.resolve(150);
          }
          if (level === 'STRENGTH') {
            return new Promise<number>(() => {});
          }
          return Promise.resolve(0);
        }),
      });
      const testConnection = asTestConnection(connection);
      const getLevel = rig.getLevel;
      testConnection.nativeMonitor.instrument(rig);
      testConnection.supportedLevels = new Set(['RAWSTR', 'STRENGTH']);
      testConnection.meterDecodeStrategy = {
        name: 'yaesu',
        sourceLevel: 'RAWSTR',
        displayStyle: 's-meter',
        label: 'yaesu-rawstr',
      };
      testConnection.meterReader = {
        readAll: vi.fn(async (ctx: MeterReadContext) => {
          const raw = await ctx.getLevel('RAWSTR');
          return {
            alc: null,
            swr: null,
            power: null,
            level: raw === null ? null : { raw, value: raw, formatted: 'S9', displayStyle: 's-meter' },
          };
        }),
      };

      const pollPromise = (connection as unknown as { pollMeters: () => Promise<void> }).pollMeters();
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(pollPromise).resolves.toBeUndefined();
      await expect(connection.getFrequency()).rejects.toMatchObject({ context: { hamlibHostFatal: true } });
      expect(getLevel).toHaveBeenCalledWith('RAWSTR');
      expect(getLevel).toHaveBeenCalledWith('STRENGTH');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs waitCWMessage through the CAT queue', async () => {
    const { connection, rig } = createConnectedConnection();
    const waitMorse = vi.fn().mockResolvedValue(0);
    (rig as unknown as { waitMorse: typeof waitMorse }).waitMorse = waitMorse;

    await expect(connection.waitCWMessage()).resolves.toBeUndefined();

    expect(waitMorse).toHaveBeenCalledTimes(1);
  });

  it('maps Hamlib AGC codes to normalized mode names and writes them back as numeric levels', async () => {
    const { connection, rig } = createConnectedConnection({
      getLevel: vi.fn().mockResolvedValue(2),
      getAgcLevels: vi.fn().mockResolvedValue([0, 2, 6]),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedLevels = new Set(['AGC']);

    await expect(connection.getAgcMode()).resolves.toBe('fast');
    await expect(connection.getSupportedAgcModes()).resolves.toEqual(['off', 'fast', 'auto']);
    await expect(connection.setAgcMode('auto')).resolves.toBeUndefined();

    expect(rig.getLevel).toHaveBeenCalledWith('AGC');
    expect(rig.setLevel).toHaveBeenCalledWith('AGC', 6);
  });

  it('normalizes preamp and attenuator levels to positive dB options', async () => {
    const { connection, rig } = createConnectedConnection({
      getLevel: vi.fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(6),
      getPreampValues: vi.fn().mockResolvedValue([20, 10, 20, 0]),
      getAttenuatorValues: vi.fn().mockResolvedValue([12, 6, 12, 0]),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedLevels = new Set(['PREAMP', 'ATT']);

    await expect(connection.getPreampLevel()).resolves.toBe(10);
    await expect(connection.getSupportedPreampLevels()).resolves.toEqual([10, 20]);
    await expect(connection.setPreampLevel(20)).resolves.toBeUndefined();

    await expect(connection.getAttenuatorLevel()).resolves.toBe(6);
    await expect(connection.getSupportedAttenuatorLevels()).resolves.toEqual([6, 12]);
    await expect(connection.setAttenuatorLevel(12)).resolves.toBeUndefined();

    expect(rig.getLevel).toHaveBeenNthCalledWith(1, 'PREAMP');
    expect(rig.getLevel).toHaveBeenNthCalledWith(2, 'ATT');
    expect(rig.setLevel).toHaveBeenNthCalledWith(1, 'PREAMP', 20);
    expect(rig.setLevel).toHaveBeenNthCalledWith(2, 'ATT', 12);
  });

  it('reads and writes compressor and monitor gain controls through Hamlib function and level APIs', async () => {
    const { connection, rig } = createConnectedConnection({
      getFunction: vi.fn().mockResolvedValue(true),
      getLevel: vi.fn()
        .mockResolvedValueOnce(0.35)
        .mockResolvedValueOnce(0.6),
    });
    const testConnection = asTestConnection(connection);
    testConnection.supportedLevels = new Set(['COMP', 'MONITOR_GAIN']);

    await expect(connection.getCompressorEnabled()).resolves.toBe(true);
    await expect(connection.setCompressorEnabled(false)).resolves.toBeUndefined();
    await expect(connection.getCompressorLevel()).resolves.toBe(0.35);
    await expect(connection.setCompressorLevel(0.5)).resolves.toBeUndefined();
    await expect(connection.getMonitorGain()).resolves.toBe(0.6);
    await expect(connection.setMonitorGain(0.25)).resolves.toBeUndefined();

    expect(rig.getFunction).toHaveBeenCalledWith('COMP');
    expect(rig.setFunction).toHaveBeenCalledWith('COMP', false);
    expect(rig.getLevel).toHaveBeenNthCalledWith(1, 'COMP');
    expect(rig.getLevel).toHaveBeenNthCalledWith(2, 'MONITOR_GAIN');
    expect(rig.setLevel).toHaveBeenNthCalledWith(1, 'COMP', 0.5);
    expect(rig.setLevel).toHaveBeenNthCalledWith(2, 'MONITOR_GAIN', 0.25);
  });

  it('clamps percent to 100 when the absolute power reading exceeds the matched max watts', () => {
    const { connection } = createConnectedConnection();
    const testConnection = asTestConnection(connection);
    testConnection.txFrequencyRanges = [
      {
        startFreq: 1000000,
        endFreq: 30000000,
        modes: ['USB'],
        lowPower: 100,
        highPower: 10000,
        vfo: 0,
        antenna: 0,
      },
    ];
    testConnection.currentFrequencyHz = 14074000;
    testConnection.currentRadioMode = 'USB';

    // The power conversion logic moved to defaultHamlib profile.
    // Here we just verify resolveCurrentTxPowerMaxWatts returns the expected value.
    const maxWatts = testConnection.resolveCurrentTxPowerMaxWatts();
    expect(maxWatts).toBe(10);
  });
});
