import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './client';

async function initializeDatabase(): Promise<void> {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  try {
    console.log('Initializing database...');
    await pool.query(schema);
    console.log('Database initialized successfully!');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

initializeDatabase();
