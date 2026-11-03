/** Prevent a second native decoder from silently diverging from the
 * existing RadioControl mode selection and the main engine lifecycle.
 * The native AF receiver is a subresource, not an independent radio. */
export function assertNativeLiveModeAdmission(
  requested:string,current:string,isRunning:boolean,
):void {
  if(!['Q65','WSPR','MSK144','JTTY'].includes(current) || requested!==current){
    throw new Error('Select the matching native mode in the existing radio mode control');
  }
  if(!isRunning){
    throw new Error('Start the main radio engine before changing native RX settings');
  }
}
