import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { EnrichedTelemetryReading, ThresholdAlertEvent } from "./operators.js";

export interface TelemetrySubscriptionFilter {
  deviceId?: string;
  metric?: string;
  location?: string;
  minSeverity?: "info" | "warning" | "critical";
}

export interface ClientConnectionInfo {
  id: string;
  connectedAt: Date;
  lastPingAt: Date;
  filter: TelemetrySubscriptionFilter;
}

export type BroadcasterEventType = "telemetry" | "alert" | "system";

export interface BroadcastPacket<T = unknown> {
  type: BroadcasterEventType;
  topic: string;
  payload: T;
  timestamp: string;
}

/**
 * Event-driven telemetry distributor and WebSocket / SSE subscription hub (Member 3 - Week 3 Foundation).
 * Supports channel filtering, heartbeats, automatic reconnection grace periods, and event tracking.
 */
export class TelemetryBroadcaster extends EventEmitter {
  private readonly clients = new Map<string, ClientConnectionInfo>();
  private readonly messageHistory: BroadcastPacket[] = [];
  private readonly maxHistory: number;

  constructor(options: { maxHistory?: number } = {}) {
    super();
    this.maxHistory = options.maxHistory ?? 100;
  }

  /**
   * Register a new subscriber with customized topic filters
   */
  public registerClient(
    clientId: string,
    initialFilter: TelemetrySubscriptionFilter = {}
  ): ClientConnectionInfo {
    const clientInfo: ClientConnectionInfo = {
      id: clientId,
      connectedAt: new Date(),
      lastPingAt: new Date(),
      filter: initialFilter
    };
    this.clients.set(clientId, clientInfo);
    this.emit("client_connected", clientInfo);
    return clientInfo;
  }

  /**
   * Update client filters dynamically
   */
  public updateClientFilter(
    clientId: string,
    newFilter: Partial<TelemetrySubscriptionFilter>
  ): ClientConnectionInfo | undefined {
    const client = this.clients.get(clientId);
    if (!client) return undefined;

    client.filter = { ...client.filter, ...newFilter };
    this.emit("filter_updated", client);
    return client;
  }

  /**
   * Remove a disconnected client
   */
  public unregisterClient(clientId: string): boolean {
    const existed = this.clients.delete(clientId);
    if (existed) {
      this.emit("client_disconnected", clientId);
    }
    return existed;
  }

  /**
   * Heartbeat to keep connection alive and detect timeouts
   */
  public recordHeartbeat(clientId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;
    client.lastPingAt = new Date();
    return true;
  }

  /**
   * Broadcast enriched telemetry reading to eligible subscribers
   */
  public broadcastTelemetry(reading: EnrichedTelemetryReading): number {
    const packet: BroadcastPacket<EnrichedTelemetryReading> = {
      type: "telemetry",
      topic: `telemetry/${reading.deviceId}/${reading.metric}`,
      payload: reading,
      timestamp: new Date().toISOString()
    };
    this.recordPacket(packet);

    let deliveredCount = 0;
    for (const client of this.clients.values()) {
      if (this.matchesTelemetryFilter(reading, client.filter)) {
        this.emit(`send:${client.id}`, packet);
        deliveredCount++;
      }
    }

    this.emit("broadcast:telemetry", { packet, deliveredCount });
    return deliveredCount;
  }

  /**
   * Broadcast alert event to eligible subscribers based on severity & filters
   */
  public broadcastAlert(alert: ThresholdAlertEvent): number {
    const packet: BroadcastPacket<ThresholdAlertEvent> = {
      type: "alert",
      topic: `alerts/${alert.deviceId}/${alert.metric}`,
      payload: alert,
      timestamp: new Date().toISOString()
    };
    this.recordPacket(packet);

    let deliveredCount = 0;
    for (const client of this.clients.values()) {
      if (this.matchesAlertFilter(alert, client.filter)) {
        this.emit(`send:${client.id}`, packet);
        deliveredCount++;
      }
    }

    this.emit("broadcast:alert", { packet, deliveredCount });
    return deliveredCount;
  }

  /**
   * Get active connected clients count
   */
  public getActiveClientCount(): number {
    return this.clients.size;
  }

  /**
   * Retrieve list of active subscribers
   */
  public getConnectedClients(): ClientConnectionInfo[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get recent historical packets (useful for replaying missed events upon reconnect)
   */
  public getHistory(limit?: number): BroadcastPacket[] {
    const count = limit ? Math.min(limit, this.messageHistory.length) : this.messageHistory.length;
    return this.messageHistory.slice(-count);
  }

  private recordPacket(packet: BroadcastPacket): void {
    this.messageHistory.push(packet);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }
  }

  private matchesTelemetryFilter(
    reading: EnrichedTelemetryReading,
    filter: TelemetrySubscriptionFilter
  ): boolean {
    if (filter.deviceId && filter.deviceId !== reading.deviceId) return false;
    if (filter.metric && filter.metric.toLowerCase() !== reading.metric.toLowerCase()) return false;
    if (filter.location && reading.location && filter.location !== reading.location) return false;
    return true;
  }

  private matchesAlertFilter(
    alert: ThresholdAlertEvent,
    filter: TelemetrySubscriptionFilter
  ): boolean {
    if (filter.deviceId && filter.deviceId !== alert.deviceId) return false;
    if (filter.metric && filter.metric.toLowerCase() !== alert.metric.toLowerCase()) return false;

    if (filter.minSeverity) {
      const severityOrder: Record<"info" | "warning" | "critical", number> = {
        info: 1,
        warning: 2,
        critical: 3
      };
      if (severityOrder[alert.severity] < severityOrder[filter.minSeverity]) {
        return false;
      }
    }
    return true;
  }
}

export const globalTelemetryBroadcaster = new TelemetryBroadcaster();
