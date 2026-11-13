import { Router } from "express";
import { getTelemetryCollection } from "../db/mongo.js";
import { toTelemetryDocument } from "../telemetry/schema.js";
import {
  validateRecentTelemetryQuery,
  validateSingleTelemetry,
  validateTelemetryBatch
} from "../telemetry/validator.js";

export const telemetryRouter = Router();

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
