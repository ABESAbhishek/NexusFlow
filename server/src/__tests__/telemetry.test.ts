import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { app } from "../app.js";
import { DEFAULT_SENSOR_PROFILES, generateSensorBatch, generateSensorReading } from "../simulator/sensorGenerator.js";
import { toTelemetryDocument } from "../telemetry/schema.js";
import {
  inspectTelemetryWarnings,
  validateRecentTelemetryQuery,
  validateSingleTelemetry,
  validateTelemetryBatch
} from "../telemetry/validator.js";

describe("Telemetry Payload Validation (Week 1 - Member 3)", () => {
  it("accepts a valid telemetry reading and normalizes timestamp", () => {
    const result = validateSingleTelemetry({
      deviceId: "turbine-01",
      metric: "temperature",
      value: 74.2,
      unit: "celsius",
      timestamp: "2026-11-10T08:00:00.000Z",
      location: "factory-floor-a"
    });

    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.data.deviceId, "turbine-01");
      assert.equal(result.data.metric, "temperature");
      assert.equal(result.data.value, 74.2);
      assert.equal(result.data.timestamp instanceof Date, true);
      assert.equal(result.warnings.length, 0);
    }
  });

  it("rejects telemetry with missing deviceId, invalid characters, or non-finite value", () => {
    const emptyDevice = validateSingleTelemetry({
      deviceId: "   ",
      metric: "temperature",
      value: 50
    });
    assert.equal(emptyDevice.valid, false);

    const invalidChars = validateSingleTelemetry({
      deviceId: "turbine 01 / invalid!",
      metric: "temperature",
      value: 50
    });
    assert.equal(invalidChars.valid, false);

    const nanValue = validateSingleTelemetry({
      deviceId: "turbine-01",
      metric: "temperature",
      value: Number.NaN
    });
    assert.equal(nanValue.valid, false);
  });

  it("flags operational warnings when values exceed nominal industrial sensor bounds", () => {
    const warnings = inspectTelemetryWarnings({
      deviceId: "boiler-03",
      metric: "temperature",
      value: 450,
      unit: "bar",
      timestamp: new Date()
    });

    assert.equal(warnings.length, 2);
    assert.match(warnings[0] ?? "", /outside nominal industrial range/);
    assert.match(warnings[1] ?? "", /unusual for metric/);
  });

  it("validates batches between 1 and 1000 readings and rejects empty batches", () => {
    const emptyBatch = validateTelemetryBatch({ readings: [] });
    assert.equal(emptyBatch.valid, false);

    const sampleReadings = generateSensorBatch({ count: 25 });
    const validBatch = validateTelemetryBatch({ readings: sampleReadings });
    assert.equal(validBatch.valid, true);
    if (validBatch.valid) {
      assert.equal(validBatch.data.readings.length, 25);
    }
  });

  it("validates recent telemetry query filters and enforces limit bounds (1..200)", () => {
    const validQuery = validateRecentTelemetryQuery({
      deviceId: "turbine-01",
      metric: "vibration",
      limit: "75"
    });
    assert.equal(validQuery.valid, true);
    if (validQuery.valid) {
      assert.equal(validQuery.data.deviceId, "turbine-01");
      assert.equal(validQuery.data.metric, "vibration");
      assert.equal(validQuery.data.limit, 75);
    }

    const excessiveLimit = validateRecentTelemetryQuery({ limit: "500" });
    assert.equal(excessiveLimit.valid, false);
  });

  it("transforms validated input into MongoDB time-series document format", () => {
    const reading = generateSensorReading({
      profile: DEFAULT_SENSOR_PROFILES[0],
      forceSpike: false
    });
    const doc = toTelemetryDocument(reading);

    assert.equal(doc.metadata.deviceId, "turbine-01");
    assert.equal(doc.metadata.metric, "temperature");
    assert.equal(doc.metadata.location, "factory-floor-a");
    assert.equal(typeof doc.value, "number");
    assert.equal(doc.ingestedAt instanceof Date, true);
  });
});

describe("Sensor Data Simulator & Ingestion API Contract Tests", () => {
  let baseUrl = "";
  let server: ReturnType<typeof app.listen>;

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("generates deterministic sensor readings and chronological batches", () => {
    let seed = 0.42;
    const deterministicRng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const batch = generateSensorBatch({
      count: 15,
      stepMs: 1000,
      rng: deterministicRng
    });

    assert.equal(batch.length, 15);
    for (let i = 1; i < batch.length; i++) {
      assert.ok(batch[i]!.timestamp.getTime() > batch[i - 1]!.timestamp.getTime());
    }
  });

  it("validates single and batch payloads via POST /api/telemetry/validate", async () => {
    const sample = generateSensorReading({ forceSpike: false });
    const singleRes = await fetch(`${baseUrl}/api/telemetry/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample)
    });
    assert.equal(singleRes.status, 200);
    const singleBody = (await singleRes.json()) as { valid: boolean; mode: string };
    assert.equal(singleBody.valid, true);
    assert.equal(singleBody.mode, "single");

    const batch = generateSensorBatch({ count: 10 });
    const batchRes = await fetch(`${baseUrl}/api/telemetry/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readings: batch })
    });
    assert.equal(batchRes.status, 200);
    const batchBody = (await batchRes.json()) as { valid: boolean; mode: string; count: number };
    assert.equal(batchBody.valid, true);
    assert.equal(batchBody.mode, "batch");
    assert.equal(batchBody.count, 10);
  });

  it("returns 400 Bad Request on invalid payloads for POST /api/telemetry and /api/telemetry/batch", async () => {
    const invalidSingleRes = await fetch(`${baseUrl}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "", metric: "temperature", value: "not-a-number" })
    });
    assert.equal(invalidSingleRes.status, 400);

    const invalidBatchRes = await fetch(`${baseUrl}/api/telemetry/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readings: [] })
    });
    assert.equal(invalidBatchRes.status, 400);
  });
});

