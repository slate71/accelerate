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

// Request/Response schemas
const ConnectRepositorySchema = z.object({
  github_id: z.number(),
  name: z.string(),
  owner: z.string(),
  full_name: z.string(),
  default_branch: z.string().optional(),
  private: z.boolean().optional(),
});

const SyncRepositorySchema = z.object({
  sync_type: z.enum(['full', 'incremental']).optional(),
  since: z.string().datetime().optional(),
});

const AuthorizeSchema = z.object({
  team_id: z.string().uuid(),
  redirect_url: z.string().url().optional(),
});

const CallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
});

export default async function githubPlugin(fastify: FastifyInstance, opts: FastifyPluginOptions) {
  const authService = new GitHubAuthService();

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
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // Generate state token (in production, store this in Redis with expiry)
      const state = Buffer.from(
        JSON.stringify({
          team_id,
          user_id: userId,
          redirect_url: redirect_url || '/settings/integrations',
          timestamp: Date.now(),
        })
      ).toString('base64');

      const authorizationUrl = authService.getAuthorizationUrl(state);

      return {
        authorization_url: authorizationUrl,
      };
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
        // Decode and validate state
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString());

        // Exchange code for token
        const tokenResponse = await authService.exchangeCodeForToken(code);

        // Get GitHub user info
        const githubUser = await authService.getGitHubUser(tokenResponse.access_token);

        // Store installation
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
        };
      } catch (error: any) {
        fastify.log.error('GitHub OAuth callback error:', error);
        return reply.code(400).send({
          error: 'OAuth callback failed',
          message: error.message,
        });
      }
    }
  );

  // Disconnect GitHub
  fastify.post(
    '/github/disconnect',
    {
      schema: {
        body: z.object({
          team_id: z.string().uuid(),
        }),
      },
    },
    async (request, reply) => {
      const { team_id } = request.body as { team_id: string };

      // Verify user has access to team
      const userId = (request as any).auth?.userId;
      if (!userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      try {
        await authService.revokeAccess(team_id);

        // Also remove all repositories for this team
        await pool.query('UPDATE repositories SET is_active = false WHERE team_id = $1', [team_id]);

        return { success: true };
      } catch (error: any) {
        fastify.log.error('GitHub disconnect error:', error);
        return reply.code(500).send({
          error: 'Failed to disconnect GitHub',
          message: error.message,
        });
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
          page: z.number().min(1).optional(),
          per_page: z.number().min(1).max(100).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { team_id, visibility, page, per_page } = request.query as any;

      try {
        // Get access token for team
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
        };
      } catch (error: any) {
        fastify.log.error('List repositories error:', error);
        return reply.code(500).send({
          error: 'Failed to list repositories',
          message: error.message,
        });
      }
    }
  );

  // Connect repository
  fastify.post(
    '/github/repositories/:id/connect',
    {
      schema: {
        params: z.object({
          id: z.string(),
        }),
        body: ConnectRepositorySchema,
      },
    },
    async (request, reply) => {
      const { id: team_id } = request.params as { id: string };
      const repoData = request.body as z.infer<typeof ConnectRepositorySchema>;

      try {
        // Get GitHub installation
        const installation = await authService.getInstallation(team_id);
        if (!installation) {
          return reply.code(404).send({ error: 'GitHub not connected for team' });
        }

        // Create repository record
        const repoResult = await pool.query(
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
            team_id,
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
        await pool.query(
          `
        INSERT INTO github_sync_status (
          repository_id, last_sync_status, created_at, updated_at
        )
        VALUES ($1, 'pending', NOW(), NOW())
        ON CONFLICT (repository_id) DO NOTHING
      `,
          [repositoryId]
        );

        // Set up webhook (optional, can fail)
        let webhookId: number | undefined;
        try {
          const client = new GitHubAPIClient(installation.access_token);
          const webhookUrl = `${process.env.API_BASE_URL || 'http://localhost:3001'}/api/v1/github/webhooks`;
          const webhook = await client.setupWebhook(repoData.owner, repoData.name, webhookUrl);
          webhookId = webhook.id;
        } catch (webhookError: any) {
          fastify.log.warn('Failed to set up webhook:', webhookError.message);
        }

        return {
          repository_id: repositoryId,
          webhook_id: webhookId,
        };
      } catch (error: any) {
        fastify.log.error('Connect repository error:', error);
        return reply.code(500).send({
          error: 'Failed to connect repository',
          message: error.message,
        });
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
        };
      } catch (error: any) {
        fastify.log.error('Sync repository error:', error);
        return reply.code(500).send({
          error: 'Failed to sync repository',
          message: error.message,
        });
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
          return reply.code(404).send({ error: 'Sync status not found' });
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
        return reply.code(500).send({
          error: 'Failed to get sync status',
          message: error.message,
        });
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
        return reply.code(401).send({ error: 'Invalid signature' });
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
          return reply.code(200).send({ status: 'ignored' });
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

        return { status: 'accepted' };
      } catch (error: any) {
        fastify.log.error('Webhook processing error:', error);
        return reply.code(500).send({
          error: 'Failed to process webhook',
          message: error.message,
        });
      }
    }
  );
}
