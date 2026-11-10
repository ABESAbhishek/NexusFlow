import { app } from "./app.js";
import { env } from "./config/env.js";
import { closeDatabase, connectDatabase } from "./db/mongo.js";

async function start() {
  await connectDatabase();
  const server = app.listen(env.PORT, () => {
    console.info(`NexusFlow API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    console.info(`${signal} received; shutting down gracefully`);
    server.close(() => {
      void closeDatabase().finally(() => process.exit(0));
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error) => {
  console.error("Unable to start NexusFlow API:", error);
  process.exit(1);
});
