// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RtcDataAudioClient } from '../RtcDataAudioClient';

class MockSignalSocket {
  static OPEN = 1;
  url: string;
  readyState = 1;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  constructor(url: string) { this.url = url; sockets.push(this); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

class MockPeer {
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  onicecandidate: ((event: { candidate: null }) => void) | null = null;
  ondatachannel: ((event: { channel: MockChannel }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    await Promise.resolve();
    this.remoteDescription = description;
  });
  addIceCandidate = vi.fn(async (_candidate: RTCIceCandidateInit) => {
    if (!this.remoteDescription) throw new Error('remote SDP not set');
  });
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'v=0' }));
  setLocalDescription = vi.fn(async () => undefined);
  close() { this.connectionState = 'closed'; }
  constructor() { peers.push(this); }
}

class MockChannel {
  readyState: RTCDataChannelState = 'open';
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  send = vi.fn();
  close() { this.readyState = 'closed'; this.onclose?.(); }
}

const sockets: MockSignalSocket[] = [];
const peers: MockPeer[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  sockets.length = 0;
  peers.length = 0;
});

function makeClient(onClose = vi.fn()) {
  vi.stubGlobal('WebSocket', MockSignalSocket);
  vi.stubGlobal('RTCPeerConnection', MockPeer);
  return { client: new RtcDataAudioClient({
    offer: {
      transport: 'rtc-data-audio', direction: 'recv',
      url: 'ws://radio.example.test/api/realtime/rtc-data-audio',
      token: 'session-token', participantIdentity: null, participantName: null,
    },
    onClose,
  }), onClose };
}

describe('RtcDataAudioClient signaling', () => {
  it('buffers trickle ICE received before the offer and drains after remote SDP', async () => {
    const { client } = makeClient();
    const connected = client.connect();
    const socket = sockets[0]!;
    socket.receive({ type: 'candidate', candidate: 'candidate:1 1 udp 1 192.0.2.1 50110 typ host', mid: '0' });
    socket.receive({ type: 'offer', sdp: 'v=0', sdpType: 'offer' });

    await vi.waitFor(() => expect(peers[0]?.addIceCandidate).toHaveBeenCalledTimes(1));
    expect(peers[0]!.remoteDescription?.type).toBe('offer');
    expect(socket.send).toHaveBeenCalled();
    const channel = new MockChannel();
    peers[0]!.ondatachannel?.({ channel });
    channel.onopen?.();
    await expect(connected).resolves.toBeUndefined();
    client.close();
  });

  it('reports established peer failure once and tears down the transport', async () => {
    const { client, onClose } = makeClient();
    const connected = client.connect();
    const socket = sockets[0]!;
    socket.receive({ type: 'offer', sdp: 'v=0', sdpType: 'offer' });
    await vi.waitFor(() => expect(peers[0]?.createAnswer).toHaveBeenCalledTimes(1));
    const channel = new MockChannel();
    peers[0]!.ondatachannel?.({ channel });
    channel.onopen?.();
    await connected;
    peers[0]!.connectionState = 'failed';
    peers[0]!.onconnectionstatechange?.();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(client.isOpen).toBe(false);
  });
});
