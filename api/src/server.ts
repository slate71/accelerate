import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from 'dotenv';

// Import database connections
import { testConnection as testPostgres, closePool } from './db/postgres.js';
import { 
  testConnection as testInflux, 
  initializeBucket, 
  close as closeInflux 
} from './db/influx.js';
import { testConnection as testRedis, close as closeRedis } from './db/redis.js';

// Import plugins
import healthPlugin from './plugins/health.js';
import teamsPlugin from './plugins/teams.js';
import metricsPlugin from './plugins/metrics.js';
import dashboardPlugin from './plugins/dashboard.js';

config();

// Create Fastify instance with logging
const server: FastifyInstance = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    ...(process.env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    }),
  },
  bodyLimit: 10 * 1024 * 1024, // 10MB
});

// Register plugins
async function registerPlugins() {
  // CORS
  await server.register(cors, {
    origin: process.env.NEXT_PUBLIC_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Security headers
  await server.register(helmet);

  // WebSocket support
  await server.register(websocket);

  // Swagger documentation
  await server.register(swagger, {
    swagger: {
      info: {
        title: 'Accelerate API',
        description: 'Engineering velocity and acceleration metrics API',
        version: '1.0.0',
      },
      host: `localhost:${process.env.API_PORT || 3001}`,
      schemes: ['http'],
      consumes: ['application/json'],
      produces: ['application/json'],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'teams', description: 'Team management' },
        { name: 'metrics', description: 'Velocity and acceleration metrics' },
        { name: 'dashboard', description: 'Dashboard data' },
      ],
    },
  });

  await server.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'full',
      deepLinking: false,
    },
  });

  // API routes
  await server.register(healthPlugin);
  await server.register(teamsPlugin, { prefix: '/api/v1' });
  await server.register(metricsPlugin, { prefix: '/api/v1' });
  await server.register(dashboardPlugin, { prefix: '/api/v1' });
}

// WebSocket connections for real-time updates
server.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (connection, _req) => {
    const clientId = Math.random().toString(36).substring(7);
    fastify.log.info(`WebSocket client ${clientId} connected`);

    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'subscribe' && data.teamId) {
          // Store team subscription (in production, use Redis)
          fastify.log.info(`Client ${clientId} subscribed to team ${data.teamId}`);
        }
      } catch (error) {
        fastify.log.error('WebSocket message error:', error);
      }
    });

    connection.on('close', () => {
      fastify.log.info(`WebSocket client ${clientId} disconnected`);
    });
  });
});

// Root endpoint
server.get('/', async (_request, _reply) => {
  return {
    name: 'Accelerate API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    api_version: 'v1',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      api_v1: '/api/v1',
      docs: '/api/docs',
      websocket: '/ws',
    },
  };
});

// Error handler
server.setErrorHandler((error, request, reply) => {
  server.log.error(error);
  
  const statusCode = error.statusCode || 500;
  reply.status(statusCode).send({
    error: error.name || 'Internal Server Error',
    message: error.message || 'An unexpected error occurred',
    statusCode,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
});

// 404 handler
server.setNotFoundHandler((request, reply) => {
  reply.status(404).send({
    error: 'Not Found',
    message: `Cannot ${request.method} ${request.url}`,
    statusCode: 404,
    timestamp: new Date().toISOString(),
  });
});

// Initialize databases and start server
async function startServer() {
  try {
    server.log.info('🚀 Starting Accelerate API Server...');

    // Register plugins
    await registerPlugins();

    // Test database connections
    const [postgresOk, influxOk, redisOk] = await Promise.all([
      testPostgres(),
      testInflux(),
      testRedis(),
    ]);

    if (!postgresOk || !influxOk || !redisOk) {
      server.log.error('❌ Database connection checks failed');
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
    }

    // Initialize InfluxDB bucket
    await initializeBucket();

    const port = Number(process.env.API_PORT) || 3001;
    const host = process.env.API_HOST || 'localhost';

    await server.listen({ port, host });
    
    server.log.info(`✅ API Server running on http://${host}:${port}`);
    server.log.info(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    server.log.info(`📍 API Version: v1`);
    server.log.info(`📖 API Documentation: http://${host}:${port}/api/docs`);
  } catch (error) {
    server.log.fatal(error);
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown() {
  server.log.info('📍 Graceful shutdown initiated...');

  try {
    await server.close();
    await Promise.all([closePool(), closeInflux(), closeRedis()]);
    server.log.info('✅ All connections closed. Exiting...');
  } catch (error) {
    server.log.error('Error during shutdown:', error);
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Helper function to broadcast to team subscribers
export function broadcastToTeam(teamId: string, event: string, data: any) {
  // In a full implementation, this would use Redis pub/sub
  // to broadcast to all server instances
  server.log.info(`Broadcasting ${event} to team ${teamId}:`, data);
}

// Start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export default server;
export { server, startServer, gracefulShutdown };