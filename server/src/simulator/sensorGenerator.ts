import type { TelemetryInput } from "../telemetry/schema.js";

export interface SensorProfile {
  deviceId: string;
  metric: string;
  unit: string;
  location: string;
  baseline: number;
  amplitude: number;
  noiseStdDev: number;
  spikeProbability?: number;
  spikeDelta?: number;
}

export const DEFAULT_SENSOR_PROFILES: readonly SensorProfile[] = [
  {
    deviceId: "turbine-01",
    metric: "temperature",
    unit: "celsius",
    location: "factory-floor-a",
    baseline: 72.5,
    amplitude: 6.0,
    noiseStdDev: 0.8,
    spikeProbability: 0.05,
    spikeDelta: 14.0
  },
  {
    deviceId: "turbine-01",
    metric: "vibration",
    unit: "mm/s",
    location: "factory-floor-a",
    baseline: 4.2,
    amplitude: 1.1,
    noiseStdDev: 0.25,
    spikeProbability: 0.04,
    spikeDelta: 5.5
  },
  {
    deviceId: "compressor-02",
    metric: "pressure",
    unit: "bar",
    location: "factory-floor-a",
    baseline: 12.8,
    amplitude: 1.5,
    noiseStdDev: 0.2,
    spikeProbability: 0.03,
    spikeDelta: 4.2
  },
  {
    deviceId: "boiler-03",
    metric: "temperature",
    unit: "celsius",
    location: "thermal-bay-b",
    baseline: 118.0,
    amplitude: 8.5,
    noiseStdDev: 1.2,
    spikeProbability: 0.05,
    spikeDelta: 22.0
  },
  {
    deviceId: "pump-04",
    metric: "flow_rate",
    unit: "l/min",
    location: "coolant-loop-c",
    baseline: 450.0,
    amplitude: 35.0,
    noiseStdDev: 4.5,
    spikeProbability: 0.02,
    spikeDelta: -120.0
  }
];

export interface GenerateReadingOptions {
  profile?: SensorProfile;
  timestamp?: Date;
  sequenceIndex?: number;
  forceSpike?: boolean;
  rng?: () => number;
}

export interface GenerateBatchOptions {
  count: number;
  profiles?: readonly SensorProfile[];
  startTime?: Date;
  stepMs?: number;
  rng?: () => number;
}

/**
 * Box-Muller transform for standard normal distribution sampling.
 */
function sampleNormal(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-10);
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Generates a single realistic industrial IoT telemetry reading.
 */
export function generateSensorReading(options: GenerateReadingOptions = {}): TelemetryInput {
  const rng = options.rng ?? Math.random;
  const profile =
    options.profile ??
    DEFAULT_SENSOR_PROFILES[Math.floor(rng() * DEFAULT_SENSOR_PROFILES.length)] ??
    DEFAULT_SENSOR_PROFILES[0]!;

  const step = options.sequenceIndex ?? Math.floor(Date.now() / 1000);
  const wave = Math.sin(step / 6) * profile.amplitude;
  const noise = sampleNormal(rng) * profile.noiseStdDev;
  const shouldSpike =
    options.forceSpike === true ||
    (options.forceSpike !== false &&
      profile.spikeProbability !== undefined &&
      rng() < profile.spikeProbability);
  const spike = shouldSpike ? (profile.spikeDelta ?? profile.amplitude * 2.5) : 0;

  const rawValue = profile.baseline + wave + noise + spike;
  const roundedValue = Number(rawValue.toFixed(2));

  return {
    deviceId: profile.deviceId,
    metric: profile.metric,
    value: roundedValue,
    unit: profile.unit,
    timestamp: options.timestamp ?? new Date(),
    location: profile.location
  };
}

/**
 * Generates a chronological batch of realistic sensor readings across one or more profiles.
 */
export function generateSensorBatch(options: GenerateBatchOptions): TelemetryInput[] {
  const count = Math.max(1, Math.min(1000, Math.floor(options.count)));
  const profiles =
    options.profiles && options.profiles.length > 0 ? options.profiles : DEFAULT_SENSOR_PROFILES;
  const stepMs = options.stepMs ?? 1000;
  const startTime =
    options.startTime ?? new Date(Date.now() - (count - 1) * stepMs);
  const rng = options.rng ?? Math.random;

  const readings: TelemetryInput[] = [];
  for (let i = 0; i < count; i++) {
    const profile = profiles[i % profiles.length]!;
    const timestamp = new Date(startTime.getTime() + i * stepMs);
    readings.push(
      generateSensorReading({
        profile,
        timestamp,
        sequenceIndex: i,
        rng
      })
    );
  }

  return readings;
}

