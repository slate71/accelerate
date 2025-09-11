# Acceleration Dashboard MVP

An AI/ML-powered engineering acceleration dashboard that focuses on acceleration trends rather than velocity metrics.

## Project Structure

```
accelerate/
├── web/          # Next.js frontend application
├── api/          # Node.js backend API server
├── ml-service/   # Python ML service for acceleration detection
├── docker/       # Docker configurations
└── scripts/      # Build and utility scripts
```

## Quick Start

1. **Environment Setup**
   ```bash
   cp .env.example .env.local
   # Fill in your environment variables
   ```

2. **Start Development Environment**
   ```bash
   docker-compose up -d postgres redis influxdb
   ```

3. **Install Dependencies**
   ```bash
   cd web && bun install
   cd ../api && bun install
   cd ../ml-service && pip install -r requirements.txt
   ```

4. **Run Development Servers**
   ```bash
   # Terminal 1 - Frontend
   cd web && bun dev

   # Terminal 2 - API Server
   cd api && bun run dev

   # Terminal 3 - ML Service
   cd ml-service && python main.py
   ```

## Features

- **Real-time Acceleration Metrics**: Track engineering team acceleration trends
- **GitHub Integration**: Pull request data collection and analysis
- **ML-Powered Insights**: Changepoint detection and trend classification
- **Executive Dashboard**: Clean, responsive interface for leadership
- **Bottleneck Detection**: Identify workflow inefficiencies

## Technology Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express/Fastify
- **ML Service**: Python, FastAPI, ruptures
- **Databases**: PostgreSQL, InfluxDB, Redis
- **Infrastructure**: Docker, WebSocket

## Development

```bash
# Format code
cd web && bun run format

# Type checking
cd web && bun run type-check

# Linting
cd web && bun run lint:fix
```

## Architecture

The system follows a microservices architecture:
1. **Web App**: User interface and authentication
2. **API Server**: Business logic and GitHub integration
3. **ML Service**: Acceleration detection algorithms
4. **Databases**: Data persistence and time-series storage

---

Built for TOG-247: Phase 1 Acceleration MVP
