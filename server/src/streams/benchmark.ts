import { generateSensorBatch } from "../simulator/sensorGenerator.js";
import { toTelemetryDocument } from "../telemetry/schema.js";
import { validateTelemetryBatch } from "../telemetry/validator.js";
import { executeTelemetryStreamPipeline, type StreamPipelineOptions } from "./operators.js";

export interface StreamBenchmarkOptions {
  totalReadings?: number;
  batchSize?: number;
  targetThroughputPerSec?: number;
  pipelineOptions?: StreamPipelineOptions;
}

export interface StreamBenchmarkReport {
  totalReadings: number;
  batchCount: number;
  batchSize: number;
  elapsedMs: number;
  readingsPerSecond: number;
  targetThroughputPerSec: number;
  meetsTarget: boolean;
  alertsTriggered: number;
  processedReadings: number;
}

/**
 * Benchmarks telemetry batch validation, MongoDB time-series document normalization,
 * and stream operator pipeline throughput against the 5,000 writes/sec target.
 */
export function runStreamThroughputBenchmark(
  options: StreamBenchmarkOptions = {}
): StreamBenchmarkReport {
  const totalReadings = Math.max(100, Math.min(50_000, Math.trunc(options.totalReadings ?? 5_000)));
  const batchSize = Math.max(10, Math.min(1_000, Math.trunc(options.batchSize ?? 500)));
  const targetThroughputPerSec = options.targetThroughputPerSec ?? 5_000;

  const batches: ReturnType<typeof generateSensorBatch>[] = [];
  let remaining = totalReadings;
  while (remaining > 0) {
    const count = Math.min(batchSize, remaining);
    batches.push(generateSensorBatch({ count }));
    remaining -= count;
  }

  const pipelineOptions: StreamPipelineOptions = options.pipelineOptions ?? {
    mathTransforms: [
      { operation: "scale", factor: 1.02, offset: 0.5 },
      { operation: "round", decimals: 2 }
    ],
    movingAverageWindow: 5,
    thresholdRules: [
      {
        ruleId: "benchmark-overheat-alert",
        metric: "temperature",
        comparator: "gt",
        threshold: 85,
        severity: "warning"
      }
    ]
  };

  let processedReadings = 0;
  let alertsTriggered = 0;

  const startNs = process.hrtime.bigint();

  for (const rawBatch of batches) {
    const validated = validateTelemetryBatch({ readings: rawBatch });
    if (!validated.valid) {
      throw new Error(`Benchmark batch validation failed: ${validated.error}`);
    }
    const documents = validated.data.readings.map(toTelemetryDocument);
    const result = executeTelemetryStreamPipeline(validated.data.readings, pipelineOptions);
    processedReadings += Math.min(documents.length, result.readings.length);
    alertsTriggered += result.alerts.length;
  }

  const endNs = process.hrtime.bigint();
  const elapsedMs = Math.max(0.01, Number(endNs - startNs) / 1_000_000);
  const readingsPerSecond = Math.round((processedReadings / elapsedMs) * 1_000);

  return {
    totalReadings: processedReadings,
    batchCount: batches.length,
    batchSize,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    readingsPerSecond,
    targetThroughputPerSec,
    meetsTarget: readingsPerSecond >= targetThroughputPerSec,
    alertsTriggered,
    processedReadings
  };
}
