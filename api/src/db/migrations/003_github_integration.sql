-- GitHub Integration Migration
-- Adds tables and columns needed for GitHub data pipeline

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- GitHub installations table for OAuth tokens and connection data
CREATE TABLE IF NOT EXISTS github_installations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  clerk_user_id VARCHAR(255) REFERENCES users(clerk_user_id),
  github_user_id VARCHAR(255),
  github_username VARCHAR(255),
  access_token TEXT, -- Encrypted using AES-256-GCM
  installation_id BIGINT,
  scope VARCHAR(500), -- OAuth scopes granted
  token_type VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, github_user_id)
);

-- GitHub sync status tracking
CREATE TABLE IF NOT EXISTS github_sync_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
  last_sync_at TIMESTAMP,
  last_sync_status VARCHAR(50), -- 'success', 'failed', 'in_progress'
  last_error TEXT,
  total_prs_synced INTEGER DEFAULT 0,
  sync_cursor VARCHAR(255), -- For incremental syncing using GitHub cursors
  last_commit_sha VARCHAR(255), -- Track last processed commit
  rate_limit_remaining INTEGER,
  rate_limit_reset_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(repository_id)
);

-- Add missing GitHub-specific columns to repositories
ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS default_branch VARCHAR(255) DEFAULT 'main',
ADD COLUMN IF NOT EXISTS visibility VARCHAR(50), -- 'public', 'private', 'internal'
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS disabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS fork BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS language VARCHAR(100),
ADD COLUMN IF NOT EXISTS size INTEGER,
ADD COLUMN IF NOT EXISTS stars_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS forks_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS open_issues_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS topics TEXT[], -- Array of topics/tags
ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS github_created_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS github_updated_at TIMESTAMP;

-- Add missing GitHub-specific columns to pull_requests
ALTER TABLE pull_requests
ADD COLUMN IF NOT EXISTS draft BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS merged_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS base_branch VARCHAR(255),
ADD COLUMN IF NOT EXISTS head_branch VARCHAR(255),
ADD COLUMN IF NOT EXISTS commits INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS first_approval_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS labels TEXT[], -- Array of label names
ADD COLUMN IF NOT EXISTS assignees TEXT[], -- Array of assignee usernames
ADD COLUMN IF NOT EXISTS requested_reviewers TEXT[], -- Array of requested reviewer usernames
ADD COLUMN IF NOT EXISTS milestone VARCHAR(255),
ADD COLUMN IF NOT EXISTS body TEXT, -- PR description
ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_merge BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS merge_commit_sha VARCHAR(255);

-- GitHub webhook events tracking
CREATE TABLE IF NOT EXISTS github_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
  event_type VARCHAR(100), -- 'pull_request', 'push', 'pull_request_review', etc.
  event_id VARCHAR(255), -- GitHub's X-GitHub-Delivery header
  action VARCHAR(100), -- 'opened', 'closed', 'merged', etc.
  payload JSONB,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMP,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(event_id)
);

-- GitHub rate limit tracking
CREATE TABLE IF NOT EXISTS github_rate_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  installation_id UUID REFERENCES github_installations(id) ON DELETE CASCADE,
  resource VARCHAR(50), -- 'core', 'search', 'graphql'
  limit_value INTEGER,
  remaining INTEGER,
  reset_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(installation_id, resource)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_github_installations_team ON github_installations(team_id);
CREATE INDEX IF NOT EXISTS idx_github_installations_user ON github_installations(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_github_installations_github_user ON github_installations(github_user_id);
CREATE INDEX IF NOT EXISTS idx_repositories_github_id ON repositories(github_id);
CREATE INDEX IF NOT EXISTS idx_repositories_team_id ON repositories(team_id);
CREATE INDEX IF NOT EXISTS idx_repositories_active ON repositories(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pull_requests_github_id ON pull_requests(github_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repository ON pull_requests(repository_id);
CREATE INDEX IF NOT EXISTS idx_pull_requests_state ON pull_requests(state);
CREATE INDEX IF NOT EXISTS idx_pull_requests_dates ON pull_requests(created_at, merged_at);
CREATE INDEX IF NOT EXISTS idx_github_webhook_events_repo ON github_webhook_events(repository_id);
CREATE INDEX IF NOT EXISTS idx_github_webhook_events_processed ON github_webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_github_sync_status_repo ON github_sync_status(repository_id);

-- Add comments for documentation
COMMENT ON TABLE github_installations IS 'Stores GitHub OAuth installations and tokens for teams';
COMMENT ON TABLE github_sync_status IS 'Tracks synchronization state for each repository';
COMMENT ON TABLE github_webhook_events IS 'Queues incoming GitHub webhook events for processing';
COMMENT ON TABLE github_rate_limits IS 'Monitors GitHub API rate limits per installation';

COMMENT ON COLUMN github_installations.access_token IS 'Encrypted OAuth access token';
COMMENT ON COLUMN github_installations.clerk_user_id IS 'References Clerk user who authorized the installation';
COMMENT ON COLUMN github_sync_status.sync_cursor IS 'GitHub GraphQL cursor for pagination';
COMMENT ON COLUMN github_sync_status.last_commit_sha IS 'Last processed commit SHA for incremental updates';
COMMENT ON COLUMN repositories.topics IS 'GitHub repository topics/tags as array';
COMMENT ON COLUMN pull_requests.labels IS 'GitHub PR labels as array';
