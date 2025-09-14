import {
  GitHubRepository,
  GitHubPullRequest,
  GitHubReview,
  GitHubCommit,
  GitHubGraphQLResponse,
  GitHubGraphQLPRNode,
  GitHubAPIError,
  GitHubRateLimitError,
} from '../../types/github.js';

export class GitHubAPIClient {
  private accessToken: string;
  private baseUrl = 'https://api.github.com';
  private graphqlUrl = 'https://api.github.com/graphql';

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Make authenticated REST API request
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ data: T; headers: Headers }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    this.checkRateLimit(response.headers);

    if (!response.ok) {
      throw this.handleErrorResponse(response);
    }

    const data = await response.json();
    return { data: data as T, headers: response.headers };
  }

  /**
   * Make GraphQL request
   */
  private async graphql<T>(query: string, variables: any = {}): Promise<T> {
    const response = await fetch(this.graphqlUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    this.checkRateLimit(response.headers);

    if (!response.ok) {
      throw this.handleErrorResponse(response);
    }

    const result = (await response.json()) as { data?: T; errors?: any[] };

    if (result.errors) {
      throw new GitHubAPIError(
        `GraphQL error: ${result.errors[0]?.message || 'Unknown error'}`,
        response.status
      );
    }

    return result.data as T;
  }

  /**
   * List repositories for authenticated user
   */
  async listRepositories(
    options: {
      visibility?: 'all' | 'public' | 'private';
      affiliation?: string;
      sort?: 'created' | 'updated' | 'pushed' | 'full_name';
      per_page?: number;
      page?: number;
    } = {}
  ): Promise<GitHubRepository[]> {
    const params = new URLSearchParams({
      visibility: options.visibility || 'all',
      affiliation: options.affiliation || 'owner,collaborator,organization_member',
      sort: options.sort || 'updated',
      per_page: String(options.per_page || 100),
      page: String(options.page || 1),
    });

    const { data } = await this.request<GitHubRepository[]>(`/user/repos?${params.toString()}`);

    return data;
  }

  /**
   * Get repository details
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const { data } = await this.request<GitHubRepository>(`/repos/${owner}/${repo}`);
    return data;
  }

  /**
   * Batch fetch pull requests using GraphQL (70% fewer API calls)
   */
  async batchFetchPullRequests(
    owner: string,
    repo: string,
    options: {
      cursor?: string;
      first?: number;
      states?: string[];
      since?: Date;
    } = {}
  ): Promise<{
    pullRequests: GitHubGraphQLPRNode[];
    hasNextPage: boolean;
    endCursor: string | undefined;
    totalCount: number;
  }> {
    const query = `
      query($owner: String!, $repo: String!, $first: Int!, $after: String, $states: [PullRequestState!]) {
        repository(owner: $owner, name: $repo) {
          pullRequests(first: $first, after: $after, states: $states, orderBy: {field: UPDATED_AT, direction: DESC}) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              number
              title
              body
              state
              isDraft
              createdAt
              updatedAt
              closedAt
              mergedAt
              additions
              deletions
              changedFiles
              author {
                login
              }
              baseRefName
              headRefName
              mergeCommit {
                oid
              }
              mergedBy {
                login
              }
              commits {
                totalCount
              }
              reviews(first: 100) {
                totalCount
                nodes {
                  state
                  submittedAt
                  author {
                    login
                  }
                }
              }
              reviewRequests(first: 50) {
                totalCount
                nodes {
                  requestedReviewer {
                    ... on User {
                      login
                    }
                    ... on Team {
                      name
                    }
                  }
                }
              }
              labels(first: 20) {
                nodes {
                  name
                  color
                }
              }
              assignees(first: 10) {
                nodes {
                  login
                }
              }
              milestone {
                title
                number
              }
            }
          }
        }
      }
    `;

    const response = await this.graphql<GitHubGraphQLResponse>(query, {
      owner,
      repo,
      first: options.first || 50,
      after: options.cursor,
      states: options.states || ['OPEN', 'CLOSED', 'MERGED'],
    });

    const { pullRequests } = response.repository;

    // Filter by date if specified
    let nodes = pullRequests.nodes;
    if (options.since) {
      nodes = nodes.filter(pr => new Date(pr.updatedAt) >= options.since!);
    }

    return {
      pullRequests: nodes,
      hasNextPage: pullRequests.pageInfo.hasNextPage,
      endCursor: pullRequests.pageInfo.endCursor,
      totalCount: pullRequests.totalCount,
    };
  }

  /**
   * Get pull request details
   */
  async getPullRequestDetails(
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubPullRequest> {
    const { data } = await this.request<GitHubPullRequest>(
      `/repos/${owner}/${repo}/pulls/${number}`
    );
    return data;
  }

  /**
   * Get pull request reviews
   */
  async getPullRequestReviews(
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubReview[]> {
    const { data } = await this.request<GitHubReview[]>(
      `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`
    );
    return data;
  }

  /**
   * Get pull request commits
   */
  async getPullRequestCommits(
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubCommit[]> {
    const { data } = await this.request<GitHubCommit[]>(
      `/repos/${owner}/${repo}/pulls/${number}/commits?per_page=100`
    );
    return data;
  }

  /**
   * Create or update webhook for repository
   */
  async setupWebhook(
    owner: string,
    repo: string,
    url: string,
    events: string[] = ['pull_request', 'pull_request_review', 'push']
  ): Promise<{
    id: number;
    url: string;
    active: boolean;
  }> {
    // Check if webhook already exists
    const { data: existingWebhooks } = await this.request<
      Array<{
        id: number;
        config?: { url?: string };
        active: boolean;
      }>
    >(`/repos/${owner}/${repo}/hooks`);

    const existing = existingWebhooks.find((hook: any) => hook.config?.url === url);

    if (existing) {
      // Update existing webhook
      const { data } = await this.request<any>(`/repos/${owner}/${repo}/hooks/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          config: {
            url,
            content_type: 'json',
            secret: process.env.GITHUB_WEBHOOK_SECRET,
          },
          events,
          active: true,
        }),
      });

      return {
        id: data.id,
        url: data.config?.url || url,
        active: data.active,
      };
    } else {
      // Create new webhook
      const { data } = await this.request<any>(`/repos/${owner}/${repo}/hooks`, {
        method: 'POST',
        body: JSON.stringify({
          config: {
            url,
            content_type: 'json',
            secret: process.env.GITHUB_WEBHOOK_SECRET,
          },
          events,
          active: true,
        }),
      });

      return {
        id: data.id,
        url: data.config?.url || url,
        active: data.active,
      };
    }
  }

  /**
   * Remove webhook from repository
   */
  async removeWebhook(owner: string, repo: string, hookId: number): Promise<void> {
    try {
      await this.request(`/repos/${owner}/${repo}/hooks/${hookId}`, { method: 'DELETE' });
    } catch (error: any) {
      // Ignore 404 errors (webhook already deleted)
      if (error.statusCode !== 404) {
        throw error;
      }
    }
  }

  /**
   * Get rate limit status
   */
  async getRateLimit(): Promise<{
    core: {
      limit: number;
      remaining: number;
      reset: Date;
    };
    graphql: {
      limit: number;
      remaining: number;
      reset: Date;
    };
  }> {
    const { data } = await this.request<{
      resources: {
        core: {
          limit: number;
          remaining: number;
          reset: number;
        };
        graphql?: {
          limit: number;
          remaining: number;
          reset: number;
        };
      };
    }>('/rate_limit');

    return {
      core: {
        limit: data.resources.core.limit,
        remaining: data.resources.core.remaining,
        reset: new Date(data.resources.core.reset * 1000),
      },
      graphql: {
        limit: data.resources.graphql?.limit || 5000,
        remaining: data.resources.graphql?.remaining || 5000,
        reset: new Date((data.resources.graphql?.reset || 0) * 1000),
      },
    };
  }

  /**
   * Check rate limit from response headers
   */
  private checkRateLimit(headers: Headers): void {
    const remaining = parseInt(headers.get('x-ratelimit-remaining') || '0');
    const reset = parseInt(headers.get('x-ratelimit-reset') || '0');

    if (remaining < 10) {
      console.warn(`GitHub API rate limit low: ${remaining} remaining`);
    }

    if (remaining === 0) {
      throw new GitHubRateLimitError(remaining, new Date(reset * 1000));
    }
  }

  /**
   * Handle API error responses
   */
  private handleErrorResponse(response: Response): Error {
    const remaining = parseInt(response.headers.get('x-ratelimit-remaining') || '1');
    const reset = parseInt(response.headers.get('x-ratelimit-reset') || '0');

    if (response.status === 403 && remaining === 0) {
      return new GitHubRateLimitError(0, new Date(reset * 1000));
    }

    if (response.status === 401) {
      return new GitHubAPIError('Authentication failed', 401);
    }

    if (response.status === 404) {
      return new GitHubAPIError('Resource not found', 404);
    }

    return new GitHubAPIError(`GitHub API error: ${response.statusText}`, response.status);
  }
}
