-- Acceleration Dashboard Database Schema
-- PostgreSQL initialization script

-- Create UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Integrations table (for GitHub OAuth and other integrations)
CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'github', 'gitlab', etc.
    credentials_encrypted TEXT, -- Encrypted OAuth tokens
    webhook_secret VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, type)
);

-- Repositories table
CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    github_id BIGINT UNIQUE,
    name VARCHAR(255) NOT NULL,
    owner VARCHAR(255) NOT NULL,
    full_name VARCHAR(510) GENERATED ALWAYS AS (owner || '/' || name) STORED,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, owner, name)
);

-- Pull requests table
CREATE TABLE IF NOT EXISTS pull_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    pr_number INTEGER NOT NULL,
    github_id BIGINT UNIQUE,
    title TEXT,
    state VARCHAR(20), -- 'open', 'closed', 'merged'
    author VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    merged_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    first_review_at TIMESTAMP WITH TIME ZONE,
    review_time_hours DECIMAL(10, 2), -- Time from open to first review
    merge_time_hours DECIMAL(10, 2), -- Time from open to merge
    cycle_time_hours DECIMAL(10, 2), -- Total time from open to close/merge
    lines_added INTEGER,
    lines_deleted INTEGER,
    files_changed INTEGER,
    review_comments INTEGER,
    reviews_count INTEGER,
    UNIQUE(repository_id, pr_number)
);

-- Metrics table (for calculated metrics)
CREATE TABLE IF NOT EXISTS metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    metric_type VARCHAR(50) NOT NULL, -- 'velocity', 'throughput', 'cycle_time', etc.
    value DECIMAL(20, 4) NOT NULL,
    unit VARCHAR(20), -- 'prs_per_week', 'hours', 'percentage', etc.
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata JSONB, -- Additional context for the metric
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insights table (for ML-generated insights)
CREATE TABLE IF NOT EXISTS insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- 'acceleration_change', 'bottleneck_detected', etc.
    severity VARCHAR(20), -- 'low', 'medium', 'high', 'critical'
    title VARCHAR(255) NOT NULL,
    description TEXT,
    data JSONB NOT NULL, -- Structured data about the insight
    confidence DECIMAL(3, 2) CHECK (confidence >= 0 AND confidence <= 1),
    is_active BOOLEAN DEFAULT true,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Bottlenecks table
CREATE TABLE IF NOT EXISTS bottlenecks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL, -- 'review', 'testing', 'merge', etc.
    severity VARCHAR(20) NOT NULL, -- 'low', 'medium', 'high'
    impact_days DECIMAL(10, 2), -- Days of delay caused
    affected_prs INTEGER, -- Number of PRs affected
    recommendations TEXT[], -- Array of recommendation strings
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_integrations_team_id ON integrations(team_id);
CREATE INDEX idx_repositories_team_id ON repositories(team_id);
CREATE INDEX idx_repositories_integration_id ON repositories(integration_id);
CREATE INDEX idx_pull_requests_repository_id ON pull_requests(repository_id);
CREATE INDEX idx_pull_requests_created_at ON pull_requests(created_at);
CREATE INDEX idx_pull_requests_merged_at ON pull_requests(merged_at);
CREATE INDEX idx_pull_requests_state ON pull_requests(state);
CREATE INDEX idx_metrics_team_id ON metrics(team_id);
CREATE INDEX idx_metrics_repository_id ON metrics(repository_id);
CREATE INDEX idx_metrics_metric_type ON metrics(metric_type);
CREATE INDEX idx_metrics_period_start ON metrics(period_start);
CREATE INDEX idx_insights_team_id ON insights(team_id);
CREATE INDEX idx_insights_type ON insights(type);
CREATE INDEX idx_insights_detected_at ON insights(detected_at);
CREATE INDEX idx_bottlenecks_team_id ON bottlenecks(team_id);
CREATE INDEX idx_bottlenecks_detected_at ON bottlenecks(detected_at);
CREATE INDEX idx_bottlenecks_is_active ON bottlenecks(is_active);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_integrations_updated_at BEFORE UPDATE ON integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_repositories_updated_at BEFORE UPDATE ON repositories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a sample team for development
INSERT INTO teams (name) VALUES ('Development Team') ON CONFLICT (name) DO NOTHING;