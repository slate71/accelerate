import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/postgres.js';
import { 
  queryVelocityHistory,
  queryAccelerationHistory,
} from '../db/influx.js';
import type { 
  DashboardData,
} from '../types/api.js';

const DashboardQuerySchema = z.object({
  teamId: z.string().uuid().optional(),
  days: z.coerce.number().min(1).max(365).default(30),
});

const AlertConfigSchema = z.object({
  teamId: z.string().uuid(),
  velocityThreshold: z.number().min(0).optional(),
  accelerationThreshold: z.number().optional(),
  bottleneckThreshold: z.number().min(0).optional(),
  enabled: z.boolean().default(true),
});

const dashboardPlugin: FastifyPluginAsync = async (fastify) => {
  // Get dashboard overview
  fastify.get<{ Querystring: { teamId?: string; days?: number } }>('/dashboard', {
    schema: {
      tags: ['dashboard'],
      description: 'Get dashboard overview data',
      querystring: {
        type: 'object',
        properties: {
          teamId: { type: 'string', format: 'uuid' },
          days: { type: 'number', minimum: 1, maximum: 365, default: 30 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            summary: {
              type: 'object',
              properties: {
                totalTeams: { type: 'number' },
                totalRepositories: { type: 'number' },
                totalPullRequests: { type: 'number' },
                activePullRequests: { type: 'number' },
                totalBottlenecks: { type: 'number' },
                activeBottlenecks: { type: 'number' },
              },
            },
            teams: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  currentVelocity: { type: 'number' },
                  velocityTrend: { type: 'string', enum: ['up', 'down', 'stable'] },
                  accelerationTrend: { type: 'string', enum: ['improving', 'stable', 'declining'] },
                  bottleneckCount: { type: 'number' },
                  lastUpdated: { type: 'string', format: 'date-time' },
                },
              },
            },
            topBottlenecks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  stage: { type: 'string' },
                  count: { type: 'number' },
                  avgImpactDays: { type: 'number' },
                },
              },
            },
            alerts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['velocity_drop', 'acceleration_decline', 'bottleneck_spike'] },
                  teamId: { type: 'string', format: 'uuid' },
                  teamName: { type: 'string' },
                  severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                  message: { type: 'string' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { teamId, days } = DashboardQuerySchema.parse(request.query);

      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days);

      // Get summary statistics
      const summaryResult = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM teams ${teamId ? 'WHERE id = $1' : ''}) as "totalTeams",
          (SELECT COUNT(*) FROM repositories ${teamId ? 'WHERE team_id = $1' : ''}) as "totalRepositories",
          (SELECT COUNT(*) FROM pull_requests pr 
           ${teamId ? 'JOIN repositories r ON pr.repository_id = r.id WHERE r.team_id = $1' : ''}) as "totalPullRequests",
          (SELECT COUNT(*) FROM pull_requests pr 
           ${teamId ? 'JOIN repositories r ON pr.repository_id = r.id' : ''}
           WHERE pr.status = 'open' ${teamId ? 'AND r.team_id = $1' : ''}) as "activePullRequests",
          (SELECT COUNT(*) FROM bottlenecks b
           JOIN pull_requests pr ON b.pull_request_id = pr.id
           ${teamId ? 'JOIN repositories r ON pr.repository_id = r.id WHERE r.team_id = $1' : ''}) as "totalBottlenecks",
          (SELECT COUNT(*) FROM bottlenecks b
           JOIN pull_requests pr ON b.pull_request_id = pr.id
           ${teamId ? 'JOIN repositories r ON pr.repository_id = r.id' : ''}
           WHERE b.resolved_at IS NULL ${teamId ? 'AND r.team_id = $1' : ''}) as "activeBottlenecks"
      `, teamId ? [teamId] : []);

      // Get team summaries
      const teamsResult = await pool.query(`
        SELECT 
          t.id,
          t.name,
          t.updated_at as "lastUpdated",
          COALESCE(active_bottlenecks.count, 0) as "bottleneckCount"
        FROM teams t
        LEFT JOIN (
          SELECT 
            r.team_id,
            COUNT(*) as count
          FROM bottlenecks b
          JOIN pull_requests pr ON b.pull_request_id = pr.id
          JOIN repositories r ON pr.repository_id = r.id
          WHERE b.resolved_at IS NULL
          GROUP BY r.team_id
        ) active_bottlenecks ON t.id = active_bottlenecks.team_id
        ${teamId ? 'WHERE t.id = $1' : ''}
        ORDER BY t.name
      `, teamId ? [teamId] : []);

      // Get velocity and acceleration data for each team
      const teams: TeamSummary[] = [];
      for (const team of teamsResult.rows) {
        try {
          const velocityHistory = await queryVelocityHistory(team.id, 14);
          const accelerationHistory = await queryAccelerationHistory(team.id, 30);

          const recentVelocity = velocityHistory.slice(-7);
          const previousVelocity = velocityHistory.slice(-14, -7);
          
          const currentVelocity = recentVelocity.reduce((sum, v) => sum + v.value, 0) / recentVelocity.length || 0;
          const previousAvg = previousVelocity.reduce((sum, v) => sum + v.value, 0) / previousVelocity.length || 0;
          
          let velocityTrend: 'up' | 'down' | 'stable' = 'stable';
          if (currentVelocity > previousAvg * 1.05) velocityTrend = 'up';
          else if (currentVelocity < previousAvg * 0.95) velocityTrend = 'down';

          const latestAcceleration = accelerationHistory[accelerationHistory.length - 1];
          const accelerationTrend = latestAcceleration?.trend || 'stable';

          teams.push({
            id: team.id,
            name: team.name,
            currentVelocity,
            velocityTrend,
            accelerationTrend,
            bottleneckCount: team.bottleneckCount,
            lastUpdated: team.lastUpdated,
          });
        } catch (error) {
          fastify.log.warn(`Failed to get metrics for team ${team.id}:`, error);
          teams.push({
            id: team.id,
            name: team.name,
            currentVelocity: 0,
            velocityTrend: 'stable',
            accelerationTrend: 'stable',
            bottleneckCount: team.bottleneckCount,
            lastUpdated: team.lastUpdated,
          });
        }
      }

      // Get top bottlenecks
      const bottlenecksResult = await pool.query(`
        SELECT 
          b.stage,
          COUNT(*) as count,
          AVG(b.impact_days) as "avgImpactDays"
        FROM bottlenecks b
        JOIN pull_requests pr ON b.pull_request_id = pr.id
        ${teamId ? 'JOIN repositories r ON pr.repository_id = r.id WHERE r.team_id = $1 AND' : 'WHERE'} 
          b.identified_at >= $${teamId ? '2' : '1'}
        GROUP BY b.stage
        ORDER BY count DESC
        LIMIT 10
      `, teamId ? [teamId, startDate] : [startDate]);

      // Generate alerts based on team performance
      const alerts = [];
      for (const team of teams) {
        if (team.velocityTrend === 'down') {
          alerts.push({
            type: 'velocity_drop',
            teamId: team.id,
            teamName: team.name,
            severity: 'medium',
            message: `Team ${team.name} has experienced a velocity drop`,
            createdAt: new Date(),
          });
        }
        
        if (team.accelerationTrend === 'declining') {
          alerts.push({
            type: 'acceleration_decline',
            teamId: team.id,
            teamName: team.name,
            severity: 'medium',
            message: `Team ${team.name} shows declining acceleration`,
            createdAt: new Date(),
          });
        }

        if (team.bottleneckCount > 5) {
          alerts.push({
            type: 'bottleneck_spike',
            teamId: team.id,
            teamName: team.name,
            severity: team.bottleneckCount > 10 ? 'high' : 'medium',
            message: `Team ${team.name} has ${team.bottleneckCount} active bottlenecks`,
            createdAt: new Date(),
          });
        }
      }

      const dashboardData: DashboardData = {
        summary: summaryResult.rows[0],
        teams,
        topBottlenecks: bottlenecksResult.rows,
        alerts,
      };

      return dashboardData;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid query parameters',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to fetch dashboard data:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch dashboard data',
      });
    }
  });

  // Get team insights
  fastify.get<{ Params: { teamId: string }; Querystring: { days?: number } }>('/teams/:teamId/insights', {
    schema: {
      tags: ['dashboard'],
      description: 'Get detailed insights for a team',
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
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              type: { type: 'string', enum: ['performance', 'bottleneck', 'trend', 'recommendation'] },
              title: { type: 'string' },
              description: { type: 'string' },
              impact: { type: 'string', enum: ['low', 'medium', 'high'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              data: { type: 'object' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { teamId } = z.object({ teamId: z.string().uuid() }).parse(request.params);
      const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(request.query);

      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - days);

      const result = await pool.query(`
        SELECT 
          i.id,
          i.type,
          i.title,
          i.description,
          i.impact,
          i.confidence,
          i.data,
          i.created_at as "createdAt"
        FROM insights i
        WHERE i.team_id = $1 
          AND i.created_at >= $2
        ORDER BY i.created_at DESC
      `, [teamId, startDate]);

      return result.rows;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid parameters',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to fetch team insights:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch team insights',
      });
    }
  });

  // Configure team alerts
  fastify.put<{ 
    Params: { teamId: string }; 
    Body: AlertConfig 
  }>('/teams/:teamId/alerts', {
    schema: {
      tags: ['dashboard'],
      description: 'Configure alert thresholds for a team',
      params: {
        type: 'object',
        properties: {
          teamId: { type: 'string', format: 'uuid' },
        },
        required: ['teamId'],
      },
      body: {
        type: 'object',
        properties: {
          teamId: { type: 'string', format: 'uuid' },
          velocityThreshold: { type: 'number', minimum: 0 },
          accelerationThreshold: { type: 'number' },
          bottleneckThreshold: { type: 'number', minimum: 0 },
          enabled: { type: 'boolean', default: true },
        },
        required: ['teamId'],
      },
      response: {
        200: {
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
      const { teamId } = z.object({ teamId: z.string().uuid() }).parse(request.params);
      const config = AlertConfigSchema.parse(request.body);

      if (config.teamId !== teamId) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Team ID in URL must match team ID in body',
        });
      }

      // Verify team exists
      const teamResult = await pool.query('SELECT id FROM teams WHERE id = $1', [teamId]);
      if (teamResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Team not found',
        });
      }

      // Store alert configuration (this would typically be in a separate alerts_config table)
      // For now, we'll store it in the team's metadata or create a simple config storage
      await pool.query(`
        INSERT INTO team_alert_configs (
          team_id, 
          velocity_threshold, 
          acceleration_threshold, 
          bottleneck_threshold, 
          enabled,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (team_id) 
        DO UPDATE SET 
          velocity_threshold = $2,
          acceleration_threshold = $3,
          bottleneck_threshold = $4,
          enabled = $5,
          updated_at = NOW()
      `, [
        teamId,
        config.velocityThreshold,
        config.accelerationThreshold,
        config.bottleneckThreshold,
        config.enabled,
      ]);

      return {
        success: true,
        message: 'Alert configuration updated successfully',
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid alert configuration',
          details: error.errors,
        });
      }

      // Handle case where alert config table doesn't exist yet
      if (error.code === '42P01') {
        fastify.log.warn('Alert config table does not exist, skipping alert configuration');
        return {
          success: true,
          message: 'Alert configuration feature not yet implemented',
        };
      }

      fastify.log.error('Failed to update alert configuration:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update alert configuration',
      });
    }
  });

  // Get real-time metrics (WebSocket endpoint data)
  fastify.get<{ Querystring: { teamIds?: string } }>('/realtime/metrics', {
    schema: {
      tags: ['dashboard'],
      description: 'Get real-time metrics for WebSocket broadcasting',
      querystring: {
        type: 'object',
        properties: {
          teamIds: { type: 'string', description: 'Comma-separated team IDs' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            timestamp: { type: 'string', format: 'date-time' },
            teams: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  velocity: { type: 'number' },
                  acceleration: { type: 'number' },
                  activeBottlenecks: { type: 'number' },
                  recentPRs: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { teamIds } = z.object({
        teamIds: z.string().optional(),
      }).parse(request.query);

      const teamIdList = teamIds ? teamIds.split(',').map(id => id.trim()) : [];
      const teamFilter = teamIdList.length > 0 ? `WHERE t.id = ANY($1)` : '';

      // Get current metrics for requested teams
      const result = await pool.query(`
        SELECT 
          t.id,
          t.name,
          COALESCE(active_bottlenecks.count, 0) as "activeBottlenecks",
          COALESCE(recent_prs.count, 0) as "recentPRs"
        FROM teams t
        LEFT JOIN (
          SELECT 
            r.team_id,
            COUNT(*) as count
          FROM bottlenecks b
          JOIN pull_requests pr ON b.pull_request_id = pr.id
          JOIN repositories r ON pr.repository_id = r.id
          WHERE b.resolved_at IS NULL
          GROUP BY r.team_id
        ) active_bottlenecks ON t.id = active_bottlenecks.team_id
        LEFT JOIN (
          SELECT 
            r.team_id,
            COUNT(*) as count
          FROM pull_requests pr
          JOIN repositories r ON pr.repository_id = r.id
          WHERE pr.created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY r.team_id
        ) recent_prs ON t.id = recent_prs.team_id
        ${teamFilter}
        ORDER BY t.name
      `, teamIdList.length > 0 ? [teamIdList] : []);

      const metrics = {};
      for (const team of result.rows) {
        try {
          const velocityHistory = await queryVelocityHistory(team.id, 1);
          const accelerationHistory = await queryAccelerationHistory(team.id, 1);

          metrics[team.id] = {
            velocity: velocityHistory[0]?.value || 0,
            acceleration: accelerationHistory[0]?.value || 0,
            activeBottlenecks: team.activeBottlenecks,
            recentPRs: team.recentPRs,
          };
        } catch (error) {
          fastify.log.warn(`Failed to get real-time metrics for team ${team.id}:`, error);
          metrics[team.id] = {
            velocity: 0,
            acceleration: 0,
            activeBottlenecks: team.activeBottlenecks,
            recentPRs: team.recentPRs,
          };
        }
      }

      return {
        timestamp: new Date(),
        teams: metrics,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid query parameters',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to fetch real-time metrics:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch real-time metrics',
      });
    }
  });
};

export default dashboardPlugin;