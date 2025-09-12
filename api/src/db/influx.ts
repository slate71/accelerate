import { InfluxDB, Point, flux } from '@influxdata/influxdb-client';
import { BucketsAPI, OrgsAPI } from '@influxdata/influxdb-client-apis';
import { config } from 'dotenv';

config();

// InfluxDB configuration
const url = process.env.INFLUXDB_URL || 'http://influxdb:8086';
const token = process.env.INFLUXDB_TOKEN || 'dev_token_please_change';
const org = process.env.INFLUXDB_ORG || 'accelerate';
const bucket = process.env.INFLUXDB_BUCKET || 'metrics';

// Create InfluxDB client
const influxDB = new InfluxDB({ url, token });

// Create write and query APIs
const writeApi = influxDB.getWriteApi(org, bucket, "ns");
const queryApi = influxDB.getQueryApi(org);

// Bucket and org APIs for management
const bucketsAPI = new BucketsAPI(influxDB);
const orgsAPI = new OrgsAPI(influxDB);

// Write buffer settings
writeApi.useDefaultTags({ environment: process.env.NODE_ENV || 'development' });

// Measurement definitions
export const MEASUREMENTS = {
  VELOCITY: 'velocity_metrics',
  ACCELERATION: 'acceleration_metrics',
  BOTTLENECK: 'bottleneck_events',
  CYCLE_TIME: 'cycle_time_metrics',
  THROUGHPUT: 'throughput_metrics',
} as const;

// Helper function to write velocity metrics
async function writeVelocityMetric(teamId: string, repoId: string | null, value: number, tags: Record<string, string> = {}) {
  const point = new Point(MEASUREMENTS.VELOCITY)
    .tag("team_id", teamId)
    .tag("repo_id", repoId || "all")
    .floatField("value", value)
    .timestamp(new Date());

  Object.entries(tags).forEach(([key, val]) => {
    point.tag(key, val);
  });

  writeApi.writePoint(point);
  await writeApi.flush();
}

// Helper function to write acceleration metrics
async function writeAccelerationMetric(teamId: string, value: number, trend: string, confidence: number) {
  const point = new Point(MEASUREMENTS.ACCELERATION)
    .tag("team_id", teamId)
    .tag("trend", trend) // 'improving', 'stable', 'declining'
    .floatField("value", value)
    .floatField("confidence", confidence)
    .timestamp(new Date());

  writeApi.writePoint(point);
  await writeApi.flush();
}

// Helper function to write bottleneck events
async function writeBottleneckEvent(teamId: string, stage: string, severity: string, impactDays: number) {
  const point = new Point(MEASUREMENTS.BOTTLENECK)
    .tag("team_id", teamId)
    .tag("stage", stage) // 'review', 'testing', 'merge', etc.
    .tag("severity", severity) // 'low', 'medium', 'high'
    .floatField("impact_days", impactDays)
    .timestamp(new Date());

  writeApi.writePoint(point);
  await writeApi.flush();
}

// Query helper for velocity history
async function queryVelocityHistory(teamId: string, days = 30): Promise<Array<{ time: any; value: number; repo_id: string }>> {
  const fluxQuery = flux`
    from(bucket: "${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r._measurement == "${MEASUREMENTS.VELOCITY}")
      |> filter(fn: (r) => r.team_id == "${teamId}")
      |> filter(fn: (r) => r._field == "value")
      |> aggregateWindow(every: 1d, fn: mean, createEmpty: false)
      |> yield(name: "velocity")
  `;

  const results: Array<{ time: any; value: number; repo_id: string }> = [];
  await queryApi.collectRows(fluxQuery, (row: any) => {
    results.push({
      time: row._time,
      value: row._value,
      repo_id: row.repo_id,
    });
  });

  return results;
}

// Query helper for acceleration history
async function queryAccelerationHistory(teamId: string, days = 90): Promise<Array<{ time: any; value: number; confidence: number; trend: string }>> {
  const fluxQuery = flux`
    from(bucket: "${bucket}")
      |> range(start: -${days}d)
      |> filter(fn: (r) => r._measurement == "${MEASUREMENTS.ACCELERATION}")
      |> filter(fn: (r) => r.team_id == "${teamId}")
      |> filter(fn: (r) => r._field == "value" or r._field == "confidence")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> keep(columns: ["_time", "value", "confidence", "trend"])
      |> sort(columns: ["_time"])
  `;

  const results: Array<{ time: any; value: number; confidence: number; trend: string }> = [];
  await queryApi.collectRows(fluxQuery, (row: any) => {
    results.push({
      time: row._time,
      value: row.value,
      confidence: row.confidence,
      trend: row.trend,
    });
  });

  return results;
}

// Test connection function
async function testConnection(): Promise<boolean> {
  try {
    // Try to query the bucket
    const fluxQuery = `from(bucket: "${bucket}") |> range(start: -1m) |> limit(n: 1)`;
    await queryApi.collectRows(fluxQuery);
    console.log("✅ InfluxDB connected to bucket:", bucket);
    return true;
  } catch (error) {
    console.error("❌ InfluxDB connection failed:", (error as Error).message);
    return false;
  }
}

// Initialize bucket if it doesn't exist
async function initializeBucket(): Promise<void> {
  try {
    const orgs = await orgsAPI.getOrgs({ org });
    if (orgs && orgs.orgs && orgs.orgs.length > 0) {
      const orgID = orgs.orgs[0]?.id;

      const buckets = await bucketsAPI.getBuckets({ org, name: bucket });
      if (!buckets || !buckets.buckets || buckets.buckets.length === 0) {
        await bucketsAPI.postBuckets({
          body: {
            orgID,
            name: bucket,
            retentionRules: [
              {
                type: "expire",
                everySeconds: 90 * 24 * 60 * 60, // 90 days retention
              },
            ],
          },
        });
        console.log(`✅ Created InfluxDB bucket: ${bucket}`);
      }
    }
  } catch (error) {
    console.error("Error initializing InfluxDB bucket:", error);
  }
}

// Graceful shutdown
async function close(): Promise<void> {
  await writeApi.close();
  console.log("InfluxDB connection closed");
}

// Named exports
export {
  influxDB,
  writeApi,
  queryApi,
  writeVelocityMetric,
  writeAccelerationMetric,
  writeBottleneckEvent,
  queryVelocityHistory,
  queryAccelerationHistory,
  testConnection,
  initializeBucket,
  close,
};

// Default export for backwards compatibility
const influxExports = {
  influxDB,
  writeApi,
  queryApi,
  MEASUREMENTS,
  writeVelocityMetric,
  writeAccelerationMetric,
  writeBottleneckEvent,
  queryVelocityHistory,
  queryAccelerationHistory,
  testConnection,
  initializeBucket,
  close,
};

export default influxExports;
