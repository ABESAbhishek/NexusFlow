import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { globalTelemetryBroadcaster, type BroadcastPacket, type TelemetrySubscriptionFilter } from "./broadcaster.js";
import type { EnrichedTelemetryReading, ThresholdAlertEvent } from "./operators.js";

export interface WebSocketClientSession {
  id: string;
  socket: Duplex;
  connectedAt: Date;
  lastPingAt: Date;
  lastSeenSequence: number;
  filter: TelemetrySubscriptionFilter;
  isAlive: boolean;
}

export interface ClientInboundMessage {
  action: "subscribe" | "unsubscribe" | "ping" | "resume";
  filter?: TelemetrySubscriptionFilter;
  lastSequence?: number;
}

export interface StreamEnvelope<T = unknown> {
  sequence: number;
  type: "telemetry" | "alert" | "system" | "ack";
  topic: string;
  payload: T;
  timestamp: string;
}

const WS_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Native, zero-dependency, high-throughput RFC 6455 WebSocket distribution server (Member 3 - Week 3).
 * Provides low-latency telemetry streaming, multi-topic subscriptions, connection recovery with sequence replay,
 * and automatic heartbeat/dead connection eviction.
 */
export class TelemetryWebSocketServer extends EventEmitter {
  private readonly sessions = new Map<string, WebSocketClientSession>();
  private readonly sequenceBuffer: StreamEnvelope[] = [];
  private sequenceCounter = 0;
  private readonly maxBuffer: number;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(options: { maxBuffer?: number } = {}) {
    super();
    this.maxBuffer = options.maxBuffer ?? 500;
    this.bindBroadcaster();
  }

  /**
   * Attaches WebSocket upgrade handling to an existing Node.js HTTP server.
   */
  public attach(server: Server, path: string = "/ws/telemetry"): void {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== path) {
        return;
      }

