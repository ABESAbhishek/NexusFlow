import { z } from "zod";

export const telemetrySchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  metric: z.string().trim().min(1).max(80),
  value: z.number().finite(),
  unit: z.string().trim().max(30).optional(),
  timestamp: z.coerce.date().default(() => new Date()),
  location: z.string().trim().max(120).optional()
});

export const batchSchema = z.object({
  readings: z.array(telemetrySchema).min(1).max(1000)
});

export type TelemetryInput = z.infer<typeof telemetrySchema>;

export function toTelemetryDocument(input: TelemetryInput) {
  const { deviceId, metric, value, unit, timestamp, location } = input;
  return {
    timestamp,
    metadata: { deviceId, metric, ...(location ? { location } : {}) },
    value,
    ...(unit ? { unit } : {}),
    ingestedAt: new Date()
  };
}
