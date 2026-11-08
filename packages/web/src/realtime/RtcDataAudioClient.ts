import type { RealtimeScope, RealtimeSessionDirection, RealtimeTransportOffer, RealtimeIceServerConfig } from '@tx5dr/contracts';
import { createLogger } from '../utils/logger';
import { normalizeWsUrl } from '../utils/config';

const logger = createLogger('RtcDataAudioClient');
const RTC_DATA_AUDIO_LOCAL_CONNECT_TIMEOUT_MS = 5000;
const RTC_DATA_AUDIO_PUBLIC_CONNECT_TIMEOUT_MS = 8000;
const RTC_DATA_AUDIO_TURN_CONNECT_TIMEOUT_MS = 12000;
const RTC_DATA_AUDIO_DEFAULT_STUN = 'stun:stun.l.google.com:19302';

interface RtcDataAudioClientOptions {
  offer: RealtimeTransportOffer;
  iceServers?: Array<string | RealtimeIceServerConfig>;
  onBinaryMessage?: (payload: ArrayBuffer) => void;
  onControlMessage?: (payload: unknown) => void;
  onClose?: () => void;
}

type SignalMessage = {
  type?: string;
  sdp?: string;
  sdpType?: RTCSdpType;
  candidate?: string;
  mid?: string;
  transport?: string;
  direction?: RealtimeSessionDirection;
  scope?: RealtimeScope;
  participantIdentity?: string | null;
};

export class RtcDataAudioClient {
  private readonly offer: RealtimeTransportOffer;
  private readonly iceServers: RTCIceServer[];
  private readonly onBinaryMessage?: (payload: ArrayBuffer) => void;
  private readonly onControlMessage?: (payload: unknown) => void;
  private readonly onClose?: () => void;
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private intentionallyClosed = false;
  private ready = false;
  private connectPromise: Promise<void> | null = null;
  private rejectPendingConnect: ((error: Error) => void) | null = null;
  private signalQueue: Promise<void> = Promise.resolve();
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private disconnectTimer: number | null = null;
  private closeNotified = false;

  constructor(options: RtcDataAudioClientOptions) {
    this.offer = options.offer;
    this.iceServers = (options.iceServers?.filter(Boolean) ?? [RTC_DATA_AUDIO_DEFAULT_STUN]).map(
      (entry) => typeof entry === 'string' ? { urls: entry } : entry,
    );
    this.onBinaryMessage = options.onBinaryMessage;
    this.onControlMessage = options.onControlMessage;
    this.onClose = options.onClose;
  }

  get bufferedAmount(): number | null {
    return this.dataChannel?.bufferedAmount ?? null;
  }

  get isOpen(): boolean {
    return this.dataChannel?.readyState === 'open';
  }

  async connect(): Promise<void> {
    if (this.ready) return;
    if (this.intentionallyClosed) throw new Error('rtc-data-audio client is closed');
    if (this.connectPromise) return this.connectPromise;
    const pending = this.connectInternal();
    this.connectPromise = pending;
    try {
      await pending;
    } finally {
      if (this.connectPromise === pending) this.connectPromise = null;
    }
  }

