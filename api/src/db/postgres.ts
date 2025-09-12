import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from 'dotenv';

config();

// Parse the connection URL or use individual env vars
const connectionString =
  process.env.POSTGRES_URL ||
  `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB}`;

// Create connection pool with optimized settings
const pool = new Pool({
  connectionString,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection fails
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
});

// Event handlers for pool
pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

pool.on('connect', () => {
  console.log('New PostgreSQL client connected');
});

pool.on('acquire', () => {
  console.log('PostgreSQL client acquired from pool');
});

// Helper function for transactions
async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Test connection function
async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    const result = await client.query<{
      current_time: Date;
      pg_version: string;
    }>('SELECT NOW() as current_time, version() as pg_version');
    client.release();
    console.log('✅ PostgreSQL connected:', result.rows[0]);
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', (error as Error).message);
    return false;
  }
}

// Graceful shutdown
async function closePool(): Promise<void> {
  await pool.end();
  console.log('PostgreSQL pool closed');
}

// Query helper with types
async function query<T extends Record<string, any> = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export {
  pool,
  withTransaction,
  testConnection,
  closePool,
  query,
};

export default {
  pool,
  withTransaction,
  testConnection,
  closePool,
  query,
};
