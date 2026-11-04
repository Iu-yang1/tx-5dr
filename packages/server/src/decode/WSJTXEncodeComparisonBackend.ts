/**
 * Test/development-only comparison encoder.
 * Production package assembly removes this compiled module entirely.
 * It must never be present beside a production server or Electron runtime.
 */
import {WSJTXLib,WSJTXMode} from 'wsjtx-lib';

export function createLegacyEncodeBackend(maxThreads:number){
  return {
    lib:new WSJTXLib({maxThreads}),
    enums:WSJTXMode,
  };
}