      this.handleUpgrade(req, socket, head);
    });

    this.startHeartbeatMonitor();
  }

  /**
   * Performs standard RFC 6455 WebSocket Handshake
   */
  public handleUpgrade(req: IncomingMessage, socket: Duplex, head?: Buffer): WebSocketClientSession | null {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return null;
    }

    const acceptKey = createHash("sha1")
      .update(key + WS_MAGIC_STRING)
      .digest("base64");

    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "\r\n"
    ].join("\r\n");

    socket.write(responseHeaders);

    const clientId = `ws-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const session: WebSocketClientSession = {
      id: clientId,
      socket,
      connectedAt: new Date(),
      lastPingAt: new Date(),
      lastSeenSequence: 0,
      filter: {},
      isAlive: true
    };

    this.sessions.set(clientId, session);
    globalTelemetryBroadcaster.registerClient(clientId, session.filter);

    this.setupSocketListeners(session);

    // Send connection welcome envelope
    this.sendToSession(session, {
      sequence: ++this.sequenceCounter,
      type: "system",
      topic: "system/connection",
      payload: { clientId, status: "connected", timestamp: new Date().toISOString() },
      timestamp: new Date().toISOString()
    });

    this.emit("connection", session);
    return session;
  }

  private setupSocketListeners(session: WebSocketClientSession): void {
    const { socket, id } = session;

    socket.on("data", (buffer: Buffer) => {
      try {
        const message = this.decodeWebSocketFrame(buffer);
        if (!message) return;

        if (message.type === "ping") {
          session.lastPingAt = new Date();
          session.isAlive = true;
          this.sendFrame(session.socket, 0x0a, Buffer.alloc(0)); // Pong
          return;
        }

        if (message.type === "close") {
          this.terminateSession(id);
          return;
        }

        if (message.type === "text") {
          const parsed = JSON.parse(message.text) as ClientInboundMessage;
          this.handleClientMessage(session, parsed);
        }
      } catch (err) {
        this.emit("error", err, session);
      }
    });

    socket.on("close", () => {
      this.terminateSession(id);
    });

    socket.on("error", () => {
      this.terminateSession(id);
    });
  }

  private handleClientMessage(session: WebSocketClientSession, msg: ClientInboundMessage): void {
    switch (msg.action) {
      case "subscribe": {
        if (msg.filter) {
          session.filter = { ...session.filter, ...msg.filter };
          globalTelemetryBroadcaster.updateClientFilter(session.id, session.filter);
        }
        this.sendToSession(session, {
          sequence: ++this.sequenceCounter,
          type: "ack",
          topic: "system/subscription",
          payload: { status: "subscribed", filter: session.filter },
          timestamp: new Date().toISOString()
        });
        break;
      }

      case "resume": {
        // Recovery mechanism: Replay unacknowledged packets from the sequence buffer
        const requestedSeq = msg.lastSequence ?? session.lastSeenSequence;
        const missedPackets = this.sequenceBuffer.filter((env) => env.sequence > requestedSeq);

        for (const packet of missedPackets) {
          this.sendToSession(session, packet);
        }

        this.sendToSession(session, {
          sequence: ++this.sequenceCounter,
          type: "system",
          topic: "system/recovery",
          payload: { replayedCount: missedPackets.length, currentSequence: this.sequenceCounter },
          timestamp: new Date().toISOString()
        });
        break;
      }

      case "ping": {
        session.lastPingAt = new Date();
        session.isAlive = true;
        this.sendToSession(session, {
          sequence: ++this.sequenceCounter,
          type: "system",
          topic: "system/pong",
          payload: { serverTime: new Date().toISOString() },
          timestamp: new Date().toISOString()
        });
        break;
      }
    }
  }

  /**
   * Broadcasts a telemetry reading or alert envelope across all active WebSocket clients.
   */
  public broadcastEnvelope(type: "telemetry" | "alert", topic: string, payload: unknown): StreamEnvelope {
    const envelope: StreamEnvelope = {
      sequence: ++this.sequenceCounter,
      type,
      topic,
      payload,
      timestamp: new Date().toISOString()
    };

    this.recordEnvelope(envelope);

    for (const session of this.sessions.values()) {
      if (this.matchesFilter(payload, session.filter)) {
        this.sendToSession(session, envelope);
      }
    }

    return envelope;
  }

  private bindBroadcaster(): void {
    globalTelemetryBroadcaster.on("broadcast:telemetry", ({ packet }: { packet: BroadcastPacket<EnrichedTelemetryReading> }) => {
      this.broadcastEnvelope("telemetry", packet.topic, packet.payload);
    });

    globalTelemetryBroadcaster.on("broadcast:alert", ({ packet }: { packet: BroadcastPacket<ThresholdAlertEvent> }) => {
      this.broadcastEnvelope("alert", packet.topic, packet.payload);
    });
  }

  private sendToSession(session: WebSocketClientSession, envelope: StreamEnvelope): void {
    try {
      const payloadString = JSON.stringify(envelope);
      const payloadBuffer = Buffer.from(payloadString, "utf8");
      this.sendFrame(session.socket, 0x01, payloadBuffer);
      session.lastSeenSequence = envelope.sequence;
    } catch {
      this.terminateSession(session.id);
    }
  }

  private sendFrame(socket: Duplex, opcode: number, payload: Buffer): void {
    const length = payload.length;
    let header: Buffer;

    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode; // FIN bit + opcode
      header[1] = length; // Unmasked (server to client)
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    socket.write(Buffer.concat([header, payload]));
  }

  private decodeWebSocketFrame(buffer: Buffer): { type: "text" | "ping" | "close" | "other"; text: string } | null {
    if (buffer.length < 2) return null;

    const opcode = buffer[0]! & 0x0f;
    const isMasked = (buffer[1]! & 0x80) !== 0;
    let payloadLength = buffer[1]! & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      payloadLength = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      payloadLength = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }

    let mask: Buffer | undefined;
    if (isMasked) {
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    const payload = buffer.subarray(offset, offset + payloadLength);
    if (isMasked && mask) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4]!;
      }
    }

    if (opcode === 0x08) return { type: "close", text: "" };
    if (opcode === 0x09) return { type: "ping", text: "" };
    if (opcode === 0x01) return { type: "text", text: payload.toString("utf8") };

    return { type: "other", text: "" };
  }

  private recordEnvelope(envelope: StreamEnvelope): void {
    this.sequenceBuffer.push(envelope);
    if (this.sequenceBuffer.length > this.maxBuffer) {
      this.sequenceBuffer.shift();
    }
  }

  private matchesFilter(payload: unknown, filter: TelemetrySubscriptionFilter): boolean {
    if (!payload || typeof payload !== "object") return true;
    const p = payload as Record<string, unknown>;

    if (filter.deviceId && p["deviceId"] && p["deviceId"] !== filter.deviceId) return false;
    if (filter.metric && p["metric"] && String(p["metric"]).toLowerCase() !== filter.metric.toLowerCase()) return false;
    if (filter.location && p["location"] && p["location"] !== filter.location) return false;

    if (filter.minSeverity && p["severity"]) {
      const order: Record<string, number> = { info: 1, warning: 2, critical: 3 };
      if ((order[String(p["severity"])] ?? 0) < (order[filter.minSeverity] ?? 0)) {
        return false;
      }
    }

    return true;
  }

  public terminateSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    this.sessions.delete(id);
    globalTelemetryBroadcaster.unregisterClient(id);

    try {
      session.socket.destroy();
    } catch {
      // ignore socket termination exceptions
    }

    this.emit("disconnection", id);
  }

  public getSessionCount(): number {
    return this.sessions.size;
  }

  public getSessions(): WebSocketClientSession[] {
    return Array.from(this.sessions.values());
  }

  public getSequenceBuffer(): StreamEnvelope[] {
    return [...this.sequenceBuffer];
  }

  private startHeartbeatMonitor(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions.entries()) {
        if (!session.isAlive || now - session.lastPingAt.getTime() > 45000) {
          this.terminateSession(id);
        } else {
          session.isAlive = false;
          this.sendFrame(session.socket, 0x09, Buffer.alloc(0)); // Ping
        }
      }
    }, 15000);
  }

  public close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    for (const id of Array.from(this.sessions.keys())) {
      this.terminateSession(id);
    }
  }
}

export const globalWebSocketServer = new TelemetryWebSocketServer();
