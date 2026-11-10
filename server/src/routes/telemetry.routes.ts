import { Router } from "express";
import { z } from "zod";
import { getTelemetryCollection } from "../db/mongo.js";
import { batchSchema, telemetrySchema, toTelemetryDocument } from "../telemetry/schema.js";

export const telemetryRouter = Router();

telemetryRouter.post("/", async (req, res, next) => {
  try {
    const parsed = telemetrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid telemetry payload", details: parsed.error.flatten() });
      return;
    }
    const result = await getTelemetryCollection().insertOne(toTelemetryDocument(parsed.data));
    res.status(201).json({ insertedId: result.insertedId, accepted: 1 });
  } catch (error) {
    next(error);
  }
});

telemetryRouter.post("/batch", async (req, res, next) => {
  try {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid batch payload", details: parsed.error.flatten() });
      return;
    }
    const documents = parsed.data.readings.map(toTelemetryDocument);
    const result = await getTelemetryCollection().insertMany(documents, { ordered: false });
    res.status(201).json({ accepted: result.insertedCount, insertedIds: result.insertedIds });
  } catch (error) {
    next(error);
  }
});

telemetryRouter.get("/recent", async (req, res, next) => {
  try {
    const querySchema = z.object({
      deviceId: z.string().trim().min(1).max(120).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50)
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
      return;
    }
    const filter = parsed.data.deviceId ? { "metadata.deviceId": parsed.data.deviceId } : {};
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
