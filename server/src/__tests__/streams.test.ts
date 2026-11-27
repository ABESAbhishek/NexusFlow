import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MovingAverageProcessor,
  applyMathOperation,
  evaluateThresholdRule,
  executeTelemetryStreamPipeline
} from "../streams/operators.js";
import type { TelemetryInput } from "../telemetry/schema.js";

describe("Stream Operators & Mathematical Transformations (Member 3)", () => {
  it("applies stateless mathematical transformations accurately", () => {
    assert.equal(applyMathOperation(20, { operation: "scale", factor: 1.5, offset: 5 }), 35);
    assert.equal(applyMathOperation(42, { operation: "offset", offset: -12 }), 30);
    assert.equal(applyMathOperation(150, { operation: "clamp", min: 0, max: 100 }), 100);
    assert.equal(applyMathOperation(-15, { operation: "clamp", min: 0, max: 100 }), 0);
    assert.equal(applyMathOperation(100, { operation: "celsius_to_fahrenheit" }), 212);
    assert.equal(applyMathOperation(212, { operation: "fahrenheit_to_celsius" }), 100);
    assert.equal(applyMathOperation(-42.5, { operation: "abs" }), 42.5);
    assert.equal(applyMathOperation(74.2689, { operation: "round", decimals: 2 }), 74.27);
  });

  it("computes sliding-window SMA, EMA, and per-second rate of change partitioned by device and metric", () => {
    const processor = new MovingAverageProcessor({ windowSize: 3, alpha: 0.5 });
    const baseTime = new Date("2026-11-16T08:00:00.000Z").getTime();

    const r1 = processor.next({
      deviceId: "turbine-01",
      metric: "temperature",
      value: 60,
      timestamp: new Date(baseTime)
    });
    assert.equal(r1.movingAverage, 60);
    assert.equal(r1.exponentialMovingAverage, 60);
    assert.equal(r1.windowSampleCount, 1);
    assert.equal(r1.rateOfChangePerSec, undefined);

    const r2 = processor.next({
      deviceId: "turbine-01",
      metric: "temperature",
      value: 70,
      timestamp: new Date(baseTime + 2000)
    });
    assert.equal(r2.movingAverage, 65);
    assert.equal(r2.exponentialMovingAverage, 65);
    assert.equal(r2.windowSampleCount, 2);
    assert.equal(r2.rateOfChangePerSec, 5);

    const r3 = processor.next({
      deviceId: "turbine-01",
      metric: "temperature",
      value: 80,
      timestamp: new Date(baseTime + 4000)
    });
    assert.equal(r3.movingAverage, 70);
    assert.equal(r3.exponentialMovingAverage, 72.5);
    assert.equal(r3.windowSampleCount, 3);

    const r4 = processor.next({
      deviceId: "turbine-01",
      metric: "temperature",
      value: 90,
      timestamp: new Date(baseTime + 6000)
    });
    // Window of 3 slides to [70, 80, 90] -> average 80
    assert.equal(r4.movingAverage, 80);
    assert.equal(r4.windowSampleCount, 3);

    // Separate device/metric partition remains isolated
    const otherDevice = processor.next({
      deviceId: "compressor-02",
      metric: "pressure",
      value: 12,
      timestamp: new Date(baseTime)
    });
    assert.equal(otherDevice.movingAverage, 12);
    assert.equal(otherDevice.windowSampleCount, 1);
  });

  it("evaluates threshold rules across comparators and emits structured alert events", () => {
    const sample: TelemetryInput = {
      deviceId: "boiler-03",
      metric: "temperature",
      value: 195.4,
      unit: "celsius",
      timestamp: new Date("2026-11-16T09:00:00.000Z"),
      location: "factory-floor-b"
    };

    const gtAlert = evaluateThresholdRule(sample, {
      ruleId: "rule-overheat",
      deviceId: "boiler-03",
      metric: "temperature",
      comparator: "gt",
      threshold: 180,
      severity: "critical"
    });
    assert.notEqual(gtAlert, null);
    assert.equal(gtAlert?.ruleId, "rule-overheat");
    assert.equal(gtAlert?.severity, "critical");
    assert.equal(gtAlert?.value, 195.4);

    const nonMatchingDevice = evaluateThresholdRule(sample, {
      ruleId: "rule-other",
      deviceId: "turbine-01",
      comparator: "gt",
      threshold: 100
    });
    assert.equal(nonMatchingDevice, null);

    const outsideAlert = evaluateThresholdRule(sample, {
      ruleId: "rule-band",
      comparator: "outside",
      threshold: 100,
      upperThreshold: 190
    });
    assert.notEqual(outsideAlert, null);
  });

  it("executes end-to-end telemetry stream pipeline with filtering, math, moving average, and alerts", () => {
    const baseTime = new Date("2026-11-16T10:00:00.000Z").getTime();
    const rawStream: TelemetryInput[] = [
      {
        deviceId: "turbine-01",
        metric: "temperature",
        value: 70,
        unit: "celsius",
        timestamp: new Date(baseTime)
      },
      {
        deviceId: "pump-04",
        metric: "flow_rate",
        value: 110,
        unit: "lpm",
        timestamp: new Date(baseTime + 1000)
      },
      {
        deviceId: "turbine-01",
        metric: "temperature",
        value: 80,
        unit: "celsius",
        timestamp: new Date(baseTime + 2000)
      },
      {
        deviceId: "turbine-01",
        metric: "temperature",
        value: 90,
        unit: "celsius",
        timestamp: new Date(baseTime + 4000)
      }
    ];

    const result = executeTelemetryStreamPipeline(rawStream, {
      deviceIdFilter: "turbine-01",
      metricFilter: "temperature",
      mathTransforms: [{ operation: "offset", offset: 5 }],
      movingAverageWindow: 2,
      thresholdRules: [
        {
          ruleId: "turbine-temp-high",
          comparator: "gte",
          threshold: 85,
          severity: "critical"
        }
      ]
    });

    // Only the 3 turbine-01 readings pass the filter
    assert.equal(result.readings.length, 3);
    // Reading 1: 70 + 5 = 75 (SMA = 75)
    assert.equal(result.readings[0]?.value, 75);
    // Reading 2: 80 + 5 = 85 -> SMA(75, 85) = 80
    assert.equal(result.readings[1]?.value, 80);
    // Reading 3: 90 + 5 = 95 -> SMA(85, 95) = 90 (triggers >= 85 alert)
    assert.equal(result.readings[2]?.value, 90);

    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0]?.ruleId, "turbine-temp-high");
    assert.equal(result.alerts[0]?.value, 90);
  });
});
