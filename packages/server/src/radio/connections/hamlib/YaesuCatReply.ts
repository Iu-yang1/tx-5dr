/**
 * Parse a single numeric Yaesu CAT response without accepting a partial frame,
 * a different command, or ambiguous duplicate replies.
 *
 * This is validation, not a transport transaction boundary: a late reply
 * using the same command prefix still needs native I/O correlation.
 */
export function parseSingleYaesuNumericReply(reply: Buffer, prefix: string): number | null {
  if (!/^EX[0-9]+$/.test(prefix)) return null;
  const wire = reply.toString('ascii').replace(/\x00+$/g, '');
  if (!wire.endsWith(';')) return null;

  // A reply containing any other frame is not an unambiguous acknowledgement.
  // Never fish the expected EX response out of a contaminated native read.
  const frames = wire.slice(0, -1).split(';');
  if (frames.length !== 1 || !frames[0]!.startsWith(prefix)) return null;

  const suffix = frames[0]!.slice(prefix.length);
  if (!/^[0-9]$/.test(suffix)) return null;
  return Number(suffix);
}
