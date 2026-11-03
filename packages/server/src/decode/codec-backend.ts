/**
 * Runtime codec selection for the six-mode migration.
 * Production MUST use mfsk-core and fail closed if the binary is missing.
 * Legacy backend remains an explicit test/comparison path until P9 removal.
 */
export type Tx5drCodecBackend = 'mfsk-native'|'wsjtx-lib';
export function resolveCodecBackend(
  configured: string|undefined,
  nodeEnvironment: string|undefined,
): Tx5drCodecBackend {
  if(configured!==undefined && configured!==''){
    if(configured==='mfsk-native'||configured==='wsjtx-lib')return configured;
    throw new Error(`Unknown TX5DR_CODEC_BACKEND: ${configured}`);
  }
  return nodeEnvironment==='test'?'wsjtx-lib':'mfsk-native';
}
