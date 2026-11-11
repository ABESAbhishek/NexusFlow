import { MongoClient, type Collection, type Document } from "mongodb";
import { env } from "../config/env.js";

let client: MongoClient | undefined;
let telemetryCollection: Collection<Document> | undefined;

export async function connectDatabase(): Promise<void> {
  client = new MongoClient(env.MONGODB_URI, {
    maxPoolSize: 30,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000
  });
  await client.connect();
  const db = client.db(env.MONGODB_DATABASE);
  const collectionName = env.TELEMETRY_COLLECTION;
  const existing = await db.listCollections({ name: collectionName }).toArray();

  if (existing.length === 0) {
    await db.createCollection(collectionName, {
      timeseries: {
        timeField: "timestamp",
        metaField: "metadata",
        granularity: "seconds"
      }
    });
  }

  telemetryCollection = db.collection(collectionName);
  console.info(`MongoDB connected; time-series collection: ${collectionName}`);
}

export function getTelemetryCollection(): Collection<Document> {
  if (!telemetryCollection) throw new Error("Database is not connected");
  return telemetryCollection;
}

export async function closeDatabase(): Promise<void> {
  await client?.close();
  client = undefined;
  telemetryCollection = undefined;
}

export async function databaseIsReady(): Promise<boolean> {
  if (!client) return false;
  try {
    await client.db(env.MONGODB_DATABASE).command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}
