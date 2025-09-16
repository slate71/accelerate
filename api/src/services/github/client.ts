import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
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
  private octokit: Octokit;
  private graphqlClient: typeof graphql;

  constructor(accessToken: string) {
    // Initialize Octokit with built-in retry logic
    this.octokit = new Octokit({
      auth: accessToken,
      request: {
        retries: 3,
        retryAfter: 60,
      },
    });

    // Initialize GraphQL client with auth
    this.graphqlClient = graphql.defaults({
      headers: {
        authorization: `token ${accessToken}`,
      },
    });
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
    try {
      const response = await this.octokit.repos.listForAuthenticatedUser({
        ...(options.visibility && { visibility: options.visibility }),
        affiliation: options.affiliation || 'owner,collaborator',
        ...(options.sort && { sort: options.sort }),
        per_page: options.per_page || 100,
        page: options.page || 1,
      });

      return response.data as GitHubRepository[];
    } catch (error) {
      throw this.handleOctokitError(error);
    }
  }

  /**
   * Get repository details
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
    try {
      const response = await this.octokit.repos.get({
        owner,
        repo,
      });

      return response.data as GitHubRepository;
    } catch (error) {
      throw this.handleOctokitError(error);
    }
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

    try {
      const response = await this.graphqlClient<GitHubGraphQLResponse>(query, {
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
    } catch (error) {
      throw this.handleOctokitError(error);
    }
  }

  /**
   * Get pull request details
   */
  async getPullRequestDetails(
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubPullRequest> {
    try {
      const response = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: number,
      });

      return response.data as unknown as GitHubPullRequest;
    } catch (error) {
      throw this.handleOctokitError(error);
    }
  }

  /**
   * Get pull request reviews
   */
  async getPullRequestReviews(
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubReview[]> {
    try {
      const response = await this.octokit.pulls.listReviews({
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      });

      return response.data as GitHubReview[];
    } catch (error) {
      throw this.handleOctokitError(error);
    }
  }

  /**
   * Get pull request commits
   */
  async getPullRequestCommits(
    owner: string,
    repo: string,
    number: number
  ): Promise<GitHubCommit[]> {
    try {
      const response = await this.octokit.pulls.listCommits({
        owner,
        repo,
        pull_number: number,
        per_page: 100,
      });

      return response.data as GitHubCommit[];
    } catch (error) {
      throw this.handleOctokitError(error);
    }
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
    try {
      // Check if webhook already exists
      const { data: existingWebhooks } = await this.octokit.repos.listWebhooks({
        owner,
        repo,
      });

      const existing = existingWebhooks.find(hook => hook.config?.url === url);

      if (existing) {
        // Update existing webhook
        const { data } = await this.octokit.repos.updateWebhook({
          owner,
          repo,
          hook_id: existing.id,
          config: {
            url,
            content_type: 'json',
            ...(process.env.GITHUB_WEBHOOK_SECRET && { secret: process.env.GITHUB_WEBHOOK_SECRET }),
          },
          events: events as any[],
          active: true,
        });

        return {
          id: data.id,
          url: data.config?.url || url,
          active: data.active,
        };
      } else {
        // Create new webhook
        const { data } = await this.octokit.repos.createWebhook({
          owner,
          repo,
          config: {
            url,
            content_type: 'json',
            ...(process.env.GITHUB_WEBHOOK_SECRET && { secret: process.env.GITHUB_WEBHOOK_SECRET }),
          },
          events: events as any[],
          active: true,
        });

        return {
          id: data.id,
          url: data.config?.url || url,
          active: data.active,
        };
      }
    } catch (error) {
      throw this.handleOctokitError(error);
    }
  }

  /**
   * Remove webhook from repository
   */
  async removeWebhook(owner: string, repo: string, hookId: number): Promise<void> {
    try {
      await this.octokit.repos.deleteWebhook({
        owner,
        repo,
        hook_id: hookId,
      });
    } catch (error: any) {
      // Ignore 404 errors (webhook already deleted)
      if (error.status !== 404) {
        throw this.handleOctokitError(error);
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
    try {
      const { data } = await this.octokit.rateLimit.get();

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
    } catch (error) {
      throw this.handleOctokitError(error);
    }
  }

  /**
   * Get all pages of results using Octokit's pagination
   * Useful for fetching all repositories, PRs, etc.
   */
  async *paginate<T>(method: any, parameters: any): AsyncIterableIterator<T> {
    try {
      for await (const response of this.octokit.paginate.iterator(method, parameters)) {
        for (const item of response.data) {
          yield item as T;
        }
      }
    } catch (error) {
      throw this.handleOctokitError(error);
    }
  }

  /**
   * Get all repositories with automatic pagination
   */
  async getAllRepositories(
    options: {
      visibility?: 'all' | 'public' | 'private';
      affiliation?: string;
      sort?: 'created' | 'updated' | 'pushed' | 'full_name';
    } = {}
  ): Promise<GitHubRepository[]> {
    try {
      const repos: GitHubRepository[] = [];

      for await (const repo of this.paginate<GitHubRepository>(
        this.octokit.repos.listForAuthenticatedUser,
        {
          ...(options.visibility && { visibility: options.visibility }),
          affiliation: options.affiliation || 'owner,collaborator',
          ...(options.sort && { sort: options.sort }),
          per_page: 100,
        }
      )) {
        repos.push(repo);
      }

      return repos;
    } catch (error) {
      throw this.handleOctokitError(error);
    }
  }

  /**
   * Handle Octokit errors and convert to our custom error types
   */
  private handleOctokitError(error: any): Error {
    // Check if it's an Octokit RequestError
    if (error.status) {
      // Rate limit error
      if (error.status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
        const reset = error.response?.headers?.['x-ratelimit-reset'];
        return new GitHubRateLimitError(0, reset ? new Date(parseInt(reset) * 1000) : new Date());
      }

      // Authentication error
      if (error.status === 401) {
        return new GitHubAPIError('Authentication failed', 401);
      }

      // Not found error
      if (error.status === 404) {
        return new GitHubAPIError('Resource not found', 404);
      }

      // GraphQL errors
      if (error.errors) {
        const message = error.errors[0]?.message || 'GraphQL error';
        return new GitHubAPIError(`GraphQL error: ${message}`, error.status);
      }

      // Generic API error
      return new GitHubAPIError(error.message || `GitHub API error: ${error.status}`, error.status);
    }

    // Non-API errors (network, etc.)
    return error;
  }
}
