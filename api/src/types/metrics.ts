// Metrics and acceleration calculation types
export interface VelocityMetric {
  teamId: string;
  repositoryId?: string;
  value: number;
  unit: 'prs_per_week' | 'prs_per_day' | 'commits_per_week';
  timestamp: Date;
  tags?: Record<string, string>;
}

export interface AccelerationMetric {
  teamId: string;
  value: number; // Percentage change
  trend: AccelerationTrend;
  confidence: number; // 0-1
  timestamp: Date;
  metadata?: {
    window_days?: number;
    data_points?: number;
    calculation_method?: string;
  };
}

export type AccelerationTrend = 'improving' | 'stable' | 'declining';

export interface AccelerationData {
  current: number;
  trend: AccelerationTrend;
  confidence: number;
  history: AccelerationPoint[];
}

export interface AccelerationPoint {
  time: Date;
  value: number;
  confidence: number;
  trend: AccelerationTrend;
}

export interface VelocityData {
  current: number;
  history: VelocityPoint[];
  unit: string;
}

export interface VelocityPoint {
  time: Date;
  value: number;
  repo_id?: string;
}

export interface BottleneckEvent {
  teamId: string;
  repositoryId?: string;
  stage: string;
  severity: 'low' | 'medium' | 'high';
  impactDays: number;
  affectedPRs?: number;
  recommendations?: string[];
  timestamp: Date;
}

export interface DashboardData {
  team: {
    id: string;
    name: string;
    created_at: Date;
    updated_at: Date;
  };
  acceleration: AccelerationData;
  velocity: VelocityData;
  bottlenecks: BottleneckSummary[];
  recentMetrics: MetricSummary[];
  lastUpdated: string;
}

export interface BottleneckSummary {
  stage: string;
  severity: 'low' | 'medium' | 'high';
  impact_days?: number;
  affected_prs?: number;
  recommendations?: string[];
}

export interface MetricSummary {
  metric_type: string;
  value: number;
  unit?: string;
  period_start: Date;
  period_end: Date;
}

// InfluxDB measurement types
export interface InfluxPoint {
  measurement: string;
  tags: Record<string, string>;
  fields: Record<string, number | string>;
  timestamp: Date;
}

export interface TimeSeriesQuery {
  bucket: string;
  measurement: string;
  start: string;
  filters: Record<string, string>;
  window?: string;
  aggregation?: 'mean' | 'sum' | 'max' | 'min' | 'count';
}

// API Response types
export interface VelocityResponse {
  teamId: string;
  current: number;
  unit: string;
  trend: AccelerationTrend;
  history: VelocityPoint[];
  period: {
    start: string;
    end: string;
  };
}

export interface AccelerationResponse {
  teamId: string;
  value: number;
  trend: AccelerationTrend;
  confidence: number;
  timestamp: string;
  metadata?: {
    windowDays?: number;
    dataPoints?: number;
    calculationMethod?: string;
  };
}

export interface BottleneckResponse {
  teamId: string;
  bottlenecks: Array<{
    id: string;
    stage: string;
    severity: 'low' | 'medium' | 'high';
    impactDays: number;
    affectedPRs?: number;
    recommendations?: string[];
    detectedAt: string;
    isActive: boolean;
  }>;
}

export interface MetricsOverviewResponse {
  teamId: string;
  summary: {
    velocity: {
      current: number;
      change: number;
      trend: AccelerationTrend;
    };
    acceleration: {
      value: number;
      trend: AccelerationTrend;
      confidence: number;
    };
    cycleTime: {
      average: number;
      change: number;
      unit: 'hours' | 'days';
    };
    activeBottlenecks: number;
  };
  period: {
    start: string;
    end: string;
  };
}