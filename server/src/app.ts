import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { databaseIsReady } from "./db/mongo.js";
import { telemetryRouter } from "./routes/telemetry.routes.js";

export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: env.CLIENT_ORIGIN }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  const database = await databaseIsReady();
  res.status(database ? 200 : 503).json({
    status: database ? "ok" : "degraded",
    service: "nexusflow-api",
    database: database ? "connected" : "disconnected",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/telemetry", telemetryRouter);

app.use((_req, res) => res.status(404).json({ error: "Route not found" }));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error("Request failed:", error);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);
