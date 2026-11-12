import { z } from "zod";

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9._:-]+$/;

export const telemetrySchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(1, "deviceId is required")
    .max(120, "deviceId must be at most 120 characters")
    .regex(IDENTIFIER_PATTERN, "deviceId may only contain alphanumeric characters, dots, underscores, colons, or hyphens"),
  metric: z
    .string()
    .trim()
    .min(1, "metric is required")
    .max(80, "metric must be at most 80 characters")
    .regex(IDENTIFIER_PATTERN, "metric may only contain alphanumeric characters, dots, underscores, colons, or hyphens"),
  value: z.number().finite("value must be a finite number"),
  unit: z
    .string()
    .trim()
    .min(1, "unit cannot be empty when provided")
    .max(30, "unit must be at most 30 characters")
    .optional(),
  timestamp: z.coerce.date().default(() => new Date()),
  location: z
    .string()
    .trim()
    .min(1, "location cannot be empty when provided")
    .max(120, "location must be at most 120 characters")
    .optional()
});

export const batchSchema = z.object({
  readings: z
    .array(telemetrySchema)
    .min(1, "Batch must contain at least 1 reading")
    .max(1000, "Batch cannot exceed 1000 readings")
});

export const recentQuerySchema = z.object({
  deviceId: z.string().trim().min(1).max(120).optional(),
  metric: z.string().trim().min(1).max(80).optional(),
  location: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export type TelemetryInput = z.infer<typeof telemetrySchema>;
export type TelemetryBatchInput = z.infer<typeof batchSchema>;
export type RecentQueryInput = z.infer<typeof recentQuerySchema>;

export interface TelemetryDocument {
  timestamp: Date;
  metadata: {
    deviceId: string;
    metric: string;
    location?: string;
  };
  value: number;
  unit?: string;
  ingestedAt: Date;
}

export function toTelemetryDocument(input: TelemetryInput): TelemetryDocument {
  const { deviceId, metric, value, unit, timestamp, location } = input;
  return {
    timestamp,
    metadata: { deviceId, metric, ...(location ? { location } : {}) },
    value,
    ...(unit ? { unit } : {}),
    ingestedAt: new Date()
  };
}
