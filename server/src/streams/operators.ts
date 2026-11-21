import type { TelemetryInput } from "../telemetry/schema.js";

export type MathOperationType =
  | "scale"
  | "offset"
  | "clamp"
  | "celsius_to_fahrenheit"
  | "fahrenheit_to_celsius"
  | "bar_to_psi"
  | "psi_to_bar"
  | "abs"
  | "round";

export interface MathTransformConfig {
  operation: MathOperationType;
  factor?: number;
  offset?: number;
  min?: number;
  max?: number;
  decimals?: number;
}

export type ThresholdComparator = "gt" | "gte" | "lt" | "lte" | "eq" | "between" | "outside";

export interface ThresholdRuleConfig {
  ruleId: string;
  metric?: string;
  deviceId?: string;
  comparator: ThresholdComparator;
  threshold: number;
  upperThreshold?: number;
  severity?: "info" | "warning" | "critical";
}

export interface EnrichedTelemetryReading extends TelemetryInput {
  rawValue: number;
  movingAverage?: number;
  exponentialMovingAverage?: number;
  rateOfChangePerSec?: number;
  windowSampleCount?: number;
}

export interface ThresholdAlertEvent {
  ruleId: string;
  deviceId: string;
  metric: string;
  value: number;
  threshold: number;
  upperThreshold?: number;
  comparator: ThresholdComparator;
  severity: "info" | "warning" | "critical";
  timestamp: Date;
  location?: string;
}

/**
 * Applies a stateless mathematical transformation to a single numeric value.
 */
export function applyMathOperation(value: number, config: MathTransformConfig): number {
  switch (config.operation) {
    case "scale": {
      const factor = config.factor ?? 1;
      const offset = config.offset ?? 0;
      return value * factor + offset;
    }
    case "offset": {
      return value + (config.offset ?? 0);
    }
    case "clamp": {
      const min = config.min ?? -Infinity;
      const max = config.max ?? Infinity;
      return Math.min(Math.max(value, min), max);
    }
    case "celsius_to_fahrenheit":
      return (value * 9) / 5 + 32;
    case "fahrenheit_to_celsius":
      return ((value - 32) * 5) / 9;
    case "bar_to_psi":
      return value * 14.5037738;
    case "psi_to_bar":
      return value / 14.5037738;
    case "abs":
      return Math.abs(value);
    case "round": {
      const decimals = Math.max(0, Math.min(8, Math.trunc(config.decimals ?? 2)));
      const multiplier = 10 ** decimals;
      return Math.round(value * multiplier) / multiplier;
    }
  }
}

/**
 * Stateful sliding-window and exponential moving average processor partitioned by deviceId + metric.
 */
export class MovingAverageProcessor {
  private readonly windowSize: number;
  private readonly alpha: number;
  private readonly windows = new Map<string, number[]>();
  private readonly emaState = new Map<string, number>();
  private readonly lastSample = new Map<string, { value: number; timestampMs: number }>();

  constructor(options: { windowSize?: number; alpha?: number } = {}) {
    const size = Math.trunc(options.windowSize ?? 5);
    if (size < 1 || size > 1000) {
      throw new RangeError("windowSize must be an integer between 1 and 1000");
    }
    const alpha = options.alpha ?? 2 / (size + 1);
    if (alpha <= 0 || alpha > 1) {
      throw new RangeError("alpha must be in the range (0, 1]");
    }
    this.windowSize = size;
    this.alpha = alpha;
  }

  private getKey(reading: Pick<TelemetryInput, "deviceId" | "metric">): string {
    return `${reading.deviceId}::${reading.metric}`;
  }

  public next(reading: TelemetryInput): EnrichedTelemetryReading {
    const key = this.getKey(reading);
    const bucket = this.windows.get(key) ?? [];
    bucket.push(reading.value);
    if (bucket.length > this.windowSize) {
      bucket.shift();
    }
    this.windows.set(key, bucket);

    const sum = bucket.reduce((acc, current) => acc + current, 0);
    const sma = Number((sum / bucket.length).toFixed(4));

    const prevEma = this.emaState.get(key);
    const emaRaw = prevEma === undefined ? reading.value : this.alpha * reading.value + (1 - this.alpha) * prevEma;
    const ema = Number(emaRaw.toFixed(4));
    this.emaState.set(key, emaRaw);

    const currentTs = reading.timestamp.getTime();
    const previous = this.lastSample.get(key);
    let rateOfChangePerSec: number | undefined;
    if (previous !== undefined && currentTs > previous.timestampMs) {
      const elapsedSec = (currentTs - previous.timestampMs) / 1000;
      rateOfChangePerSec = Number(((reading.value - previous.value) / elapsedSec).toFixed(4));
    }
    this.lastSample.set(key, { value: reading.value, timestampMs: currentTs });

    return {
      ...reading,
      rawValue: reading.value,
      value: sma,
      movingAverage: sma,
      exponentialMovingAverage: ema,
      ...(rateOfChangePerSec !== undefined ? { rateOfChangePerSec } : {}),
      windowSampleCount: bucket.length
    };
  }

