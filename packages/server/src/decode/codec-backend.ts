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
    if(configured==='mfsk-native')return configured;
    // P9: the legacy decoder must not be selectable by a deployed server.
    // Reference comparisons are restricted to non-production environments.
    if(configured==='wsjtx-lib'){
      if(nodeEnvironment==='test'||nodeEnvironment==='development')return configured;
      throw new Error('Legacy wsjtx-lib codec is limited to development and test comparisons');
    }
    throw new Error(`Unknown TX5DR_CODEC_BACKEND: ${configured}`);
  }
  return nodeEnvironment==='test'?'wsjtx-lib':'mfsk-native';
}
