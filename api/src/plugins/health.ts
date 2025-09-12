import { FastifyPluginAsync } from 'fastify';
import { testConnection as testPostgres, pool } from '../db/postgres.js';
import { testConnection as testInflux } from '../db/influx.js';
import { testConnection as testRedis } from '../db/redis.js';
import type { HealthCheckResponse, DetailedHealthResponse } from '../types/api.js';

const healthPlugin: FastifyPluginAsync = async (fastify) => {
  // Basic health check
  fastify.get<{ Reply: HealthCheckResponse }>('/health', {
    schema: {
      tags: ['health'],
      description: 'Basic health check endpoint',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'unhealthy', 'degraded'] },
            timestamp: { type: 'string' },
            responseTime: { type: 'string' },
            services: {
              type: 'object',
              properties: {
                postgres: { oneOf: [{ type: 'boolean' }, { type: 'string' }] },
                influx: { oneOf: [{ type: 'boolean' }, { type: 'string' }] },
                redis: { oneOf: [{ type: 'boolean' }, { type: 'string' }] },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const startTime = Date.now();

    try {
      // Run all health checks in parallel
      const [postgres, influx, redis] = await Promise.all([
        testPostgres(),
        testInflux(),
        testRedis(),
      ]);

      const responseTime = Date.now() - startTime;
      const healthy = postgres && influx && redis;

      return reply.status(healthy ? 200 : 503).send({
        status: healthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        services: {
          postgres: postgres ? 'healthy' : 'unhealthy',
          influx: influx ? 'healthy' : 'unhealthy',
          redis: redis ? 'healthy' : 'unhealthy',
        },
      });
    } catch (error) {
      return reply.status(503).send({
        status: 'unhealthy',
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
        services: {
          postgres: false,
          influx: false,
          redis: false,
        },
      } as any);
    }
  });

  // Liveness probe (for Kubernetes)
  fastify.get('/health/live', {
    schema: {
      tags: ['health'],
      description: 'Liveness probe endpoint',
    },
  }, async (_request, _reply) => {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  });

  // Readiness probe (for Kubernetes)
  fastify.get('/health/ready', {
    schema: {
      tags: ['health'],
      description: 'Readiness probe endpoint',
    },
  }, async (request, reply) => {
    try {
      // Quick checks to ensure service is ready
      await Promise.all([
        pool.query('SELECT 1'),
        // Add other readiness checks as needed
      ]);

      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return reply.status(503).send({
        status: 'not_ready',
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Detailed health information
  fastify.get<{ Reply: DetailedHealthResponse }>('/health/detailed', {
    schema: {
      tags: ['health'],
      description: 'Detailed health check with service information',
    },
  }, async (request, reply) => {
    const startTime = Date.now();
    const details: any = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {},
    };

    try {
      // PostgreSQL detailed check
      try {
        const pgResult = await pool.query(`
          SELECT 
            version() as version,
            current_database() as database,
            pg_database_size(current_database()) as size,
            (SELECT count(*) FROM teams) as teams_count,
            (SELECT count(*) FROM repositories) as repos_count,
            (SELECT count(*) FROM pull_requests) as prs_count
        `);

        details.services.postgres = {
          status: 'healthy',
          ...pgResult.rows[0],
          pool: {
            total: pool.totalCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount,
          },
        };
      } catch (error) {
        details.services.postgres = {
          status: 'unhealthy',
          error: (error as Error).message,
        };
      }

      // InfluxDB detailed check
      try {
        const influxOk = await testInflux();
        details.services.influx = {
          status: influxOk ? 'healthy' : 'unhealthy',
          bucket: process.env.INFLUXDB_BUCKET || 'metrics',
          org: process.env.INFLUXDB_ORG || 'accelerate',
        };
      } catch (error) {
        details.services.influx = {
          status: 'unhealthy',
          error: (error as Error).message,
        };
      }

      // Redis detailed check
      try {
        const redisOk = await testRedis();
        details.services.redis = {
          status: redisOk ? 'healthy' : 'unhealthy',
        };
      } catch (error) {
        details.services.redis = {
          status: 'unhealthy',
          error: (error as Error).message,
        };
      }

      const responseTime = Date.now() - startTime;
      details.responseTime = `${responseTime}ms`;

      const allHealthy = Object.values(details.services).every((s: any) => s.status === 'healthy');
      details.status = allHealthy ? 'healthy' : 'degraded';

      return reply.status(allHealthy ? 200 : 503).send(details);
    } catch (error) {
      return reply.status(503).send({
        status: 'unhealthy',
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      });
    }
  });
};

export default healthPlugin;