import { createQsoDraftStore } from './qsoDraftStore';

/** Separate JTTY QSO draft; shared only with JTTY terminal, macros and logger. */
export const jttyQsoDraftStore = createQsoDraftStore({
  hisCallsign: '',
  trst: '599',
  rrst: '599',
});
export const useJttyQSODraft = jttyQsoDraftStore.useDraft;
