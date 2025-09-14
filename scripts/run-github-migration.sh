#!/bin/bash

# Run GitHub integration database migration

echo "🔄 Running GitHub integration migration..."

# Check if PostgreSQL is running
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
    echo "❌ PostgreSQL is not running. Please start it first."
    exit 1
fi

# Run the migration
PGPASSWORD=postgres_dev_password psql -h localhost -U postgres -d accelerate -f api/src/db/migrations/003_github_integration.sql

if [ $? -eq 0 ]; then
    echo "✅ GitHub integration migration completed successfully"
else
    echo "❌ Migration failed"
    exit 1
fi
