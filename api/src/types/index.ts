// Re-export types with explicit names to avoid conflicts
export type { 
  Team, 
  Integration,
  Repository,
  PullRequest,
  Metric,
  MetricType,
  Insight,
  InsightType,
  Bottleneck,
  BottleneckStage,
  TeamMember
} from './database.js';

export type {
  CreateTeamRequest as DatabaseCreateTeamRequest,
  UpdateTeamRequest as DatabaseUpdateTeamRequest,
  TeamWithMembers
} from './database.js';

export type {
  VelocityMetric,
  AccelerationMetric,
  AccelerationTrend,
  AccelerationData,
  AccelerationPoint,
  VelocityData,
  VelocityPoint,
  BottleneckEvent,
  BottleneckSummary,
  MetricSummary,
  InfluxPoint,
  TimeSeriesQuery,
  VelocityResponse,
  AccelerationResponse,
  BottleneckResponse,
  MetricsOverviewResponse
} from './metrics.js';

export type {
  DashboardData as ApiDashboardData
} from './metrics.js';

export type {
  CreateTeamRequest as ApiCreateTeamRequest,
  VelocityMetricRequest,
  AccelerationMetricRequest,
  BottleneckEventRequest,
  HistoryQuery,
  ApiResponse,
  ApiError,
  HealthCheckResponse,
  DetailedHealthResponse,
  TeamParams,
  RouteGeneric,
  WebSocketEvents,
  DatabaseQueryResult,
  CacheEntry,
  CacheOptions,
  DashboardData,
  MetricsHistoryResponse,
  TeamMetricsResponse
} from './api.js';

// Environment configuration type
export interface Config {
  // Server
  port: number;
  host: string;
  environment: 'development' | 'staging' | 'production';
  
  // Database connections
  postgres: {
    url: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };
  
  influxdb: {
    url: string;
    token: string;
    org: string;
    bucket: string;
  };
  
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  
  // External services
  github?: {
    clientId: string;
    clientSecret: string;
    webhookSecret: string;
  };
  
  // Security
  jwt?: {
    secret: string;
    expiresIn: string;
  };
  
  // Logging
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    pretty: boolean;
  };
}

// Common utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredBy<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type WithTimestamps<T> = T & {
  created_at: Date;
  updated_at: Date;
};

// Async function types
export type AsyncFunction<T = void> = () => Promise<T>;
export type AsyncCallback<T = void, R = void> = (arg: T) => Promise<R>;