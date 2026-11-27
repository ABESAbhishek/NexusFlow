import type { Request, Response } from "express";
import { globalTelemetryBroadcaster } from "../streams/broadcaster.js";

/**
 * Server-Sent Events (SSE) live streaming endpoint.
 * Allows frontend dashboards to receive real-time telemetry and alerts with zero polling.
 * Example URL: GET /api/telemetry/stream?deviceId=turbine-01&metric=temperature
 */
export function handleTelemetrySseStream(req: Request, res: Response): void {
  // 1. Establish SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const clientId = `sse-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : undefined;
  const metric = typeof req.query.metric === "string" ? req.query.metric : undefined;
  const minSeverity =
    req.query.minSeverity === "critical" || req.query.minSeverity === "warning" || req.query.minSeverity === "info"
      ? req.query.minSeverity
      : undefined;

  // 2. Register subscriber in the broadcaster hub
  globalTelemetryBroadcaster.registerClient(clientId, {
    deviceId,
    metric,
    minSeverity
  });

  // 3. Send initial connection greeting and recent packet history
  const greeting = {
    type: "connected",
    clientId,
    filter: { deviceId, metric, minSeverity },
    timestamp: new Date().toISOString()
  };
  res.write(`data: ${JSON.stringify(greeting)}\n\n`);

  const history = globalTelemetryBroadcaster.getHistory(15);
  for (const packet of history) {
    res.write(`data: ${JSON.stringify(packet)}\n\n`);
  }

  // 4. Listen for live events directed to this client
  const packetListener = (packet: unknown) => {
    res.write(`data: ${JSON.stringify(packet)}\n\n`);
  };
  globalTelemetryBroadcaster.on(`send:${clientId}`, packetListener);

  // 5. Periodic heartbeat ping (every 15s) to prevent intermediate proxy timeouts
  const heartbeatInterval = setInterval(() => {
    res.write(`: ping ${new Date().toISOString()}\n\n`);
    globalTelemetryBroadcaster.recordHeartbeat(clientId);
  }, 15000);

  // 6. Clean up resources upon client disconnect
  req.on("close", () => {
    clearInterval(heartbeatInterval);
    globalTelemetryBroadcaster.off(`send:${clientId}`, packetListener);
    globalTelemetryBroadcaster.unregisterClient(clientId);
  });
}
