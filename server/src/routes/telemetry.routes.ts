import { Router } from "express";
import { z } from "zod";
import { getTelemetryCollection } from "../db/mongo.js";
import { runStreamThroughputBenchmark } from "../streams/benchmark.js";
import { executeTelemetryStreamPipeline } from "../streams/operators.js";
import { telemetrySchema, toTelemetryDocument } from "../telemetry/schema.js";
import {
  validateRecentTelemetryQuery,
  validateSingleTelemetry,
  validateTelemetryBatch
} from "../telemetry/validator.js";

export const telemetryRouter = Router();

const evaluatePipelineSchema = z.object({
  readings: z.array(telemetrySchema).min(1).max(1000),
  deviceIdFilter: z.string().trim().min(1).max(120).optional(),
  metricFilter: z.string().trim().min(1).max(80).optional(),
  movingAverageWindow: z.number().int().min(1).max(1000).optional(),
  mathTransforms: z
    .array(
      z.object({
        operation: z.enum([
          "scale",
          "offset",
          "clamp",
          "celsius_to_fahrenheit",
          "fahrenheit_to_celsius",
          "bar_to_psi",
          "psi_to_bar",
          "abs",
          "round"
        ]),
        factor: z.number().finite().optional(),
        offset: z.number().finite().optional(),
        min: z.number().finite().optional(),
        max: z.number().finite().optional(),
        decimals: z.number().int().min(0).max(8).optional()
      })
    )
    .optional(),
  thresholdRules: z
    .array(
      z.object({
        ruleId: z.string().trim().min(1).max(120),
        metric: z.string().trim().min(1).max(80).optional(),
        deviceId: z.string().trim().min(1).max(120).optional(),
        comparator: z.enum(["gt", "gte", "lt", "lte", "eq", "between", "outside"]),
        threshold: z.number().finite(),
        upperThreshold: z.number().finite().optional(),
        severity: z.enum(["info", "warning", "critical"]).optional()
      })
    )
    .optional()
});

telemetryRouter.post("/validate", (req, res) => {
  const isBatch =
    typeof req.body === "object" &&
    req.body !== null &&
    "readings" in req.body;

  if (isBatch) {
    const validation = validateTelemetryBatch(req.body);
    if (!validation.valid) {
      res.status(400).json({ valid: false, error: validation.error, details: validation.details });
      return;
    }
    res.json({
      valid: true,
      mode: "batch",
      count: validation.data.readings.length,
      warnings: validation.warnings
    });
    return;
  }

  const validation = validateSingleTelemetry(req.body);
  if (!validation.valid) {
    res.status(400).json({ valid: false, error: validation.error, details: validation.details });
    return;
  }

  res.json({
    valid: true,
    mode: "single",
    normalized: validation.data,
    warnings: validation.warnings
  });
});

telemetryRouter.post("/", async (req, res, next) => {
  try {
    const parsed = validateSingleTelemetry(req.body);
    if (!parsed.valid) {
      res.status(400).json({ error: parsed.error, details: parsed.details });
      return;
    }
    const result = await getTelemetryCollection().insertOne(toTelemetryDocument(parsed.data));
    res.status(201).json({
      insertedId: result.insertedId,
      accepted: 1,
      ...(parsed.warnings.length > 0 ? { warnings: parsed.warnings } : {})
    });
  } catch (error) {
    next(error);
  }
});

telemetryRouter.post("/batch", async (req, res, next) => {
  try {
    const parsed = validateTelemetryBatch(req.body);
    if (!parsed.valid) {
      res.status(400).json({ error: parsed.error, details: parsed.details });
      return;
    }
    const documents = parsed.data.readings.map(toTelemetryDocument);
    const result = await getTelemetryCollection().insertMany(documents, { ordered: false });
    res.status(201).json({
      accepted: result.insertedCount,
      insertedIds: result.insertedIds,
      ...(parsed.warnings.length > 0 ? { warnings: parsed.warnings } : {})
    });
  } catch (error) {
    next(error);
  }
});

telemetryRouter.get("/recent", async (req, res, next) => {
  try {
    const parsed = validateRecentTelemetryQuery(req.query);
    if (!parsed.valid) {
      res.status(400).json({ error: parsed.error, details: parsed.details });
      return;
    }

    const filter: Record<string, string> = {};
    if (parsed.data.deviceId) filter["metadata.deviceId"] = parsed.data.deviceId;
    if (parsed.data.metric) filter["metadata.metric"] = parsed.data.metric;
    if (parsed.data.location) filter["metadata.location"] = parsed.data.location;

    const readings = await getTelemetryCollection()
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(parsed.data.limit)
      .toArray();
    res.json({ readings, count: readings.length });
  } catch (error) {
    next(error);
  }
});

telemetryRouter.post("/evaluate", (req, res) => {
  const parsed = evaluatePipelineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid stream evaluation payload",
      details: parsed.error.flatten()
    });
    return;
  }

  const result = executeTelemetryStreamPipeline(parsed.data.readings, {
    ...(parsed.data.deviceIdFilter ? { deviceIdFilter: parsed.data.deviceIdFilter } : {}),
    ...(parsed.data.metricFilter ? { metricFilter: parsed.data.metricFilter } : {}),
    ...(parsed.data.movingAverageWindow !== undefined
      ? { movingAverageWindow: parsed.data.movingAverageWindow }
      : {}),
    ...(parsed.data.mathTransforms ? { mathTransforms: parsed.data.mathTransforms } : {}),
    ...(parsed.data.thresholdRules ? { thresholdRules: parsed.data.thresholdRules } : {})
  });

  res.json({
    inputCount: parsed.data.readings.length,
    outputCount: result.readings.length,
    alertCount: result.alerts.length,
    readings: result.readings,
    alerts: result.alerts
  });
});

telemetryRouter.post("/benchmark", (req, res) => {
  const optionsSchema = z
    .object({
      totalReadings: z.number().int().min(100).max(50000).optional(),
      batchSize: z.number().int().min(10).max(1000).optional()
    })
    .optional();

  const parsed = optionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid benchmark options",
      details: parsed.error.flatten()
    });
    return;
  }

  const report = runStreamThroughputBenchmark(parsed.data ?? {});
  res.json(report);
});
