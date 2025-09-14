import { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { GitHubAuthService } from '../services/github/auth.js';
import { GitHubAPIClient } from '../services/github/client.js';
import { pool } from '../db/postgres.js';
import {
  GitHubPullRequestWebhookPayload,
  GitHubPullRequestReviewWebhookPayload,
  GitHubPushWebhookPayload,
} from '../types/github.js';

// Enhanced Request/Response schemas with strict validation
const ConnectRepositorySchema = z.object({
  github_id: z.number().positive(),
  name: z.string().min(1).max(100),
  owner: z.string().min(1).max(100),
  full_name: z.string().min(1).max(200),
  default_branch: z.string().min(1).max(255).optional().default('main'),
  private: z.boolean().optional(),
});

const SyncRepositorySchema = z.object({
  sync_type: z.enum(['full', 'incremental']).optional().default('incremental'),
  since: z.string().datetime().optional(),
});

const AuthorizeSchema = z.object({
  team_id: z.string().uuid(),
  redirect_url: z.string().url().optional(),
});

const CallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const DisconnectSchema = z.object({
  team_id: z.string().uuid(),
});

// Error response helper
function errorResponse(reply: FastifyReply, statusCode: number, message: string, details?: any) {
  return reply.code(statusCode).send({
    error: true,
    statusCode,
    message,
    details,
    timestamp: new Date().toISOString(),
  });
}

export default async function githubPlugin(fastify: FastifyInstance, opts: FastifyPluginOptions) {
  const authService = new GitHubAuthService();

  // Validate required environment variables on plugin registration
  const requiredEnvVars = [
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_WEBHOOK_SECRET',
    'ENCRYPTION_KEY',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Required environment variable ${envVar} is not configured`);
    }
  }

  // GitHub OAuth Authorization
  fastify.get(
    '/github/authorize',
    {
      schema: {
        querystring: AuthorizeSchema,
      },
    },
    async (request, reply) => {
      const { team_id, redirect_url } = request.query as z.infer<typeof AuthorizeSchema>;

      // Verify user has access to team
      const userId = (request as any).auth?.userId;
      if (!userId) {
        return errorResponse(reply, 401, 'Authentication required');
      }

      // Verify user belongs to the team
      const teamCheck = await pool.query(
        'SELECT 1 FROM teams WHERE id = $1 AND clerk_org_id = (SELECT clerk_org_id FROM users WHERE clerk_user_id = $2)',
        [team_id, userId]
      );

      if (teamCheck.rows.length === 0) {
        return errorResponse(reply, 403, 'Access denied to this team');
      }

      try {
        // Generate secure state token with expiry
        const stateToken = await authService.generateStateToken(team_id, userId, redirect_url);
        const authorizationUrl = authService.getAuthorizationUrl(stateToken);

        return {
          authorization_url: authorizationUrl,
        };
      } catch (error: any) {
        fastify.log.error('GitHub authorization error:', error);
        return errorResponse(reply, 500, 'Failed to generate authorization URL');
      }
    }
  );

  // GitHub OAuth Callback
  fastify.get(
    '/github/callback',
    {
      schema: {
        querystring: CallbackSchema,
      },
    },
    async (request, reply) => {
      const { code, state } = request.query as z.infer<typeof CallbackSchema>;

      try {
        // Validate state token (includes expiry check)
        const stateData = await authService.validateStateToken(state);

        // Exchange code for token
        const tokenResponse = await authService.exchangeCodeForToken(code);

        // Get GitHub user info
        const githubUser = await authService.getGitHubUser(tokenResponse.access_token);

        // Store installation (token is encrypted inside this method)
        await authService.storeInstallation(
          stateData.team_id,
          stateData.user_id,
          githubUser.id,
          githubUser.login,
          tokenResponse.access_token,
          tokenResponse.scope,
          tokenResponse.token_type
        );

        return {
          success: true,
          team_id: stateData.team_id,
          github_username: githubUser.login,
          redirect_url: stateData.redirect_url,
        };
      } catch (error: any) {
        fastify.log.error('GitHub OAuth callback error:', error);

        // Specific error handling
        if (error.message.includes('expired')) {
          return errorResponse(reply, 400, 'Authorization expired. Please try again.');
        }
        if (error.message.includes('Invalid')) {
          return errorResponse(reply, 400, 'Invalid authorization request');
        }

        return errorResponse(reply, 400, 'OAuth authorization failed', error.message);
      }
    }
  );

  // Disconnect GitHub
  fastify.post(
    '/github/disconnect',
    {
      schema: {
        body: DisconnectSchema,
      },
    },
    async (request, reply) => {
      const { team_id } = request.body as z.infer<typeof DisconnectSchema>;

      // Verify user has access to team
      const userId = (request as any).auth?.userId;
      if (!userId) {
        return errorResponse(reply, 401, 'Authentication required');
      }

      // Verify user belongs to the team
      const teamCheck = await pool.query(
        'SELECT 1 FROM teams WHERE id = $1 AND clerk_org_id = (SELECT clerk_org_id FROM users WHERE clerk_user_id = $2)',
        [team_id, userId]
      );

      if (teamCheck.rows.length === 0) {
        return errorResponse(reply, 403, 'Access denied to this team');
      }

      try {
        await authService.revokeAccess(team_id);

        // Also remove all repositories for this team
        await pool.query('UPDATE repositories SET is_active = false WHERE team_id = $1', [team_id]);

        return { success: true };
      } catch (error: any) {
        fastify.log.error('GitHub disconnect error:', error);
        return errorResponse(reply, 500, 'Failed to disconnect GitHub');
      }
    }
  );

  // List GitHub repositories
  fastify.get(
    '/github/repositories',
    {
      schema: {
        querystring: z.object({
          team_id: z.string().uuid(),
          visibility: z.enum(['all', 'public', 'private']).optional(),
          page: z.coerce.number().min(1).optional().default(1),
          per_page: z.coerce.number().min(1).max(100).optional().default(30),
        }),
      },
    },
    async (request, reply) => {
      const { team_id, visibility, page, per_page } = request.query as any;

      try {
        // Get access token for team (decrypted automatically)
        const accessToken = await authService.getAccessTokenForTeam(team_id);
        const client = new GitHubAPIClient(accessToken);

        // Fetch repositories from GitHub
        const githubRepos = await client.listRepositories({
          visibility,
          page,
          per_page,
        });

        // Check which ones are already connected
        const connectedRepos = await pool.query(
          'SELECT github_id FROM repositories WHERE team_id = $1 AND is_active = true',
          [team_id]
        );
        const connectedIds = new Set(connectedRepos.rows.map(r => r.github_id));

        const repositories = githubRepos.map(repo => ({
          id: repo.id,
          name: repo.name,
          full_name: repo.full_name,
          owner: {
            login: repo.owner.login,
          },
          private: repo.private,
          description: repo.description || null,
          language: repo.language || null,
          stargazers_count: repo.stargazers_count,
          default_branch: repo.default_branch,
          connected: connectedIds.has(repo.id),
        }));

        return {
          repositories,
          total_count: repositories.length,
          page,
          per_page,
        };
      } catch (error: any) {
        fastify.log.error('List repositories error:', error);

        if (error.message.includes('No GitHub installation')) {
          return errorResponse(reply, 404, 'GitHub not connected for this team');
        }
        if (error.statusCode === 401) {
          return errorResponse(reply, 401, 'GitHub authentication failed');
        }

        return errorResponse(reply, 500, 'Failed to list repositories');
      }
    }
  );

  // Connect repository with transaction and ownership validation
  fastify.post(
    '/github/repositories/:teamId/connect',
    {
      schema: {
        params: z.object({
          teamId: z.string().uuid(),
        }),
        body: ConnectRepositorySchema,
      },
    },
    async (request, reply) => {
      const { teamId } = request.params as { teamId: string };
      const repoData = request.body as z.infer<typeof ConnectRepositorySchema>;

      // Verify user has access to team
      const userId = (request as any).auth?.userId;
      if (!userId) {
        return errorResponse(reply, 401, 'Authentication required');
      }

      const client = await pool.connect();

      try {
        // Start transaction
        await client.query('BEGIN');

        // Get GitHub installation
        const installation = await authService.getInstallation(teamId);
        if (!installation) {
          await client.query('ROLLBACK');
          return errorResponse(reply, 404, 'GitHub not connected for team');
        }

        // Verify repository ownership/access
        const githubClient = new GitHubAPIClient(await authService.getAccessTokenForTeam(teamId));

        try {
          const verifyRepo = await githubClient.getRepository(repoData.owner, repoData.name);

          if (verifyRepo.id !== repoData.github_id) {
            await client.query('ROLLBACK');
            return errorResponse(reply, 400, 'Repository ID mismatch');
          }
        } catch (error: any) {
          await client.query('ROLLBACK');
          if (error.statusCode === 404) {
            return errorResponse(reply, 403, 'No access to this repository');
          }
          throw error;
        }

        // Create repository record
        const repoResult = await client.query(
          `
          INSERT INTO repositories (
            team_id, integration_id, github_id, name, owner, full_name,
            default_branch, is_active, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
          ON CONFLICT (team_id, github_id)
          DO UPDATE SET
            is_active = true,
            updated_at = NOW()
          RETURNING id
        `,
          [
            teamId,
            installation.id,
            repoData.github_id,
            repoData.name,
            repoData.owner,
            repoData.full_name,
            repoData.default_branch || 'main',
          ]
        );

        const repositoryId = repoResult.rows[0].id;

        // Create sync status record
        await client.query(
          `
          INSERT INTO github_sync_status (
            repository_id, last_sync_status, created_at, updated_at
          )
          VALUES ($1, 'pending', NOW(), NOW())
          ON CONFLICT (repository_id) DO NOTHING
        `,
          [repositoryId]
        );

        // Commit transaction
        await client.query('COMMIT');

        // Set up webhook (optional, can fail without rolling back)
        let webhookId: number | undefined;
        try {
          const webhookUrl = `${
            process.env.API_BASE_URL || 'http://localhost:3001'
          }/api/v1/github/webhooks`;
          const webhook = await githubClient.setupWebhook(
            repoData.owner,
            repoData.name,
            webhookUrl
          );
          webhookId = webhook.id;
        } catch (webhookError: any) {
          fastify.log.warn('Failed to set up webhook:', webhookError.message);
        }

        return {
          repository_id: repositoryId,
          webhook_id: webhookId,
          message: 'Repository connected successfully',
        };
      } catch (error: any) {
        await client.query('ROLLBACK');
        fastify.log.error('Connect repository error:', error);
        return errorResponse(reply, 500, 'Failed to connect repository');
      } finally {
        client.release();
      }
    }
  );

  // Manually trigger repository sync
  fastify.post(
    '/github/repositories/:id/sync',
    {
      schema: {
        params: z.object({
          id: z.string().uuid(),
        }),
        body: SyncRepositorySchema,
      },
    },
    async (request, reply) => {
      const { id: repositoryId } = request.params as { id: string };
      const { sync_type, since } = request.body as z.infer<typeof SyncRepositorySchema>;

      try {
        // Verify repository exists and user has access
        const repoCheck = await pool.query(
          `
          SELECT r.id
          FROM repositories r
          JOIN teams t ON r.team_id = t.id
          JOIN users u ON t.clerk_org_id = u.clerk_org_id
          WHERE r.id = $1 AND u.clerk_user_id = $2
        `,
          [repositoryId, (request as any).auth?.userId]
        );

        if (repoCheck.rows.length === 0) {
          return errorResponse(reply, 404, 'Repository not found or access denied');
        }

        // Update sync status
        await pool.query(
          `
          UPDATE github_sync_status
          SET last_sync_status = 'in_progress', last_sync_at = NOW()
          WHERE repository_id = $1
        `,
          [repositoryId]
        );

        // In Phase 4, we'll add this to a job queue
        // For now, return a mock response
        return {
          job_id: `sync-${repositoryId}-${Date.now()}`,
          status: 'queued',
          sync_type,
          message: 'Sync job has been queued',
        };
      } catch (error: any) {
        fastify.log.error('Sync repository error:', error);
        return errorResponse(reply, 500, 'Failed to trigger sync');
      }
    }
  );

  // Get sync status
  fastify.get(
    '/github/sync-status/:repoId',
    {
      schema: {
        params: z.object({
          repoId: z.string().uuid(),
        }),
      },
    },
    async (request, reply) => {
      const { repoId } = request.params as { repoId: string };

      try {
        const result = await pool.query(
          `
          SELECT
            repository_id,
            last_sync_at,
            last_sync_status,
            total_prs_synced,
            rate_limit_remaining,
            rate_limit_reset_at
          FROM github_sync_status
          WHERE repository_id = $1
        `,
          [repoId]
        );

        if (result.rows.length === 0) {
          return errorResponse(reply, 404, 'Sync status not found');
        }

        const status = result.rows[0];
        return {
          repository_id: status.repository_id,
          last_sync_at: status.last_sync_at?.toISOString() || null,
          last_sync_status: status.last_sync_status || null,
          total_prs_synced: status.total_prs_synced || 0,
          rate_limit_remaining: status.rate_limit_remaining || null,
          rate_limit_reset_at: status.rate_limit_reset_at?.toISOString() || null,
        };
      } catch (error: any) {
        fastify.log.error('Get sync status error:', error);
        return errorResponse(reply, 500, 'Failed to get sync status');
      }
    }
  );

  // GitHub webhook endpoint
  fastify.post(
    '/github/webhooks',
    {
      schema: {
        headers: z.object({
          'x-github-event': z.string(),
          'x-github-delivery': z.string(),
          'x-hub-signature-256': z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const event = request.headers['x-github-event'] as string;
      const deliveryId = request.headers['x-github-delivery'] as string;
      const signature = request.headers['x-hub-signature-256'] as string | undefined;

      // Verify webhook signature
      if (!authService.verifyWebhookSignature(JSON.stringify(request.body), signature)) {
        fastify.log.warn('Invalid webhook signature');
        return errorResponse(reply, 401, 'Invalid webhook signature');
      }

      try {
        // Store webhook event for processing
        const payload = request.body as any;

        // Find repository by GitHub ID
        const repoResult = await pool.query('SELECT id FROM repositories WHERE github_id = $1', [
          payload.repository?.id,
        ]);

        if (repoResult.rows.length === 0) {
          fastify.log.warn('Webhook for unknown repository:', payload.repository?.full_name);
          return { status: 'ignored', message: 'Repository not registered' };
        }

        const repositoryId = repoResult.rows[0].id;

        // Store webhook event
        await pool.query(
          `
          INSERT INTO github_webhook_events (
            repository_id, event_type, event_id, action, payload, created_at
          )
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (event_id) DO NOTHING
        `,
          [repositoryId, event, deliveryId, payload.action, JSON.stringify(payload)]
        );

        // In Phase 4, we'll process this through a job queue
        fastify.log.info(`Webhook event stored: ${event} - ${deliveryId}`);

        return { status: 'accepted', event_id: deliveryId };
      } catch (error: any) {
        fastify.log.error('Webhook processing error:', error);
        return errorResponse(reply, 500, 'Failed to process webhook');
      }
    }
  );
}
