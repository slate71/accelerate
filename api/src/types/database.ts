// Database entity types
export interface Team {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface Integration {
  id: string;
  team_id: string;
  type: 'github' | 'gitlab';
  credentials_encrypted?: string;
  webhook_secret?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Repository {
  id: string;
  team_id: string;
  integration_id: string;
  github_id?: number;
  name: string;
  owner: string;
  full_name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PullRequest {
  id: string;
  repository_id: string;
  pr_number: number;
  github_id?: number;
  title?: string;
  state?: 'open' | 'closed' | 'merged';
  author?: string;
  created_at?: Date;
  updated_at?: Date;
  merged_at?: Date;
  closed_at?: Date;
  first_review_at?: Date;
  review_time_hours?: number;
  merge_time_hours?: number;
  cycle_time_hours?: number;
  lines_added?: number;
  lines_deleted?: number;
  files_changed?: number;
  review_comments?: number;
  reviews_count?: number;
}

export interface Metric {
  id: string;
  team_id: string;
  repository_id?: string;
  metric_type: MetricType;
  value: number;
  unit?: string;
  period_start: Date;
  period_end: Date;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

export type MetricType = 
  | 'velocity'
  | 'throughput'
  | 'acceleration'
  | 'cycle_time'
  | 'review_time'
  | 'merge_time';

export interface Insight {
  id: string;
  team_id: string;
  repository_id?: string;
  type: InsightType;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description?: string;
  data: Record<string, unknown>;
  confidence?: number;
  is_active: boolean;
  detected_at: Date;
  resolved_at?: Date;
  created_at: Date;
}

export type InsightType = 
  | 'acceleration_change'
  | 'bottleneck_detected'
  | 'velocity_spike'
  | 'velocity_drop'
  | 'cycle_time_increase';

export interface Bottleneck {
  id: string;
  team_id: string;
  repository_id?: string;
  stage: BottleneckStage;
  severity: 'low' | 'medium' | 'high';
  impact_days?: number;
  affected_prs?: number;
  recommendations?: string[];
  detected_at: Date;
  resolved_at?: Date;
  is_active: boolean;
  created_at: Date;
}

export type BottleneckStage = 
  | 'review'
  | 'testing'
  | 'merge'
  | 'deployment'
  | 'planning';

// Additional types for API requests and responses
export interface TeamMember {
  id: string;
  team_id: string;
  name: string;
  email: string;
  role: 'member' | 'lead' | 'admin';
  github_username?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTeamRequest {
  name: string;
  description?: string;
  githubOrg?: string;
  slackChannel?: string;
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string;
  githubOrg?: string;
  slackChannel?: string;
}

export interface TeamWithMembers extends Team {
  description?: string;
  githubOrg?: string;
  slackChannel?: string;
  members: TeamMember[];
}