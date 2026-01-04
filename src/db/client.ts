import { Pool } from 'pg';
import { config } from '../config/env';

export const pool = new Pool({
  connectionString: config.database.url,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initializeDatabase() {
  const fs = await import('fs');
  const path = await import('path');

  const schemaPath = path.join(__dirname, 'schema.sql');

  // Check if schema file exists
  if (!fs.existsSync(schemaPath)) {
    console.log('Schema file not found, assuming database is already initialized');
    // Verify database connection works
    try {
      await pool.query('SELECT 1');
      console.log('Database connection verified');
      return;
    } catch (error) {
      console.error('Database connection failed:', error);
      throw error;
    }
  }

  const schema = fs.readFileSync(schemaPath, 'utf-8');

  try {
    await pool.query(schema);
    console.log('Database schema initialized');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}
