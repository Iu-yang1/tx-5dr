import { describe, expect, it, vi } from 'vitest';
import { createSocket } from 'node:dgram';
import { N1MMContestReceiver, parseN1MMFlatXml } from './N1MMContestReceiver.js';
function receiver() { return new N1MMContestReceiver({ enabled: false, bind: '127.0.0.1', port: 12060, stationCall: 'BG8GLR' }); }
const qso = (kind = 'contactinfo', call = 'JA1ABC') => '<' + kind + '><app>N1MM</app><contestname>CQWWCW</contestname><contestnr>3</contestnr><mycall>BG8GLR</mycall><ID>abc</ID><timestamp>2026-11-28 01:01:01</timestamp><call>' + call + '</call><mode>CW</mode><rxfreq>1402500</rxfreq><band>14</band><zone>25</zone><SentExchange>24</SentExchange></' + kind + '>';
describe('N1MM passive contest projection', () => {
  it('converts 10 Hz values, updates and deduplicates by QSO identity', () => {
    const r = receiver(); r.ingest(qso()); r.ingest(qso());
    expect(r.snapshot().observedContacts).toBe(1);
    expect(r.snapshot().contacts[0]).toMatchObject({ frequencyHz: 14025000, zoneReceived: '25', zoneSent: '24' });
    r.ingest(qso('contactreplace', 'JA2ABC'));
    expect(r.snapshot().contacts[0].call).toBe('JA2ABC');
    r.ingest('<contactdelete><app>N1MM</app><mycall>BG8GLR</mycall><contestnr>3</contestnr><ID>abc</ID></contactdelete>');
    expect(r.snapshot().contacts).toEqual([]);
  });
  it('accepts RadioInfo without treating it as physical TX state or a QSO', () => {
    const r = receiver();
    r.ingest('<?xml version="1.0"?><RadioInfo><app>N1MM</app><mycall>BG8GLR</mycall><OpCall>BG5JSU</OpCall><Mode>CW</Mode><Freq>702500</Freq><IsRunning>True</IsRunning><RadioNr>1</RadioNr><Rotors /></RadioInfo>', 123);
    expect(r.snapshot().radio).toMatchObject({ operator: 'BG5JSU', frequencyHz: 7025000, running: true, receivedAt: 123 });
    expect(r.snapshot().contacts).toEqual([]);
  });
  it('rejects foreign station/contest and dangerous or malformed XML', () => {
    const r = receiver();
    r.ingest(qso().replace('BG8GLR', 'BG1ABC')); r.ingest(qso().replace('CQWWCW', 'CQWPX'));
    expect(r.snapshot().contacts).toEqual([]);
    expect(parseN1MMFlatXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///x">]><x><app>N1MM</app></x>')).toBeUndefined();
    expect(parseN1MMFlatXml('<x><app>N1MM</app><app>N1MM</app></x>')).toBeUndefined();
  });
});

describe('N1MM UDP transport', () => {
  it('receives a real localhost datagram and distinguishes local radio from team contacts', async () => {
    const r = new N1MMContestReceiver({ enabled: true, bind: '127.0.0.1', port: 0, stationCall: 'BG8GLR', stationName: 'JVM-PC' });
    const sender = createSocket('udp4');
    r.start();
    try {
      await vi.waitFor(() => expect(r.snapshot().listening).toBe(true));
      const send = (xml: string) => new Promise<void>((resolve, reject) => {
        sender.send(Buffer.from(xml), r.snapshot().port, '127.0.0.1', error => error ? reject(error) : resolve());
      });
      await send(qso());
      await vi.waitFor(() => expect(r.snapshot().observedContacts).toBe(1));
      const radio = (name: string, freq: string) => '<RadioInfo><app>N1MM</app><mycall>BG8GLR</mycall><StationName>' + name + '</StationName><Mode>CW</Mode><Freq>' + freq + '</Freq></RadioInfo>';
      await send(radio('JVM-PC', '1402500'));
      await vi.waitFor(() => expect(r.snapshot().radio?.frequencyHz).toBe(14025000));
      await send(radio('OTHER-PC', '702500'));
      await send(qso('contactreplace', 'JA2ABC'));
      await vi.waitFor(() => expect(r.snapshot().contacts[0]?.call).toBe('JA2ABC'));
      expect(r.snapshot().radio?.frequencyHz).toBe(14025000);
    } finally {
      sender.close(); r.close();
    }
  });
});
