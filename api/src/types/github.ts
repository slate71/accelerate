// GitHub Integration Types

export interface GitHubInstallation {
  id: string;
  team_id: string;
  clerk_user_id: string;
  github_user_id: string;
  github_username: string;
  access_token: string;
  installation_id?: number;
  scope?: string;
  token_type?: string;
  created_at: Date;
  updated_at: Date;
}

export interface GitHubSyncStatus {
  id: string;
  repository_id: string;
  last_sync_at?: Date;
  last_sync_status?: 'success' | 'failed' | 'in_progress';
  last_error?: string;
  total_prs_synced: number;
  sync_cursor?: string;
  last_commit_sha?: string;
  rate_limit_remaining?: number;
  rate_limit_reset_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface GitHubWebhookEvent {
  id: string;
  repository_id: string;
  event_type: string;
  event_id: string;
  action?: string;
  payload: any;
  processed: boolean;
  processed_at?: Date;
  error?: string;
  created_at: Date;
}

export interface GitHubRateLimit {
  id: string;
  installation_id: string;
  resource: 'core' | 'search' | 'graphql';
  limit: number;
  remaining: number;
  reset_at: Date;
  updated_at: Date;
}

// GitHub API Response Types
export interface GitHubRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    node_id: string;
    type: string;
  };
  private: boolean;
  description?: string;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at?: string;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  language?: string;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  archived: boolean;
  disabled: boolean;
  visibility?: 'public' | 'private' | 'internal';
  topics?: string[];
}

export interface GitHubPullRequest {
  id: number;
  node_id: string;
  number: number;
  state: 'open' | 'closed';
  locked: boolean;
  title: string;
  body?: string;
  user: {
    login: string;
    id: number;
  };
  created_at: string;
  updated_at: string;
  closed_at?: string;
  merged_at?: string;
  merge_commit_sha?: string;
  assignees?: Array<{
    login: string;
    id: number;
  }>;
  requested_reviewers?: Array<{
    login: string;
    id: number;
  }>;
  labels?: Array<{
    id: number;
    name: string;
    color: string;
  }>;
  milestone?: {
    title: string;
    number: number;
  };
  draft: boolean;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  base: {
    ref: string;
    sha: string;
  };
  head: {
    ref: string;
    sha: string;
  };
  merged_by?: {
    login: string;
    id: number;
  };
  review_comments: number;
  comments: number;
  auto_merge?: {
    enabled: boolean;
    merge_method: string;
  };
}

export interface GitHubReview {
  id: number;
  user: {
    login: string;
    id: number;
  };
  body?: string;
  state: 'PENDING' | 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED';
  submitted_at?: string;
  commit_id: string;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name?: string;
      email?: string;
      date: string;
    };
    committer: {
      name?: string;
      email?: string;
      date: string;
    };
    message: string;
  };
  author?: {
    login: string;
    id: number;
  };
  committer?: {
    login: string;
    id: number;
  };
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
}

// GraphQL Types for batch operations
export interface GitHubGraphQLPRNode {
  id: string;
  number: number;
  title: string;
  body?: string;
  state: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  mergedAt?: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: {
    login: string;
  };
  baseRefName: string;
  headRefName: string;
  mergeCommit?: {
    oid: string;
  };
  mergedBy?: {
    login: string;
  };
  commits: {
    totalCount: number;
  };
  reviews?: {
    totalCount: number;
    nodes: Array<{
      state: string;
      submittedAt?: string;
      author: {
        login: string;
      };
    }>;
  };
  reviewRequests?: {
    totalCount: number;
    nodes: Array<{
      requestedReviewer: {
        login?: string;
      };
    }>;
  };
  labels?: {
    nodes: Array<{
      name: string;
      color: string;
    }>;
  };
  assignees?: {
    nodes: Array<{
      login: string;
    }>;
  };
  milestone?: {
    title: string;
    number: number;
  };
}

export interface GitHubGraphQLResponse {
  repository: {
    pullRequests: {
      totalCount: number;
      pageInfo: {
        hasNextPage: boolean;
        endCursor?: string;
      };
      nodes: GitHubGraphQLPRNode[];
    };
  };
}

// Webhook Event Types
export interface GitHubPullRequestWebhookPayload {
  action:
    | 'opened'
    | 'closed'
    | 'reopened'
    | 'synchronize'
    | 'ready_for_review'
    | 'converted_to_draft'
    | 'edited'
    | 'assigned'
    | 'unassigned'
    | 'labeled'
    | 'unlabeled'
    | 'review_requested'
    | 'review_request_removed';
  number: number;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: {
    login: string;
    id: number;
  };
}

export interface GitHubPullRequestReviewWebhookPayload {
  action: 'submitted' | 'edited' | 'dismissed';
  review: GitHubReview;
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
  sender: {
    login: string;
    id: number;
  };
}

export interface GitHubPushWebhookPayload {
  ref: string;
  before: string;
  after: string;
  repository: GitHubRepository;
  pusher: {
    name: string;
    email?: string;
  };
  sender: {
    login: string;
    id: number;
  };
  commits: Array<{
    id: string;
    message: string;
    timestamp: string;
    author: {
      name: string;
      email: string;
    };
    added: string[];
    removed: string[];
    modified: string[];
  }>;
}

// Job Queue Types
export interface GitHubSyncJob {
  repository_id: string;
  sync_type: 'full' | 'incremental';
  since?: Date;
  cursor?: string;
  priority: number;
}

export interface GitHubMetricsJob {
  team_id: string;
  repository_ids?: string[];
  period_start: Date;
  period_end: Date;
  metrics_types: Array<'velocity' | 'throughput' | 'cycle_time' | 'review_time'>;
}

export interface GitHubWebhookJob {
  event_id: string;
  event_type: string;
  repository_id: string;
  payload: any;
}

// Configuration Types
export interface GitHubSyncConfig {
  interval_minutes: number;
  batch_size: number;
  max_retries: number;
  rate_limit_buffer: number;
  concurrency: number;
}

export interface GitHubAuthConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  webhook_secret: string;
}

// Error Types
export class GitHubAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public rateLimitRemaining?: number,
    public rateLimitReset?: Date
  ) {
    super(message);
    this.name = 'GitHubAPIError';
  }
}

export class GitHubRateLimitError extends GitHubAPIError {
  constructor(
    public override rateLimitRemaining: number,
    public override rateLimitReset: Date
  ) {
    super(`GitHub API rate limit exceeded. Resets at ${rateLimitReset.toISOString()}`, 429);
    this.name = 'GitHubRateLimitError';
  }
}

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubAuthError';
  }
}
