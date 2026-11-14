import { env } from "../config/env.js";
import { DEFAULT_SENSOR_PROFILES, generateSensorBatch, generateSensorReading } from "./sensorGenerator.js";

export interface SimulatorRunOptions {
  apiUrl: string;
  count: number;
  batchMode: boolean;
  dryRun: boolean;
}

export function parseSimulatorArgs(argv: readonly string[]): SimulatorRunOptions {
  let apiUrl = `http://localhost:${env.PORT}`;
  let count = 10;
  let batchMode = true;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--single") {
      batchMode = false;
    } else if (arg === "--batch") {
      batchMode = true;
    } else if (arg === "--count" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[i + 1]!, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        count = Math.min(1000, parsed);
      }
      i++;
    } else if (arg === "--url" && argv[i + 1]) {
      apiUrl = argv[i + 1]!;
      i++;
    }
  }

  return { apiUrl, count, batchMode, dryRun };
}

export async function runSimulator(options: SimulatorRunOptions): Promise<void> {
  const readings = generateSensorBatch({
    count: options.count,
    profiles: DEFAULT_SENSOR_PROFILES
  });

  if (options.dryRun) {
    console.info(
      JSON.stringify(
        {
          mode: options.batchMode ? "batch" : "single",
          generatedCount: readings.length,
          sample: options.batchMode ? { readings } : readings[0]
        },
        null,
        2
      )
    );
    return;
  }

  if (options.batchMode) {
    const response = await fetch(`${options.apiUrl}/api/telemetry/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readings })
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Batch ingestion failed (${response.status}): ${JSON.stringify(body)}`);
    }
    console.info(`Ingested batch of ${readings.length} sensor readings:`, body);
    return;
  }

  for (let i = 0; i < readings.length; i++) {
    const reading = readings[i] ?? generateSensorReading({ sequenceIndex: i });
    const response = await fetch(`${options.apiUrl}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reading)
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Single ingestion failed at #${i + 1} (${response.status}): ${JSON.stringify(body)}`);
    }
  }
  console.info(`Ingested ${readings.length} individual sensor readings to ${options.apiUrl}`);
}

const isMainModule =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("simulator/cli.ts") || process.argv[1].endsWith("simulator\\cli.ts") ||
    process.argv[1].endsWith("simulator/cli.js") || process.argv[1].endsWith("simulator\\cli.js"));

if (isMainModule) {
  const options = parseSimulatorArgs(process.argv.slice(2));
  runSimulator(options).catch((error) => {
    console.error("Sensor simulator error:", error);
    process.exit(1);
  });
}

