/** Numeric presentation matches WSJT-X: integer SNR and AF Hz; DT stays tenths. */
export function formatDecodedSnr(db: number | 'TX'): string {
  if (db === 'TX') return 'TX';
  return Number.isFinite(db) ? String(Math.round(db)) : '—';
}
export function formatDecodedAfHz(hz: number): string {
  return Number.isFinite(hz) ? String(Math.round(hz)) : '—';
}
export function formatDecodedDt(dt: number | '-'): string {
  return dt === '-' ? '-' : Number.isFinite(dt) ? dt.toFixed(1) : '—';
}
