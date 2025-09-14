# GitHub Integration Setup Guide

## Prerequisites

Before setting up the GitHub integration, ensure you have:
- A GitHub account with permissions to create OAuth Apps
- Access to your team's repositories
- Administrator access to the Accelerate dashboard

## Environment Variables

### Required Variables

#### `ENCRYPTION_KEY`
**Critical**: This key is used to encrypt sensitive OAuth tokens before database storage.

```bash
# Generate a secure encryption key (minimum 32 characters)
openssl rand -base64 32

# Add to your .env file
ENCRYPTION_KEY=your_generated_key_here
```

⚠️ **Security Notes**:
- Never commit this key to version control
- Use different keys for each environment (dev, staging, prod)
- Store production keys in a secure secret management system
- Rotate keys periodically (requires re-encrypting existing tokens)

#### GitHub OAuth Configuration

1. **Create a GitHub OAuth App**:
   - Go to https://github.com/settings/developers
   - Click "New OAuth App"
   - Fill in the details:
     - **Application name**: Accelerate Dashboard
     - **Homepage URL**: Your application URL
     - **Authorization callback URL**: `https://your-domain.com/api/v1/github/callback`
   - Save the Client ID and Client Secret

2. **Configure Environment Variables**:
```bash
# GitHub OAuth App credentials
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret

# Webhook secret for signature verification
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# OAuth callback URL (must match GitHub app settings)
GITHUB_REDIRECT_URI=https://your-domain.com/api/v1/github/callback
```

## Database Setup

Run the GitHub integration migration:

```bash
./scripts/run-github-migration.sh
```

This creates the following tables:
- `github_installations` - Stores encrypted OAuth tokens
- `github_sync_status` - Tracks repository sync progress
- `github_webhook_events` - Queues incoming webhooks
- `github_rate_limits` - Monitors API rate limits

## Redis Configuration

The GitHub integration uses Redis for:
- State token storage with automatic expiry (10 minutes)
- Job queue management (Phase 4)
- Rate limit caching

Ensure Redis is running and accessible:
```bash
# Test Redis connection
redis-cli ping
```

### Fallback Behavior

If Redis is unavailable:
- State tokens will be encoded in base64 with timestamp validation
- OAuth flow will continue to work but with reduced security
- Recommendation: Ensure Redis is highly available in production

## Security Considerations

### Token Encryption
- All OAuth access tokens are encrypted using AES-256-GCM
- Tokens are decrypted only when needed for API calls
- Encryption key is never logged or exposed

### State Token Validation
- State tokens expire after 10 minutes
- One-time use (deleted after validation)
- Stored in Redis with automatic expiry
- Fallback to timestamp validation if Redis unavailable

### Repository Access Validation
- Repository ownership verified via GitHub API before connection
- User permissions checked against team membership
- All operations wrapped in database transactions

## API Endpoints

### Authentication Flow
1. **Initialize OAuth**: `GET /api/v1/github/authorize?team_id=UUID`
2. **OAuth Callback**: `GET /api/v1/github/callback?code=CODE&state=STATE`
3. **Disconnect**: `POST /api/v1/github/disconnect`

### Repository Management
- **List Repos**: `GET /api/v1/github/repositories?team_id=UUID`
- **Connect Repo**: `POST /api/v1/github/repositories/connect`
- **Trigger Sync**: `POST /api/v1/github/repositories/:id/sync`
- **Check Status**: `GET /api/v1/github/sync-status/:repoId`

### Webhooks
- **Endpoint**: `POST /api/v1/github/webhooks`
- **Verification**: HMAC-SHA256 signature validation
- **Events**: pull_request, pull_request_review, push

## Troubleshooting

### Common Issues

#### "Encryption key not configured"
- Ensure `ENCRYPTION_KEY` is set in environment variables
- Key must be at least 32 characters

#### "Invalid or expired state token"
- State tokens expire after 10 minutes
- User must restart OAuth flow if token expires

#### "No access to this repository"
- Verify GitHub user has access to the repository
- Check OAuth scopes include `repo` permission

#### Redis Connection Errors
- Check Redis is running: `redis-cli ping`
- Verify Redis URL in environment variables
- OAuth will fallback to stateless tokens if Redis unavailable

## Monitoring

### Key Metrics to Track
- OAuth success/failure rates
- State token expiry occurrences
- Repository sync durations
- API rate limit usage
- Webhook processing latency

### Recommended Alerts
- Failed OAuth attempts > 5 in 5 minutes
- API rate limit < 100 remaining
- Sync job failures > 3 consecutive
- Webhook signature validation failures

## Next Steps

After completing Phase 1 setup:
1. Implement data collection (Phase 2)
2. Add job queue with BullMQ (Phase 3)
3. Set up cron schedulers (Phase 4)
4. Add monitoring and alerting (Phase 5)
