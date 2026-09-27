import { createLogger } from '../../../../utils/logger.js';
import type { MeterProfile, MeterReadContext, MeterData } from '../types.js';
import type { CalPoint } from '../calibration.js';
import {
  linearRawToPercent,
  interpolateCalTable,
  rawstrToLevelMeterReading,
  YAESU_DEFAULT_SWR_CAL,
  YAESU_FTDX10_SWR_CAL,
  YAESU_HAMLIB_DEFAULT_ALC_CAL,
  YAESU_FT991_STR_CAL,
  YAESU_FTDX101D_STR_CAL,
  YAESU_DEFAULT_STR_CAL,
} from '../calibration.js';

const logger = createLogger('YaesuNewcatMeterProfile');

function normalizeModelName(modelName: string | null | undefined): string {
  return modelName?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '';
}

function isFtdx10(modelName: string | null | undefined): boolean {
  return normalizeModelName(modelName) === 'FTDX10';
}

/**
 * Parse a Yaesu meter command response into a raw 0-255 integer.
 *
 * Protocol examples:
 * - send "SM0;" → radio replies "SM0xxx;"
 * - send "RM4;" → radio replies "RM4xxx;" or "RM4xxxxxx;"
 *
 * The first three payload digits are the meter value (000-255).
 *
 * @param ctx     Runtime read context (provides sendRaw).
 * @param command Full CAT command string, e.g. "RM4;".
 * @param prefix  Expected response prefix, e.g. "RM4".
 * @returns Raw integer 0-255, or null on parse/communication failure.
 */
async function readYaesuMeterRaw(
  ctx: MeterReadContext,
  command: string,
  prefix: string,
): Promise<number | null> {
  try {
    const reply = await ctx.sendRaw(
      Buffer.from(command, 'ascii'),
      16,
      Buffer.from(';'),
    );

    const replyStr = reply.toString('ascii');
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const framePattern = new RegExp(`^${escapedPrefix}(\\d{3})(?:\\d{3})?$`);

    // A Yaesu response is one semicolon-terminated CAT frame. Be strict here:
    // accepting a prefix embedded in an echo, stale frame, or malformed payload
    // can silently turn unrelated serial data into a meter reading. Both the
    // three-digit and six-digit RM layouts are used by newcat radios; in the
    // latter layout the first three digits are the meter value.
    const frames = replyStr.split(';').map((frame) => frame.trim()).filter(Boolean);
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const match = framePattern.exec(frames[index]);
      if (!match) continue;

      const value = Number(match[1]);
      if (Number.isInteger(value) && value >= 0 && value <= 255) {
        return value;
      }
    }

    logger.debug('Yaesu meter response parse failed', { prefix, reply: replyStr });
    return null;
  } catch (error) {
    logger.debug(`Yaesu meter command failed: ${command}`, { error });
    return null;
  }
}

/**
 * Select the S-meter calibration table based on rig model name.
 * FT-991/891/710/950 share a 16-point table; FTDX-101 has its own 12-point table;
 * others fall back to the Hamlib default 11-point table.
 */
function selectStrCalTable(modelName: string | null | undefined): readonly CalPoint[] {
  if (!modelName) return YAESU_DEFAULT_STR_CAL;
  const upper = modelName.toUpperCase();
  if (upper.includes('FTDX-101') || upper.includes('FTDX101')) {
    return YAESU_FTDX101D_STR_CAL;
  }
  // FT-991, FT-891, FT-710, FT-950 share the same 16-point table
  if (upper.includes('FT-991') || upper.includes('FT991')
    || upper.includes('FT-891') || upper.includes('FT891')
    || upper.includes('FT-710') || upper.includes('FT710')
    || upper.includes('FT-950') || upper.includes('FT950')) {
    return YAESU_FT991_STR_CAL;
  }
  return YAESU_DEFAULT_STR_CAL;
}

/**
 * Select the SWR calibration table based on rig model name.
 * FTDX-10 / FT-710 / FTDX-101 share a tested 8-point table;
 * other newcat models use the default 5-point table.
 */
