import type { BrainstormSegment } from "@pemie/shared";

type Token = { accessToken: string; expiresIn: number };
type RecorderOptions = {
  token: () => Promise<Token>;
  appendSegments: (segments: Array<Omit<BrainstormSegment, "id" | "sessionId">>) => Promise<unknown>;
  extract: () => Promise<unknown>;
  onError?: (message: string) => void;
};

type DeepgramMessage = { is_final?: boolean; channel?: { alternatives?: Array<{ transcript?: string; words?: Array<{ start?: number; end?: number; speaker?: number }> }> } };

const STT_URL = "wss://api.deepgram.com/v1/listen?model=nova-3&language=multi&diarize=true&punctuate=true&smart_format=true&interim_results=true";

/** Un único MediaRecorder alimenta Deepgram y conserva los mismos chunks para el audio final. */
export class BrainstormRecorder {
  private media: MediaRecorder | null = null;
  private socket: WebSocket | null = null;
  private chunks: Blob[] = [];
  private pending: Array<Omit<BrainstormSegment, "id" | "sessionId">> = [];
  private sequence = 0;
  private segmentsTimer: number | null = null;
  private extractTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private stopped = false;
  private reconnectAttempt = 0;

  constructor(private readonly options: RecorderOptions) {}

  async start(stream: MediaStream) {
    this.stopped = false;
    this.media = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    this.media.ondataavailable = (event) => {
      if (!event.data.size) return;
      this.chunks.push(event.data);
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(event.data);
    };
    this.media.start(250);
    await this.connect();
    this.segmentsTimer = window.setInterval(() => void this.flushSegments(), 5_000);
    this.extractTimer = window.setInterval(() => void this.options.extract().catch(() => undefined), 25_000);
  }

  async stop(): Promise<Blob> {
    this.stopped = true;
    if (this.segmentsTimer) window.clearInterval(this.segmentsTimer);
    if (this.extractTimer) window.clearInterval(this.extractTimer);
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    if (this.media && this.media.state !== "inactive") await new Promise<void>((resolve) => {
      this.media!.addEventListener("stop", () => resolve(), { once: true });
      this.media!.stop();
    });
    await this.flushSegments();
    const audio = new Blob(this.chunks, { type: "audio/webm;codecs=opus" });
    return audio;
  }

  private async connect() {
    try {
      const { accessToken } = await this.options.token();
      // Deepgram exige bearer para un JWT efímero; token aplica únicamente a API keys largas.
      const socket = new WebSocket(STT_URL, ["bearer", accessToken]);
      this.socket = socket;
      socket.onopen = () => { this.reconnectAttempt = 0; };
      socket.onmessage = (event) => this.readTranscript(event.data);
      socket.onclose = () => this.scheduleReconnect();
      socket.onerror = () => socket.close();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt++, 15_000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private readTranscript(raw: unknown) {
    if (typeof raw !== "string") return;
    const message = JSON.parse(raw) as DeepgramMessage;
    if (!message.is_final) return;
    const alternative = message.channel?.alternatives?.[0];
    const text = alternative?.transcript?.trim();
    const words = alternative?.words ?? [];
    if (!text || !words.length) return;
    const first = words[0]!;
    const last = words[words.length - 1]!;
    this.pending.push({
      seq: this.sequence++, text,
      speakerTag: first.speaker ?? null,
      startMs: Math.round((first.start ?? 0) * 1_000),
      endMs: Math.round((last.end ?? first.start ?? 0) * 1_000),
    });
  }

  private async flushSegments() {
    if (!this.pending.length) return;
    const batch = this.pending.splice(0);
    try { await this.options.appendSegments(batch); }
    catch (error) {
      this.pending.unshift(...batch);
      this.options.onError?.(error instanceof Error ? error.message : "No se pudo guardar la transcripción");
    }
  }
}
