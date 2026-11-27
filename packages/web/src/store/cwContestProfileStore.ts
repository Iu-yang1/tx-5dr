import { useSyncExternalStore } from 'react';
type Profile = { active: boolean; stationCall: string; sentZone: string; receivedZone: string; run: boolean };
function read(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
let state: Profile = { active: false, receivedZone: '', stationCall: read('tx5dr_cqww_station_call', ''), sentZone: read('tx5dr_cqww_sent_zone', ''), run: read('tx5dr_cqww_run', 'true') === 'true' };
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function updateCWContestProfile(patch: Partial<Profile>): void {
  const next = { ...state, ...patch };
  if (Object.keys(patch).every(key => next[key as keyof Profile] === state[key as keyof Profile])) return;
  state = next;
  try {
    localStorage.setItem('tx5dr_cqww_station_call', state.stationCall);
    localStorage.setItem('tx5dr_cqww_sent_zone', state.sentZone);
    localStorage.setItem('tx5dr_cqww_run', String(state.run));
  } catch { /* optional browser storage */ }
  listeners.forEach(fn => fn());
}
export const useCWContestProfile = () => useSyncExternalStore(subscribe, () => state);
