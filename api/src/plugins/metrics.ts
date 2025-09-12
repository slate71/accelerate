import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/postgres.js';
import { 
  writeVelocityMetric, 
  writeAccelerationMetric, 
  queryVelocityHistory,
  queryAccelerationHistory,
} from '../db/influx.js';
import type { 
  VelocityMetric, 
  AccelerationMetric,
  VelocityResponse,
  AccelerationResponse 
} from '../types/metrics.js';

const TeamMetricsParamsSchema = z.object({
  teamId: z.string().uuid(),
});

const MetricsQuerySchema = z.object({
  days: z.coerce.number().min(1).max(365).default(30),
  repoId: z.string().uuid().optional(),
});

const VelocityMetricSchema = z.object({
  teamId: z.string().uuid(),
  repoId: z.string().uuid().optional(),
  value: z.number().min(0),
  tags: z.record(z.string()).optional(),
});

const AccelerationMetricSchema = z.object({
  teamId: z.string().uuid(),
  value: z.number(),
  trend: z.enum(['improving', 'stable', 'declining']),
  confidence: z.number().min(0).max(1),
});

const metricsPlugin: FastifyPluginAsync = async (fastify) => {
  // Get team metrics overview
  fastify.get<{ 
    Params: { teamId: string }; 
    Querystring: { days?: number; repoId?: string } 
  }>('/teams/:teamId/metrics', {
    schema: {
      tags: ['metrics'],
      description: 'Get team metrics overview',
      params: {
        type: 'object',
        properties: {
          teamId: { type: 'string', format: 'uuid' },
        },
        required: ['teamId'],
      },
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'number', minimum: 1, maximum: 365, default: 30 },
          repoId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            teamId: { type: 'string', format: 'uuid' },
            period: {
              type: 'object',
              properties: {
                days: { type: 'number' },
                startDate: { type: 'string', format: 'date-time' },
                endDate: { type: 'string', format: 'date-time' },
              },
            },
            velocity: {
              type: 'object',
              properties: {
                current: { type: 'number' },
                trend: { type: 'string', enum: ['up', 'down', 'stable'] },
                history: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      date: { type: 'string', format: 'date' },
                      value: { type: 'number' },
                    },
                  },
                },
              },
            },
            acceleration: {
              type: 'object',
              properties: {
                value: { type: 'number' },
                trend: { type: 'string', enum: ['improving', 'stable', 'declining'] },
                confidence: { type: 'number' },
              },
            },
            bottlenecks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  stage: { type: 'string' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                  count: { type: 'number' },
                  avgImpactDays: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { teamId } = TeamMetricsParamsSchema.parse(request.params);
      const { days, repoId } = MetricsQuerySchema.parse(request.query);

      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days);

      // Get velocity history from InfluxDB
      const velocityHistory = await queryVelocityHistory(teamId, days);
      
      // Calculate current velocity and trend
      const recentVelocity = velocityHistory.slice(-7); // Last 7 days
      const previousVelocity = velocityHistory.slice(-14, -7); // Previous 7 days
      
      const currentVelocity = recentVelocity.reduce((sum, v) => sum + v.value, 0) / recentVelocity.length || 0;
      const previousAvg = previousVelocity.reduce((sum, v) => sum + v.value, 0) / previousVelocity.length || 0;
      
      let velocityTrend: 'up' | 'down' | 'stable' = 'stable';
      if (currentVelocity > previousAvg * 1.05) velocityTrend = 'up';
      else if (currentVelocity < previousAvg * 0.95) velocityTrend = 'down';

      // Get acceleration data from InfluxDB
      const accelerationHistory = await queryAccelerationHistory(teamId, days);
      const latestAcceleration = accelerationHistory[accelerationHistory.length - 1] || {
        value: 0,
        trend: 'stable' as const,
        confidence: 0,
      };

      // Get bottlenecks from PostgreSQL
      const bottlenecksResult = await pool.query(`
        SELECT 
          stage,
          severity,
          COUNT(*) as count,
          AVG(impact_days) as "avgImpactDays"
        FROM bottlenecks b
        JOIN pull_requests pr ON b.pull_request_id = pr.id
        JOIN repositories r ON pr.repository_id = r.id
        WHERE r.team_id = $1 
          AND b.created_at >= $2
          ${repoId ? 'AND r.id = $3' : ''}
        GROUP BY stage, severity
        ORDER BY count DESC
      `, repoId ? [teamId, startDate, repoId] : [teamId, startDate]);

      const response: MetricsResponse = {
        teamId,
        period: {
          days,
          startDate,
          endDate,
        },
        velocity: {
          current: currentVelocity,
          trend: velocityTrend,
          history: velocityHistory.map(v => ({
            date: v.time.toISOString().split('T')[0],
            value: v.value,
          })),
        },
        acceleration: {
          value: latestAcceleration.value,
          trend: latestAcceleration.trend,
          confidence: latestAcceleration.confidence,
        },
        bottlenecks: bottlenecksResult.rows,
      };

      return response;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid parameters',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to fetch team metrics:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch team metrics',
      });
    }
  });

  // Record velocity metric
  fastify.post<{ Body: VelocityMetric }>('/metrics/velocity', {
    schema: {
      tags: ['metrics'],
      description: 'Record a velocity metric',
      body: {
        type: 'object',
        properties: {
          teamId: { type: 'string', format: 'uuid' },
          repoId: { type: 'string', format: 'uuid' },
          value: { type: 'number', minimum: 0 },
          tags: { type: 'object' },
        },
        required: ['teamId', 'value'],
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const metric = VelocityMetricSchema.parse(request.body);

      // Verify team exists
      const teamResult = await pool.query('SELECT id FROM teams WHERE id = $1', [metric.teamId]);
      if (teamResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Team not found',
        });
      }

      // If repoId provided, verify it exists and belongs to team
      if (metric.repoId) {
        const repoResult = await pool.query(
          'SELECT id FROM repositories WHERE id = $1 AND team_id = $2',
          [metric.repoId, metric.teamId]
        );
        if (repoResult.rows.length === 0) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Repository not found or does not belong to team',
          });
        }
      }

      await writeVelocityMetric(metric.teamId, metric.repoId, metric.value, metric.tags);

      return reply.status(201).send({
        success: true,
        message: 'Velocity metric recorded successfully',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid metric data',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to record velocity metric:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to record velocity metric',
      });
    }
  });

  // Record acceleration metric
  fastify.post<{ Body: AccelerationMetric }>('/metrics/acceleration', {
    schema: {
      tags: ['metrics'],
      description: 'Record an acceleration metric',
      body: {
        type: 'object',
        properties: {
          teamId: { type: 'string', format: 'uuid' },
          value: { type: 'number' },
          trend: { type: 'string', enum: ['improving', 'stable', 'declining'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['teamId', 'value', 'trend', 'confidence'],
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const metric = AccelerationMetricSchema.parse(request.body);

      // Verify team exists
      const teamResult = await pool.query('SELECT id FROM teams WHERE id = $1', [metric.teamId]);
      if (teamResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Team not found',
        });
      }

      await writeAccelerationMetric(metric.teamId, metric.value, metric.trend, metric.confidence);

      return reply.status(201).send({
        success: true,
        message: 'Acceleration metric recorded successfully',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid metric data',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to record acceleration metric:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to record acceleration metric',
      });
    }
  });

  // Get team repositories
  fastify.get<{ Params: { teamId: string } }>('/teams/:teamId/repositories', {
    schema: {
      tags: ['metrics'],
      description: 'Get repositories for a team',
      params: {
        type: 'object',
        properties: {
          teamId: { type: 'string', format: 'uuid' },
        },
        required: ['teamId'],
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              fullName: { type: 'string' },
              url: { type: 'string', format: 'uri' },
              defaultBranch: { type: 'string' },
              isActive: { type: 'boolean' },
              lastSyncAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { teamId } = TeamMetricsParamsSchema.parse(request.params);

      const result = await pool.query(`
        SELECT 
          id,
          name,
          full_name as "fullName",
          url,
          default_branch as "defaultBranch",
          is_active as "isActive",
          last_sync_at as "lastSyncAt",
          created_at as "createdAt"
        FROM repositories 
        WHERE team_id = $1
        ORDER BY name
      `, [teamId]);

      return result.rows;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid team ID format',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to fetch team repositories:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch team repositories',
      });
    }
  });

  // Get bottlenecks for team
  fastify.get<{ 
    Params: { teamId: string }; 
    Querystring: { days?: number; severity?: string } 
  }>('/teams/:teamId/bottlenecks', {
    schema: {
      tags: ['metrics'],
      description: 'Get bottlenecks for a team',
      params: {
        type: 'object',
        properties: {
          teamId: { type: 'string', format: 'uuid' },
        },
        required: ['teamId'],
      },
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'number', minimum: 1, maximum: 365, default: 30 },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              pullRequestId: { type: 'string', format: 'uuid' },
              stage: { type: 'string' },
              severity: { type: 'string', enum: ['low', 'medium', 'high'] },
              impactDays: { type: 'number' },
              description: { type: 'string' },
              identifiedAt: { type: 'string', format: 'date-time' },
              resolvedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { teamId } = TeamMetricsParamsSchema.parse(request.params);
      const query = z.object({
        days: z.coerce.number().min(1).max(365).default(30),
        severity: z.enum(['low', 'medium', 'high']).optional(),
      }).parse(request.query);

      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - query.days);

      const result = await pool.query(`
        SELECT 
          b.id,
          b.pull_request_id as "pullRequestId",
          b.stage,
          b.severity,
          b.impact_days as "impactDays",
          b.description,
          b.identified_at as "identifiedAt",
          b.resolved_at as "resolvedAt"
        FROM bottlenecks b
        JOIN pull_requests pr ON b.pull_request_id = pr.id
        JOIN repositories r ON pr.repository_id = r.id
        WHERE r.team_id = $1 
          AND b.identified_at >= $2
          ${query.severity ? 'AND b.severity = $3' : ''}
        ORDER BY b.identified_at DESC
      `, query.severity ? [teamId, startDate, query.severity] : [teamId, startDate]);

      return result.rows;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid parameters',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to fetch team bottlenecks:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch team bottlenecks',
      });
    }
  });
};

export default metricsPlugin;