import { z } from "zod";
import {
  batchSchema,
  recentQuerySchema,
  telemetrySchema,
  type RecentQueryInput,
  type TelemetryBatchInput,
  type TelemetryInput
} from "./schema.js";

export interface ValidationFailure {
  valid: false;
  error: string;
  details: z.typeToFlattenedError<unknown>;
}

export interface ValidationSuccess<T> {
  valid: true;
  data: T;
  warnings: string[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export interface MetricRangeSpec {
  min: number;
  max: number;
  defaultUnit: string;
  allowedUnits: readonly string[];
}

export const INDUSTRIAL_METRIC_SPECS: Record<string, MetricRangeSpec> = {
  temperature: {
    min: -50,
    max: 300,
    defaultUnit: "celsius",
    allowedUnits: ["celsius", "°c", "c", "fahrenheit", "°f", "f", "kelvin", "k"]
  },
  pressure: {
    min: 0,
    max: 500,
    defaultUnit: "bar",
    allowedUnits: ["bar", "psi", "kpa", "mpa", "pa"]
  },
  vibration: {
    min: 0,
    max: 100,
    defaultUnit: "mm/s",
    allowedUnits: ["mm/s", "g", "hz"]
  },
  rpm: {
    min: 0,
    max: 25000,
    defaultUnit: "rpm",
    allowedUnits: ["rpm", "hz"]
  },
  humidity: {
    min: 0,
    max: 100,
    defaultUnit: "%",
    allowedUnits: ["%", "rh", "%rh"]
  },
  flow_rate: {
    min: 0,
    max: 10000,
    defaultUnit: "l/min",
    allowedUnits: ["l/min", "m3/h", "gpm"]
  },
  voltage: {
    min: 0,
    max: 1000,
    defaultUnit: "v",
    allowedUnits: ["v", "mv", "kv"]
  },
  current: {
    min: 0,
    max: 500,
    defaultUnit: "a",
    allowedUnits: ["a", "ma"]
  }
};

/**
 * Inspects a validated telemetry reading against known industrial sensor ranges
 * and returns non-blocking operational warnings (e.g. out-of-range spikes or unusual units).
 */
export function inspectTelemetryWarnings(reading: TelemetryInput): string[] {
  const warnings: string[] = [];
  const metricKey = reading.metric.toLowerCase();
  const spec = INDUSTRIAL_METRIC_SPECS[metricKey];

  if (spec) {
    if (reading.value < spec.min || reading.value > spec.max) {
      warnings.push(
        `Metric "${reading.metric}" value ${reading.value} is outside nominal industrial range [${spec.min}, ${spec.max}]`
      );
    }

    if (reading.unit) {
      const normalizedUnit = reading.unit.toLowerCase();
      if (!spec.allowedUnits.includes(normalizedUnit)) {
        warnings.push(
          `Unit "${reading.unit}" is unusual for metric "${reading.metric}" (expected one of: ${spec.allowedUnits.join(", ")})`
        );
      }
    }
  }

  const maxFutureDriftMs = 5 * 60 * 1000;
  if (reading.timestamp.getTime() - Date.now() > maxFutureDriftMs) {
    warnings.push("Telemetry timestamp is more than 5 minutes in the future");
  }

  return warnings;
}

/**
 * Validates a single incoming telemetry payload.
 */
export function validateSingleTelemetry(payload: unknown): ValidationResult<TelemetryInput> {
  const parsed = telemetrySchema.safeParse(payload);
  if (!parsed.success) {
    return {
      valid: false,
      error: "Invalid telemetry payload",
      details: parsed.error.flatten()
    };
  }

  return {
    valid: true,
    data: parsed.data,
    warnings: inspectTelemetryWarnings(parsed.data)
  };
}

/**
 * Validates a batch of telemetry readings (1 to 1,000 points).
 */
export function validateTelemetryBatch(payload: unknown): ValidationResult<TelemetryBatchInput> {
  const parsed = batchSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      valid: false,
      error: "Invalid batch payload",
      details: parsed.error.flatten()
    };
  }

  const warnings: string[] = [];
  for (let i = 0; i < parsed.data.readings.length; i++) {
    const item = parsed.data.readings[i];
    if (!item) continue;
    const itemWarnings = inspectTelemetryWarnings(item);
    for (const warning of itemWarnings) {
      if (warnings.length < 25) {
        warnings.push(`readings[${i}]: ${warning}`);
      }
    }
  }

  return {
    valid: true,
    data: parsed.data,
    warnings
  };
}

/**
 * Validates query parameters for recent telemetry lookups.
 */
export function validateRecentTelemetryQuery(query: unknown): ValidationResult<RecentQueryInput> {
  const parsed = recentQuerySchema.safeParse(query);
  if (!parsed.success) {
    return {
      valid: false,
      error: "Invalid query",
      details: parsed.error.flatten()
    };
  }

  return {
    valid: true,
    data: parsed.data,
    warnings: []
  };
}

