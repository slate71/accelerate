import { z } from 'zod';
import type { AccelerationTrend } from './metrics.js';

// Zod schemas for runtime validation
export const CreateTeamSchema = z.object({
  name: z.string().min(1).max(255),
});

export const VelocityMetricSchema = z.object({
  value: z.number().positive(),
  repositoryId: z.string().uuid().optional(),
  tags: z.record(z.string()).optional(),
});

export const AccelerationMetricSchema = z.object({
  value: z.number(),
  trend: z.enum(['improving', 'stable', 'declining']),
  confidence: z.number().min(0).max(1),
});

export const BottleneckEventSchema = z.object({
  stage: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high']),
  impactDays: z.number().positive(),
  affectedPRs: z.number().int().nonnegative().optional(),
  recommendations: z.array(z.string()).optional(),
  repositoryId: z.string().uuid().optional(),
});

export const HistoryQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
});

// Type inference from Zod schemas
export type CreateTeamRequest = z.infer<typeof CreateTeamSchema>;
export type VelocityMetricRequest = z.infer<typeof VelocityMetricSchema>;
export type AccelerationMetricRequest = z.infer<typeof AccelerationMetricSchema>;
export type BottleneckEventRequest = z.infer<typeof BottleneckEventSchema>;
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  timestamp: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  responseTime?: string;
  services: {
    postgres: boolean | string;
    influx: boolean | string;
    redis: boolean | string;
  };
}

export interface DetailedHealthResponse extends HealthCheckResponse {
  environment: string;
  version: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
}

// Route parameter types
export interface TeamParams {
  teamId: string;
}

export interface RouteGeneric {
  Params: TeamParams;
  Querystring: HistoryQuery;
}

// WebSocket event types
export interface WebSocketEvents {
  'velocity:update': {
    teamId: string;
    value: number;
    timestamp: Date;
  };
  'acceleration:update': {
    teamId: string;
    value: number;
    trend: AccelerationTrend;
    confidence: number;
    timestamp: Date;
  };
  'bottleneck:detected': {
    teamId: string;
    stage: string;
    severity: 'low' | 'medium' | 'high';
    impactDays: number;
    timestamp: Date;
  };
  'team:join': {
    teamId: string;
  };
  'team:leave': {
    teamId: string;
  };
}

// Database query result types
export interface DatabaseQueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
  command: string;
}

// Cache types
export interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheOptions {
  ttl?: number; // seconds
  prefix?: string;
  serialize?: boolean;
}

// Dashboard types
export interface DashboardData {
  velocity: {
    current: number;
    trend: AccelerationTrend;
    history: Array<{ date: string; value: number }>;
  };
  acceleration: {
    value: number;
    trend: AccelerationTrend;
    confidence: number;
  };
  bottlenecks: Array<{
    id: string;
    stage: string;
    severity: 'low' | 'medium' | 'high';
    impactDays: number;
    affectedPRs: number;
  }>;
  metrics: {
    cycleTime: number;
    reviewTime: number;
    mergeTime: number;
  };
}

// Metrics API types
export interface MetricsHistoryResponse {
  data: Array<{
    timestamp: string;
    value: number;
    metadata?: Record<string, unknown>;
  }>;
  period: {
    start: string;
    end: string;
  };
}

export interface TeamMetricsResponse {
  teamId: string;
  velocity: number;
  acceleration: {
    value: number;
    trend: AccelerationTrend;
    confidence: number;
  };
  metrics: {
    avgCycleTime: number;
    avgReviewTime: number;
    avgMergeTime: number;
  };
  period: {
    start: string;
    end: string;
  };
}