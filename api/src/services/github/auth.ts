import { FastifyRequest } from 'fastify';
import { pool } from '../../db/postgres.js';
import { GitHubInstallation, GitHubAuthError, GitHubAuthConfig } from '../../types/github.js';
import * as crypto from 'crypto';
import { encrypt, decrypt, generateSecureToken } from '../../utils/crypto.js';
import { redis } from '../../db/redis.js';

// OAuth App Auth implementation
interface OAuthTokenResponse {
  token: string;
  tokenType?: string;
  scopes?: string[];
}

// State token expiry time (10 minutes)
const STATE_TOKEN_EXPIRY = 10 * 60; // 10 minutes in seconds

export class GitHubAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(config?: GitHubAuthConfig) {
    this.clientId = config?.client_id || process.env.GITHUB_CLIENT_ID!;
    this.clientSecret = config?.client_secret || process.env.GITHUB_CLIENT_SECRET!;
    this.redirectUri = config?.redirect_uri || process.env.GITHUB_REDIRECT_URI!;

    if (!this.clientId || !this.clientSecret) {
      throw new Error('GitHub OAuth credentials not configured');
    }
  }

  /**
   * Generate and store a secure state token with expiry
   */
  async generateStateToken(teamId: string, userId: string, redirectUrl?: string): Promise<string> {
    const stateToken = generateSecureToken(32);
    const stateData = {
      team_id: teamId,
      user_id: userId,
      redirect_url: redirectUrl || '/settings/integrations',
      timestamp: Date.now(),
    };

    try {
      // Store in Redis with expiry
      const redisKey = `github:state:${stateToken}`;
      await redis.setex(redisKey, STATE_TOKEN_EXPIRY, JSON.stringify(stateData));
      return stateToken;
    } catch (error: any) {
      // Fallback: Encode state directly (less secure but functional)
      console.error('Redis unavailable for state token storage:', error.message);
      // Include timestamp for manual expiry checking
      const fallbackState = Buffer.from(JSON.stringify(stateData)).toString('base64');
      return fallbackState;
    }
  }

  /**
   * Validate and retrieve state token data
   */
  async validateStateToken(stateToken: string): Promise<{
    team_id: string;
    user_id: string;
    redirect_url: string;
  }> {
    try {
      // Try Redis first
      const redisKey = `github:state:${stateToken}`;
      const stateDataStr = await redis.get(redisKey);

      if (stateDataStr) {
        // Delete the token after use (one-time use)
        await redis.del(redisKey);
        const stateData = JSON.parse(stateDataStr);

        // Additional timestamp validation
        const age = Date.now() - stateData.timestamp;
        if (age > STATE_TOKEN_EXPIRY * 1000) {
          throw new GitHubAuthError('State token has expired');
        }

        return stateData;
      }
    } catch (redisError: any) {
      console.error('Redis error during state validation:', redisError.message);
    }

    // Fallback: Try to decode base64 state
    try {
      const stateData = JSON.parse(Buffer.from(stateToken, 'base64').toString());

      // Validate timestamp
      if (!stateData.timestamp) {
        throw new GitHubAuthError('Invalid state token format');
      }

      const age = Date.now() - stateData.timestamp;
      if (age > STATE_TOKEN_EXPIRY * 1000) {
        throw new GitHubAuthError('State token has expired');
      }

      return stateData;
    } catch (error) {
      throw new GitHubAuthError('Invalid or expired state token');
    }
  }

  /**
   * Get authorization URL for GitHub OAuth
   */
  getAuthorizationUrl(state: string, scopes: string[] = ['repo', 'read:org', 'read:user']): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: scopes.join(' '),
      state: state,
      allow_signup: 'true',
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<{
    access_token: string;
    token_type: string;
    scope: string;
  }> {
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: code,
        }),
      });

      if (!response.ok) {
        throw new Error(`GitHub OAuth error: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        token_type: string;
        scope: string;
        error?: string;
        error_description?: string;
      };

      if (data.error) {
        throw new Error(data.error_description || data.error);
      }

      return {
        access_token: data.access_token,
        token_type: data.token_type || 'bearer',
        scope: data.scope || '',
      };
    } catch (error: any) {
      throw new GitHubAuthError(`Failed to exchange code for token: ${error.message}`);
    }
  }

  /**
   * Store GitHub installation for a team
   */
  async storeInstallation(
    teamId: string,
    clerkUserId: string,
    githubUserId: string,
    githubUsername: string,
    accessToken: string,
    scope?: string,
    tokenType?: string
  ): Promise<GitHubInstallation> {
    const query = `
      INSERT INTO github_installations (
        team_id, clerk_user_id, github_user_id, github_username,
        access_token, scope, token_type, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (team_id, github_user_id)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        scope = EXCLUDED.scope,
        token_type = EXCLUDED.token_type,
        updated_at = NOW()
      RETURNING *
    `;

    try {
      // Encrypt the access token before storing
      const encryptedToken = encrypt(accessToken);

      const result = await pool.query(query, [
        teamId,
        clerkUserId,
        githubUserId,
        githubUsername,
        encryptedToken,
        scope,
        tokenType,
      ]);

      return result.rows[0];
    } catch (error: any) {
      throw new GitHubAuthError(`Failed to store GitHub installation: ${error.message}`);
    }
  }

  /**
   * Get GitHub installation for a team
   */
  async getInstallation(teamId: string): Promise<GitHubInstallation | null> {
    const query = `
      SELECT * FROM github_installations
      WHERE team_id = $1
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    try {
      const result = await pool.query(query, [teamId]);
      return result.rows[0] || null;
    } catch (error: any) {
      throw new GitHubAuthError(`Failed to get GitHub installation: ${error.message}`);
    }
  }

  /**
   * Get access token for a team (with Clerk integration)
   */
  async getAccessTokenForTeam(teamId: string): Promise<string> {
    const installation = await this.getInstallation(teamId);

    if (!installation) {
      throw new GitHubAuthError('No GitHub installation found for team');
    }

    // Decrypt the token before returning
    try {
      return decrypt(installation.access_token);
    } catch (error) {
      throw new GitHubAuthError('Failed to decrypt access token');
    }
  }

  /**
   * Revoke GitHub access for a team
   */
  async revokeAccess(teamId: string): Promise<void> {
    const installation = await this.getInstallation(teamId);

    if (!installation) {
      return;
    }

    try {
      // Decrypt token for revocation
      const accessToken = decrypt(installation.access_token);

      // Revoke token with GitHub
      const response = await fetch(`https://api.github.com/applications/${this.clientId}/token`, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
            'base64'
          )}`,
          Accept: 'application/vnd.github.v3+json',
        },
        body: JSON.stringify({
          access_token: accessToken,
        }),
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to revoke token: ${response.statusText}`);
      }

      // Remove from database
      await pool.query('DELETE FROM github_installations WHERE team_id = $1', [teamId]);
    } catch (error: any) {
      throw new GitHubAuthError(`Failed to revoke GitHub access: ${error.message}`);
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string | undefined): boolean {
    if (!signature) {
      return false;
    }

    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('GitHub webhook secret not configured');
    }

    const hmac = crypto.createHmac('sha256', webhookSecret);
    const digest = 'sha256=' + hmac.update(payload).digest('hex');

    // Constant time comparison to prevent timing attacks
    const sourceBuffer = Buffer.from(signature);
    const digestBuffer = Buffer.from(digest);

    if (sourceBuffer.length !== digestBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sourceBuffer, digestBuffer);
  }

  /**
   * Get user info from GitHub using access token
   */
  async getGitHubUser(accessToken: string): Promise<{
    id: string;
    login: string;
    name?: string;
    email?: string;
  }> {
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        id: number;
        login: string;
        name?: string;
        email?: string;
      };

      const result: {
        id: string;
        login: string;
        name?: string;
        email?: string;
      } = {
        id: data.id.toString(),
        login: data.login,
      };

      if (data.name) result.name = data.name;
      if (data.email) result.email = data.email;

      return result;
    } catch (error: any) {
      throw new GitHubAuthError(`Failed to get GitHub user info: ${error.message}`);
    }
  }

  /**
   * List all installations for a user
   */
  async listUserInstallations(clerkUserId: string): Promise<GitHubInstallation[]> {
    const query = `
      SELECT * FROM github_installations
      WHERE clerk_user_id = $1
      ORDER BY updated_at DESC
    `;

    try {
      const result = await pool.query(query, [clerkUserId]);
      return result.rows;
    } catch (error: any) {
      throw new GitHubAuthError(`Failed to list user installations: ${error.message}`);
    }
  }
}