  private async connectInternal(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${normalizeWsUrl(this.offer.url)}?token=${encodeURIComponent(this.offer.token)}`);
      this.socket = socket;
      let settled = false;

      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(
            'rtc-data-audio timed out before DataChannel opened: '
            + `webSocket=${socket.readyState},ice=${this.peer?.iceConnectionState || 'not-created'}`,
          ));
          this.close();
        }
      }, this.iceServers.some((server) =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => url.startsWith('turn'))
      ) ? RTC_DATA_AUDIO_TURN_CONNECT_TIMEOUT_MS
        : (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
          ? RTC_DATA_AUDIO_LOCAL_CONNECT_TIMEOUT_MS
          : RTC_DATA_AUDIO_PUBLIC_CONNECT_TIMEOUT_MS));

      const settleResolve = () => {
        if (settled) return;
        settled = true;
        this.rejectPendingConnect = null;
        this.ready = true;
        window.clearTimeout(timer);
        resolve();
      };
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        this.rejectPendingConnect = null;
        window.clearTimeout(timer);
        reject(error);
        this.close();
      };

      this.rejectPendingConnect = settleReject;
      const handleFailure = (error: Error) => {
        if (!settled) settleReject(error);
        else this.notifyDisconnected(error);
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          return;
        }
        let message: SignalMessage;
        try {
          message = JSON.parse(event.data) as SignalMessage;
        } catch (error) {
          settleReject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        // WebSocket onmessage does not await async callbacks. Serialize SDP and ICE.
        this.signalQueue = this.signalQueue
          .then(() => this.intentionallyClosed ? undefined : this.handleSignalMessage(message, settleResolve, handleFailure))
          .catch((error) => handleFailure(error instanceof Error ? error : new Error(String(error))));
      };
      socket.onerror = () => {
        settleReject(new Error('rtc-data-audio signaling WebSocket failed'));
      };
      socket.onclose = () => {
        if (!this.intentionallyClosed && !settled) {
          settleReject(new Error('rtc-data-audio signaling closed before ready'));
        } else if (!this.intentionallyClosed) {
          this.notifyDisconnected(new Error('rtc-data-audio signaling closed'));
        }
      };
    });
  }

  sendBinary(payload: ArrayBuffer | Uint8Array): boolean {
    const channel = this.dataChannel;
    if (!channel || channel.readyState !== 'open') {
      return false;
    }
    channel.send(payload);
    return true;
  }

  sendJson(payload: Record<string, unknown>): boolean {
    const channel = this.dataChannel;
    if (!channel || channel.readyState !== 'open') {
      return false;
    }
    channel.send(JSON.stringify(payload));
    return true;
  }

  close(): void {
    if (this.intentionallyClosed) return;
    this.intentionallyClosed = true;
    this.ready = false;
    const rejectPending = this.rejectPendingConnect;
    this.rejectPendingConnect = null;
    rejectPending?.(new Error('rtc-data-audio connection cancelled'));
    this.pendingCandidates.length = 0;
    if (this.disconnectTimer !== null) {
      window.clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    try {
      this.dataChannel?.close();
    } catch {
      // ignore
    }
    try {
      this.peer?.close();
    } catch {
      // ignore
    }
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.dataChannel = null;
    this.peer = null;
    this.socket = null;
  }

  private notifyDisconnected(error: Error): void {
    if (this.intentionallyClosed || this.closeNotified) return;
    this.closeNotified = true;
    logger.warn('rtc-data-audio transport disconnected', { reason: error.message });
    this.close();
    this.onClose?.();
  }

  private async handleSignalMessage(
    message: SignalMessage,
    onReady: () => void,
    onFailure: (error: Error) => void,
  ): Promise<void> {
    if (message.type === 'offer' && message.sdp) {
      await this.handleOffer(message.sdp, message.sdpType ?? 'offer', onReady, onFailure);
      return;
    }
    if (message.type === 'candidate' && message.candidate) {
      const candidate = { candidate: message.candidate, sdpMid: message.mid ?? '0' };
      if (!this.peer?.remoteDescription) {
        if (this.pendingCandidates.length >= 128) throw new Error('rtc-data-audio ICE candidate queue overflow');
        this.pendingCandidates.push(candidate);
      } else {
        await this.peer.addIceCandidate(candidate);
      }
      return;
    }
    if (message.type === 'ready' && this.dataChannel?.readyState === 'open') {
      onReady();
    }
  }

  private async handleOffer(
    sdp: string,
    type: RTCSdpType,
    onReady: () => void,
    onFailure: (error: Error) => void,
  ): Promise<void> {
    if (!this.peer) {
      this.peer = this.createPeerConnection(onReady, onFailure);
    }
    await this.peer.setRemoteDescription({ type, sdp });
    for (const candidate of this.pendingCandidates.splice(0)) {
      await this.peer.addIceCandidate(candidate);
    }
    const answer = await this.peer.createAnswer();
    await this.peer.setLocalDescription(answer);
    this.sendSignal({ type: 'answer', sdp: answer.sdp, sdpType: answer.type });
  }

  private createPeerConnection(onReady: () => void, onFailure: (error: Error) => void): RTCPeerConnection {
    const peer = new RTCPeerConnection({
      iceServers: this.iceServers.length > 0
        ? this.iceServers
        : [{ urls: RTC_DATA_AUDIO_DEFAULT_STUN }],
    });
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: 'candidate',
          candidate: event.candidate.candidate,
          mid: event.candidate.sdpMid ?? '0',
        });
      }
    };
    peer.ondatachannel = (event) => {
      this.bindDataChannel(event.channel, onReady);
    };
    peer.onconnectionstatechange = () => {
      if (this.intentionallyClosed) return;
      if (peer.connectionState === 'connected') {
        if (this.disconnectTimer !== null) window.clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      } else if (peer.connectionState === 'disconnected' && this.ready && this.disconnectTimer === null) {
        this.disconnectTimer = window.setTimeout(() => {
          this.disconnectTimer = null;
          if (peer.connectionState === 'disconnected') onFailure(new Error('rtc-data-audio peer disconnected'));
        }, 3000);
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        onFailure(new Error(`rtc-data-audio peer connection ${peer.connectionState}`));
      }
    };
    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === 'failed' && !this.intentionallyClosed) {
        onFailure(new Error('rtc-data-audio ICE connection failed'));
      }
    };
    return peer;
  }

  private bindDataChannel(channel: RTCDataChannel, onReady: () => void): void {
    this.dataChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      onReady();
    };
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.onBinaryMessage?.(event.data);
      } else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buffer) => this.onBinaryMessage?.(buffer));
      } else if (typeof event.data === 'string') {
        try {
          this.onControlMessage?.(JSON.parse(event.data));
        } catch (error) {
          logger.debug('Failed to decode rtc-data-audio control message', error);
        }
      }
    };
    channel.onclose = () => {
      if (!this.intentionallyClosed) this.notifyDisconnected(new Error('rtc-data-audio DataChannel closed'));
    };
    channel.onerror = () => {
      logger.warn('rtc-data-audio data channel error');
    };
  }

  private sendSignal(payload: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }
}