function selectSwrCalTable(modelName: string | null | undefined): readonly CalPoint[] {
  if (!modelName) return YAESU_DEFAULT_SWR_CAL;
  const upper = modelName.toUpperCase();
  if (upper.includes('FTDX-10') || upper.includes('FTDX10')
    || upper.includes('FT-710') || upper.includes('FT710')
    || upper.includes('FTDX-101') || upper.includes('FTDX101')) {
    return YAESU_FTDX10_SWR_CAL;
  }
  return YAESU_DEFAULT_SWR_CAL;
}

/**
 * Yaesu newcat meter profile — bypasses Hamlib's broken calibration
 * by sending raw RM CAT commands via sendRaw().
 *
 * Matches Yaesu rigs connected in serial mode that expose the RAWSTR
 * level (a newcat-specific indicator).
 *
 * ALC: All newcat models — RM4. FTDX-10 uses Hamlib's 0-64 full-scale
 * calibration; other models retain the established 0-255 mapping.
 * SWR: All newcat models — RM6 (raw 0-255), per-model interpolation table.
 * S-meter: FTDX-10 uses Hamlib's RAWSTR transaction first, then reads the
 * documented SM0 frame directly when the wrapper reports null or zero.
 */
export const yaesuNewcatProfile: MeterProfile = {
  name: 'yaesu-newcat',
  label: 'Yaesu newcat (raw RM commands)',
  priority: 10,

  matches(ctx): boolean {
    const isYaesu = ctx.manufacturer?.toUpperCase() === 'YAESU';
    const hasRawstr = ctx.supportedLevels.has('RAWSTR');
    const isSerial = ctx.connectionType === 'serial';
    return isYaesu && hasRawstr && isSerial;
  },

  async readAlc(ctx: MeterReadContext): Promise<MeterData['alc']> {
    const raw = await readYaesuMeterRaw(ctx, 'RM4;', 'RM4');
    if (raw === null) return null;

    // FTDX-10 has no model-specific alc_cal in Hamlib and therefore uses
    // Hamlib's default Yaesu 0..64 full-scale table. The old 0..255 mapping
    // under-reported this radio's ALC by roughly four times.
    const percent = isFtdx10(ctx.rigMetadata?.modelName)
      ? interpolateCalTable(raw, YAESU_HAMLIB_DEFAULT_ALC_CAL)
      : linearRawToPercent(raw);
    const alert = percent >= 100;
    return { raw, percent, alert };
  },

  async readSwr(ctx: MeterReadContext): Promise<MeterData['swr']> {
    const raw = await readYaesuMeterRaw(ctx, 'RM6;', 'RM6');
    if (raw === null) return null;

    // Interpolate raw → SWR ratio using per-model calibration table.
    const calTable = selectSwrCalTable(ctx.rigMetadata?.modelName);
    const swr = interpolateCalTable(raw, calTable);
    const alert = swr > 2.0;
    return { raw, swr, alert };
  },

  async readLevel(ctx: MeterReadContext): Promise<MeterData['level']> {
    if (!ctx.supportedLevels.has('RAWSTR')) return null;

    // Keep protocol parsing/retry on Hamlib's validated newcat transaction for
    // the normal path. Real-device logs show that the radio can return a
    // non-zero SM0 frame while the wrapped RAWSTR value still reaches JS as
    // zero, so bypass that wrapper and parse the same documented CAT frame as
    // the FTDX-10 fallback.
    const hamlibRawValue = await ctx.getLevel('RAWSTR');
    const directRawValue = isFtdx10(ctx.rigMetadata?.modelName)
      && (hamlibRawValue === null || hamlibRawValue === 0)
      ? await readYaesuMeterRaw(ctx, 'SM0;', 'SM0')
      : null;
    const rawValue = directRawValue ?? hamlibRawValue;
    if (rawValue === null) return null;

    // Per-model S-meter calibration using Hamlib-sourced tables.
    const calTable = selectStrCalTable(ctx.rigMetadata?.modelName);
    return rawstrToLevelMeterReading(rawValue, calTable, ctx.currentFrequencyHz);
  },

  // readPower — not overridden; falls back to defaultHamlib.
};
