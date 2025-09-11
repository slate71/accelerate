// Core types for the acceleration dashboard
export interface Team {
  id: string;
  name: string;
  repositories: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AccelerationMetrics {
  current: number; // Current acceleration percentage
  trend: 'improving' | 'stable' | 'declining';
  confidence: number; // 0-1 confidence score
}

export interface VelocityMetrics {
  current: number; // Current velocity (PRs/day or similar)
  history: number[]; // Historical velocity data
}

export interface Bottleneck {
  stage: string; // e.g., 'review', 'merge', 'testing'
  severity: 'low' | 'medium' | 'high';
  impactDays: number; // How many days this adds to process
  recommendations: string[];
}

export interface DashboardData {
  acceleration: AccelerationMetrics;
  velocity: VelocityMetrics;
  bottlenecks: Bottleneck[];
}

export interface GitHubPullRequest {
  id: number;
  title: string;
  createdAt: Date;
  mergedAt: Date | null;
  reviewStartedAt: Date | null;
  firstReviewAt: Date | null;
  reviewCount: number;
  changesRequestedCount: number;
}