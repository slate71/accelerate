#!/bin/bash

# Initialize Databases Script
# This script sets up all databases for the Acceleration Dashboard

set -e

echo "======================================"
echo "🚀 Initializing Acceleration Databases"
echo "======================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
    echo -e "${GREEN}✓${NC} Loaded environment variables from .env"
else
    echo -e "${YELLOW}⚠${NC} No .env file found, using defaults from docker-compose.yml"
fi

echo ""
echo "Starting Docker services..."
docker-compose up -d postgres influxdb redis

echo ""
echo "Waiting for services to be healthy..."

# Wait for PostgreSQL
echo -n "Waiting for PostgreSQL"
until docker-compose exec -T postgres pg_isready -U ${POSTGRES_USER:-postgres} > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo -e " ${GREEN}✓${NC}"

# Wait for InfluxDB
echo -n "Waiting for InfluxDB"
until docker-compose exec -T influxdb influx ping > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo -e " ${GREEN}✓${NC}"

# Wait for Redis
echo -n "Waiting for Redis"
until docker-compose exec -T redis redis-cli --pass ${REDIS_PASSWORD:-redis_dev_password} ping > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo -e " ${GREEN}✓${NC}"

echo ""
echo "======================================"
echo "Database Status:"
echo "======================================"

# Check PostgreSQL
echo -n "PostgreSQL: "
if docker-compose exec -T postgres psql -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-accelerate} -c "SELECT COUNT(*) FROM teams;" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Connected and schema initialized${NC}"
else
    echo -e "${RED}✗ Failed to connect or schema not initialized${NC}"
fi

# Check InfluxDB
echo -n "InfluxDB:   "
if docker-compose exec -T influxdb influx bucket list --org ${INFLUXDB_ORG:-accelerate} --token ${INFLUXDB_ADMIN_TOKEN:-dev_token_please_change} 2>/dev/null | grep -q ${INFLUXDB_BUCKET:-metrics}; then
    echo -e "${GREEN}✓ Connected and bucket exists${NC}"
else
    echo -e "${YELLOW}⚠ Connected but bucket may need creation${NC}"
fi

# Check Redis
echo -n "Redis:      "
if docker-compose exec -T redis redis-cli --pass ${REDIS_PASSWORD:-redis_dev_password} SET test_key "test" > /dev/null 2>&1; then
    docker-compose exec -T redis redis-cli --pass ${REDIS_PASSWORD:-redis_dev_password} DEL test_key > /dev/null 2>&1
    echo -e "${GREEN}✓ Connected and operational${NC}"
else
    echo -e "${RED}✗ Failed to connect${NC}"
fi

echo ""
echo "======================================"
echo "Next Steps:"
echo "======================================"
echo "1. Install API dependencies:"
echo "   cd api && npm install"
echo ""
echo "2. Test database connections:"
echo "   cd api && npm run db:test"
echo ""
echo "3. Start the API server:"
echo "   cd api && npm run dev"
echo ""
echo "4. View logs:"
echo "   docker-compose logs -f"
echo ""
echo -e "${GREEN}✓${NC} Database initialization complete!"