  public reset(deviceId?: string, metric?: string): void {
    if (!deviceId) {
      this.windows.clear();
      this.emaState.clear();
      this.lastSample.clear();
      return;
    }
    const prefix = metric ? `${deviceId}::${metric}` : `${deviceId}::`;
    for (const key of this.windows.keys()) {
      if (metric ? key === prefix : key.startsWith(prefix)) {
        this.windows.delete(key);
        this.emaState.delete(key);
        this.lastSample.delete(key);
      }
    }
  }
}

/**
 * Evaluates a telemetry reading against a threshold rule configuration.
 */
export function evaluateThresholdRule(
  reading: TelemetryInput,
  rule: ThresholdRuleConfig
): ThresholdAlertEvent | null {
  if (rule.deviceId && rule.deviceId !== reading.deviceId) {
    return null;
  }
  if (rule.metric && rule.metric.toLowerCase() !== reading.metric.toLowerCase()) {
    return null;
  }

  const v = reading.value;
  let triggered = false;

  switch (rule.comparator) {
    case "gt":
      triggered = v > rule.threshold;
      break;
    case "gte":
      triggered = v >= rule.threshold;
      break;
    case "lt":
      triggered = v < rule.threshold;
      break;
    case "lte":
      triggered = v <= rule.threshold;
      break;
    case "eq":
      triggered = Math.abs(v - rule.threshold) < 1e-9;
      break;
    case "between": {
      const upper = rule.upperThreshold ?? rule.threshold;
      triggered = v >= rule.threshold && v <= upper;
      break;
    }
    case "outside": {
      const upper = rule.upperThreshold ?? rule.threshold;
      triggered = v < rule.threshold || v > upper;
      break;
    }
  }

  if (!triggered) {
    return null;
  }

  return {
    ruleId: rule.ruleId,
    deviceId: reading.deviceId,
    metric: reading.metric,
    value: reading.value,
    threshold: rule.threshold,
    ...(rule.upperThreshold !== undefined ? { upperThreshold: rule.upperThreshold } : {}),
    comparator: rule.comparator,
    severity: rule.severity ?? "warning",
    timestamp: reading.timestamp,
    ...(reading.location ? { location: reading.location } : {})
  };
}

export interface StreamPipelineOptions {
  deviceIdFilter?: string;
  metricFilter?: string;
  mathTransforms?: MathTransformConfig[];
  movingAverageWindow?: number;
  thresholdRules?: ThresholdRuleConfig[];
}

export interface StreamPipelineResult {
  readings: EnrichedTelemetryReading[];
  alerts: ThresholdAlertEvent[];
}

/**
 * Executes a composable telemetry stream pipeline over a sequence of readings:
 * Source Filter -> Math Operations -> Moving Average -> Threshold Alert Triggers.
 */
export function executeTelemetryStreamPipeline(
  inputReadings: Iterable<TelemetryInput>,
  options: StreamPipelineOptions = {}
): StreamPipelineResult {
  const maProcessor =
    options.movingAverageWindow && options.movingAverageWindow > 1
      ? new MovingAverageProcessor({ windowSize: options.movingAverageWindow })
      : null;

  const readings: EnrichedTelemetryReading[] = [];
  const alerts: ThresholdAlertEvent[] = [];

  for (const item of inputReadings) {
    if (options.deviceIdFilter && item.deviceId !== options.deviceIdFilter) {
      continue;
    }
    if (options.metricFilter && item.metric.toLowerCase() !== options.metricFilter.toLowerCase()) {
      continue;
    }

    let transformedValue = item.value;
    let updatedUnit = item.unit;

    for (const transform of options.mathTransforms ?? []) {
      transformedValue = applyMathOperation(transformedValue, transform);
      if (transform.operation === "celsius_to_fahrenheit") updatedUnit = "fahrenheit";
      if (transform.operation === "fahrenheit_to_celsius") updatedUnit = "celsius";
      if (transform.operation === "bar_to_psi") updatedUnit = "psi";
      if (transform.operation === "psi_to_bar") updatedUnit = "bar";
    }

    const afterMath: TelemetryInput = {
      ...item,
      value: Number(transformedValue.toFixed(4)),
      ...(updatedUnit ? { unit: updatedUnit } : {})
    };

    const enriched: EnrichedTelemetryReading = maProcessor
      ? maProcessor.next(afterMath)
      : {
          ...afterMath,
          rawValue: item.value
        };

    readings.push(enriched);

    for (const rule of options.thresholdRules ?? []) {
      const alert = evaluateThresholdRule(enriched, rule);
      if (alert) {
        alerts.push(alert);
      }
    }
  }

  return { readings, alerts };
}
