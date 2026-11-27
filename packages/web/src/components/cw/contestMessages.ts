export interface CQWWMessageContext {
  stationCall: string;
  hisCall: string;
  sentZone: string;
  run: boolean;
}
export function cqwwMessages(context: CQWWMessageContext): Array<{ key: string; text: string }> {
  const station = context.stationCall.trim().toUpperCase();
  const his = context.hisCall.trim().toUpperCase();
  const validCall = (value: string) => /^[A-Z0-9/]{3,20}$/.test(value) && /[0-9]/.test(value) && /[A-Z]/.test(value);
  const zone = context.sentZone.trim();
  const exchange = /^\d{1,2}$/.test(zone) && Number(zone) >= 1 && Number(zone) <= 40 ? '5NN ' + Number(zone) : '';
  const own = validCall(station) ? station : '';
  const other = validCall(his) ? his : '';
  return [
    { key: 'F1', text: own ? (context.run ? 'CQ TEST ' + own + ' ' + own + ' TEST' : own) : '' },
    { key: 'F2', text: exchange && (!context.run || other) ? (context.run ? other + ' ' : '') + exchange : '' },
    { key: 'F3', text: context.run ? (own ? 'TU ' + own : '') : 'TU' },
    { key: 'F4', text: own },
    { key: 'F5', text: other },
    { key: 'F6', text: 'AGN' },
    { key: 'F7', text: 'ZONE?' },
    { key: 'F8', text: 'NR?' },
    { key: 'F9', text: '?' },
    { key: 'F10', text: 'QRS' },
    { key: 'F11', text: 'QRZ' },
    { key: 'F12', text: 'TEST' },
  ];
}
