import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/postgres.js';
import type { 
  CreateTeamRequest, 
  UpdateTeamRequest,
  TeamWithMembers 
} from '../types/database.js';

const CreateTeamSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  githubOrg: z.string().optional(),
  slackChannel: z.string().optional(),
});

const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  githubOrg: z.string().optional(),
  slackChannel: z.string().optional(),
});

const TeamParamsSchema = z.object({
  id: z.string().uuid(),
});

const teamsPlugin: FastifyPluginAsync = async (fastify) => {
  // Get all teams
  fastify.get('/teams', {
    schema: {
      tags: ['teams'],
      description: 'Get all teams',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              description: { type: 'string' },
              githubOrg: { type: 'string' },
              slackChannel: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const result = await pool.query(`
        SELECT 
          id,
          name,
          description,
          github_org as "githubOrg",
          slack_channel as "slackChannel",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM teams 
        ORDER BY name
      `);

      return result.rows;
    } catch (error) {
      fastify.log.error('Failed to fetch teams:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch teams',
      });
    }
  });

  // Get team by ID with members
  fastify.get<{ Params: { id: string } }>('/teams/:id', {
    schema: {
      tags: ['teams'],
      description: 'Get team by ID with members',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string' },
            githubOrg: { type: 'string' },
            slackChannel: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            members: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  role: { type: 'string', enum: ['member', 'lead', 'admin'] },
                  githubUsername: { type: 'string' },
                },
              },
            },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = TeamParamsSchema.parse(request.params);

      const teamResult = await pool.query(`
        SELECT 
          id,
          name,
          description,
          github_org as "githubOrg",
          slack_channel as "slackChannel",
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM teams 
        WHERE id = $1
      `, [id]);

      if (teamResult.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Team not found',
        });
      }

      const membersResult = await pool.query(`
        SELECT 
          tm.id,
          tm.name,
          tm.email,
          tm.role,
          tm.github_username as "githubUsername"
        FROM team_members tm
        WHERE tm.team_id = $1
        ORDER BY tm.name
      `, [id]);

      const team: TeamWithMembers = {
        ...teamResult.rows[0],
        members: membersResult.rows,
      };

      return team;
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid team ID format',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to fetch team:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch team',
      });
    }
  });

  // Create new team
  fastify.post<{ Body: CreateTeamRequest }>('/teams', {
    schema: {
      tags: ['teams'],
      description: 'Create a new team',
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string' },
          githubOrg: { type: 'string' },
          slackChannel: { type: 'string' },
        },
        required: ['name'],
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string' },
            githubOrg: { type: 'string' },
            slackChannel: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            details: { type: 'array' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const teamData = CreateTeamSchema.parse(request.body);

      const result = await pool.query(`
        INSERT INTO teams (name, description, github_org, slack_channel)
        VALUES ($1, $2, $3, $4)
        RETURNING 
          id,
          name,
          description,
          github_org as "githubOrg",
          slack_channel as "slackChannel",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `, [
        teamData.name,
        teamData.description || null,
        teamData.githubOrg || null,
        teamData.slackChannel || null,
      ]);

      return reply.status(201).send(result.rows[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid team data',
          details: error.errors,
        });
      }

      if ((error as any).code === '23505') { // unique_violation
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Team with this name already exists',
        });
      }

      fastify.log.error('Failed to create team:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create team',
      });
    }
  });

  // Update team
  fastify.put<{ Params: { id: string }; Body: UpdateTeamRequest }>('/teams/:id', {
    schema: {
      tags: ['teams'],
      description: 'Update team by ID',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string' },
          githubOrg: { type: 'string' },
          slackChannel: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string' },
            githubOrg: { type: 'string' },
            slackChannel: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = TeamParamsSchema.parse(request.params);
      const updates = UpdateTeamSchema.parse(request.body);

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'No fields to update provided',
        });
      }

      const setParts = [];
      const values = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        setParts.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        setParts.push(`description = $${paramIndex++}`);
        values.push(updates.description);
      }
      if (updates.githubOrg !== undefined) {
        setParts.push(`github_org = $${paramIndex++}`);
        values.push(updates.githubOrg);
      }
      if (updates.slackChannel !== undefined) {
        setParts.push(`slack_channel = $${paramIndex++}`);
        values.push(updates.slackChannel);
      }

      values.push(id);

      const result = await pool.query(`
        UPDATE teams 
        SET ${setParts.join(', ')}, updated_at = NOW()
        WHERE id = $${paramIndex}
        RETURNING 
          id,
          name,
          description,
          github_org as "githubOrg",
          slack_channel as "slackChannel",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `, values);

      if (result.rows.length === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Team not found',
        });
      }

      return result.rows[0];
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid data',
          details: error.errors,
        });
      }

      if ((error as any).code === '23505') { // unique_violation
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Team with this name already exists',
        });
      }

      fastify.log.error('Failed to update team:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update team',
      });
    }
  });

  // Delete team
  fastify.delete<{ Params: { id: string } }>('/teams/:id', {
    schema: {
      tags: ['teams'],
      description: 'Delete team by ID',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
        required: ['id'],
      },
      response: {
        204: {},
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = TeamParamsSchema.parse(request.params);

      const result = await pool.query('DELETE FROM teams WHERE id = $1', [id]);

      if (result.rowCount === 0) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Team not found',
        });
      }

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Invalid team ID format',
          details: error.errors,
        });
      }

      fastify.log.error('Failed to delete team:', error);
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete team',
      });
    }
  });
};

export default teamsPlugin;