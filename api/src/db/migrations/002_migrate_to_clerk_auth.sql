-- Migration to Clerk authentication system
-- This migration updates the users and teams tables to work with Clerk

-- Update users table to use Clerk IDs
ALTER TABLE users 
  ADD COLUMN clerk_user_id VARCHAR(255) UNIQUE,
  ADD COLUMN clerk_org_id VARCHAR(255),
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN password_hash DROP NOT NULL;

-- Update teams table to store Clerk organization IDs
ALTER TABLE teams 
  ADD COLUMN clerk_org_id VARCHAR(255) UNIQUE;

-- Create indexes for performance
CREATE INDEX idx_users_clerk_user_id ON users(clerk_user_id);
CREATE INDEX idx_users_clerk_org_id ON users(clerk_org_id);
CREATE INDEX idx_teams_clerk_org_id ON teams(clerk_org_id);

-- Make password_hash nullable since Clerk handles authentication
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

COMMENT ON COLUMN users.clerk_user_id IS 'Clerk user ID for authentication';
COMMENT ON COLUMN users.clerk_org_id IS 'Clerk organization ID that the user belongs to';
COMMENT ON COLUMN teams.clerk_org_id IS 'Clerk organization ID for this team';