import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TelemetryBroadcaster,
  type BroadcastPacket
} from "../streams/broadcaster.js";
import type { EnrichedTelemetryReading, ThresholdAlertEvent } from "../streams/operators.js";

describe("Telemetry Broadcaster & Real-time Subscriptions (Member 3 - Week 3)", () => {
  it("registers clients, tracks connected subscribers, and unregisters properly", () => {
    const hub = new TelemetryBroadcaster();
    assert.equal(hub.getActiveClientCount(), 0);

    const client = hub.registerClient("client-test-1", {
      deviceId: "turbine-01",
      metric: "temperature"
    });

    assert.equal(hub.getActiveClientCount(), 1);
    assert.equal(client.id, "client-test-1");
    assert.equal(client.filter.deviceId, "turbine-01");

    const connected = hub.getConnectedClients();
    assert.equal(connected.length, 1);
    assert.equal(connected[0]?.id, "client-test-1");

    const unregistered = hub.unregisterClient("client-test-1");
    assert.equal(unregistered, true);
    assert.equal(hub.getActiveClientCount(), 0);
  });

  it("updates subscription filter criteria dynamically", () => {
    const hub = new TelemetryBroadcaster();
    hub.registerClient("client-dynamic", { deviceId: "boiler-03" });

    const updated = hub.updateClientFilter("client-dynamic", {
      metric: "pressure",
      minSeverity: "critical"
    });

    assert.ok(updated);
    assert.equal(updated.filter.deviceId, "boiler-03");
    assert.equal(updated.filter.metric, "pressure");
    assert.equal(updated.filter.minSeverity, "critical");

    const notFound = hub.updateClientFilter("non-existent-client", {});
    assert.equal(notFound, undefined);
  });

  it("broadcasts telemetry only to matching subscriber filters", () => {
    const hub = new TelemetryBroadcaster();
    const client1Packets: BroadcastPacket[] = [];
    const client2Packets: BroadcastPacket[] = [];

    hub.registerClient("sub-turbine", { deviceId: "turbine-01" });
    hub.on("send:sub-turbine", (packet) => client1Packets.push(packet));

    hub.registerClient("sub-boiler", { deviceId: "boiler-03" });
    hub.on("send:sub-boiler", (packet) => client2Packets.push(packet));

    const turbineSample: EnrichedTelemetryReading = {
      deviceId: "turbine-01",
      metric: "temperature",
      value: 78.4,
      rawValue: 78.4,
      timestamp: new Date(),
      location: "factory-floor-a"
    };

    const deliveredCount = hub.broadcastTelemetry(turbineSample);
    assert.equal(deliveredCount, 1);
    assert.equal(client1Packets.length, 1);
    assert.equal(client2Packets.length, 0);
    assert.equal(client1Packets[0]?.topic, "telemetry/turbine-01/temperature");
  });

  it("filters and distributes alerts based on threshold severity levels", () => {
    const hub = new TelemetryBroadcaster();
    const criticalSubPackets: BroadcastPacket[] = [];
    const infoSubPackets: BroadcastPacket[] = [];

    hub.registerClient("critical-listener", { minSeverity: "critical" });
    hub.on("send:critical-listener", (packet) => criticalSubPackets.push(packet));

    hub.registerClient("all-listener", { minSeverity: "info" });
    hub.on("send:all-listener", (packet) => infoSubPackets.push(packet));

    const warningAlert: ThresholdAlertEvent = {
      ruleId: "high-temp-warn",
      deviceId: "boiler-03",
      metric: "temperature",
      value: 120,
      threshold: 110,
      comparator: "gt",
      severity: "warning",
      timestamp: new Date()
    };

    const deliveredWarn = hub.broadcastAlert(warningAlert);
    assert.equal(deliveredWarn, 1);
    assert.equal(criticalSubPackets.length, 0);
    assert.equal(infoSubPackets.length, 1);

    const criticalAlert: ThresholdAlertEvent = {
      ruleId: "overheat-critical",
      deviceId: "boiler-03",
      metric: "temperature",
      value: 195,
      threshold: 180,
      comparator: "gt",
      severity: "critical",
      timestamp: new Date()
    };

    const deliveredCrit = hub.broadcastAlert(criticalAlert);
    assert.equal(deliveredCrit, 2);
    assert.equal(criticalSubPackets.length, 1);
    assert.equal(infoSubPackets.length, 2);
  });

  it("retains historical broadcast packets for reconnection replay", () => {
    const hub = new TelemetryBroadcaster({ maxHistory: 3 });

    for (let i = 1; i <= 5; i++) {
      hub.broadcastTelemetry({
        deviceId: `device-${i}`,
        metric: "vibration",
        value: i * 1.5,
        rawValue: i * 1.5,
        timestamp: new Date()
      });
    }

    const history = hub.getHistory();
    assert.equal(history.length, 3);
    assert.equal(history[0]?.topic, "telemetry/device-3/vibration");
    assert.equal(history[2]?.topic, "telemetry/device-5/vibration");
  });

  it("updates heartbeat timestamps reliably", () => {
    const hub = new TelemetryBroadcaster();
    hub.registerClient("client-hb");

    const ok = hub.recordHeartbeat("client-hb");
    assert.equal(ok, true);

    const fail = hub.recordHeartbeat("client-missing");
    assert.equal(fail, false);
  });
});
