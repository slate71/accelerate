import Redis from "ioredis";
import { config } from "dotenv";

config();

// Redis configuration with retry strategy
const redisConfig = {
  host: process.env.REDIS_HOST || "redis",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "redis_dev_password",
  db: 0,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    console.log(`Retrying Redis connection... Attempt ${times}`);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    const targetError = "READONLY";
    if (err.message.includes(targetError)) {
      // Only reconnect when the error contains "READONLY"
      return true;
    }
    return false;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
};

// Create Redis client
const redis = new Redis(redisConfig);

// Event handlers
redis.on("connect", () => {
  console.log("✅ Redis client connected");
});

redis.on("ready", () => {
  console.log("✅ Redis client ready");
});

redis.on("error", (err) => {
  console.error("Redis client error:", err);
});

redis.on("close", () => {
  console.log("Redis connection closed");
});

redis.on("reconnecting", (delay: number) => {
  console.log(`Redis client reconnecting in ${delay}ms`);
});

// Cache key patterns with version prefix
const CACHE_KEYS = {
  TEAM_DASHBOARD: (teamId: string) => `v1:team:${teamId}:dashboard`,
  TEAM_VELOCITY_7D: (teamId: string) => `v1:team:${teamId}:velocity:7d`,
  TEAM_VELOCITY_30D: (teamId: string) => `v1:team:${teamId}:velocity:30d`,
  TEAM_VELOCITY_90D: (teamId: string) => `v1:team:${teamId}:velocity:90d`,
  TEAM_ACCELERATION: (teamId: string) => `v1:team:${teamId}:acceleration:current`,
  TEAM_BOTTLENECKS: (teamId: string) => `v1:team:${teamId}:bottlenecks`,
  REPO_METRICS: (repoId: string) => `v1:repo:${repoId}:metrics`,
  HEALTH_CHECK: () => "v1:health:check",
};

// Cache TTL values (in seconds)
const CACHE_TTL = {
  DASHBOARD: 60, // 1 minute
  VELOCITY_SHORT: 300, // 5 minutes
  VELOCITY_LONG: 900, // 15 minutes
  ACCELERATION: 30, // 30 seconds
  BOTTLENECKS: 120, // 2 minutes
  REPO_METRICS: 600, // 10 minutes
  DEFAULT: 300, // 5 minutes default
};

// Helper function to get cached data
async function getCached<T = any>(key: string): Promise<T | null> {
  try {
    const data = await redis.get(key);
    if (data) {
      return JSON.parse(data);
    }
    return null;
  } catch (error) {
    console.error(`Error getting cached data for key ${key}:`, error);
    return null;
  }
}

// Helper function to set cached data
async function setCached(key: string, data: any, ttl: number = CACHE_TTL.DEFAULT): Promise<boolean> {
  try {
    await redis.setex(key, ttl, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error(`Error setting cached data for key ${key}:`, error);
    return false;
  }
}

// Helper function to invalidate cache patterns
async function invalidatePattern(pattern: string): Promise<number> {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(
        `Invalidated ${keys.length} cache keys matching pattern: ${pattern}`,
      );
    }
    return keys.length;
  } catch (error) {
    console.error(`Error invalidating cache pattern ${pattern}:`, error);
    return 0;
  }
}

// Helper function to invalidate team cache
async function invalidateTeamCache(teamId: string): Promise<number> {
  const pattern = `v1:team:${teamId}:*`;
  return await invalidatePattern(pattern);
}

// Circuit breaker pattern for cache operations
class CacheCircuitBreaker {
  private failureCount = 0;
  private threshold: number;
  private timeout: number;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private nextAttempt = Date.now();

  constructor(threshold = 5, timeout = 60000) {
    this.threshold = threshold;
    this.timeout = timeout;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T | null> {
    if (this.state === "open") {
      if (Date.now() < this.nextAttempt) {
        return null; // Circuit is open, skip cache
      }
      this.state = "half-open";
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.state = "closed";
  }

  onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.threshold) {
      this.state = "open";
      this.nextAttempt = Date.now() + this.timeout;
      console.log(
        `Cache circuit breaker opened. Will retry at ${new Date(this.nextAttempt)}`,
      );
    }
  }
}

const cacheBreaker = new CacheCircuitBreaker();

// Wrapped cache operations with circuit breaker
async function getWithCircuitBreaker<T = any>(key: string): Promise<T | null> {
  return await cacheBreaker.execute(() => getCached(key));
}

async function setWithCircuitBreaker(key: string, data: any, ttl?: number): Promise<boolean | null> {
  return await cacheBreaker.execute(() => setCached(key, data, ttl));
}

// Test connection function
async function testConnection(): Promise<boolean> {
  try {
    await redis.set(CACHE_KEYS.HEALTH_CHECK(), "OK", "EX", 10);
    const result = await redis.get(CACHE_KEYS.HEALTH_CHECK());
    if (result === "OK") {
      console.log("✅ Redis connected and operational");
      return true;
    }
    return false;
  } catch (error) {
    console.error("❌ Redis connection failed:", (error as Error).message);
    return false;
  }
}

// Graceful shutdown
async function close(): Promise<void> {
  await redis.quit();
  console.log("Redis connection closed");
}

// Named exports
export {
  redis,
  CACHE_KEYS,
  CACHE_TTL,
  getCached,
  setCached,
  invalidatePattern,
  invalidateTeamCache,
  getWithCircuitBreaker,
  setWithCircuitBreaker,
  testConnection,
  close,
};

// Default export for backwards compatibility
export default {
  redis,
  CACHE_KEYS,
  CACHE_TTL,
  getCached,
  setCached,
  invalidatePattern,
  invalidateTeamCache,
  getWithCircuitBreaker,
  setWithCircuitBreaker,
  testConnection,
  close,
};
