import express from 'express';
import { config, validateConfig } from './config/env';
import { initializeDatabase } from './db/client';
import { initializeScheduler } from './services/scheduler';
import webhookRouter from './routes/webhook';

async function main() {
  console.log('Starting WhatsApp Behavioral Companion...');

  // Validate configuration
  try {
    validateConfig();
  } catch (error) {
    console.error('Configuration error:', error);
    console.log('\nPlease set up your .env file with the required variables.');
    console.log('Copy .env.example to .env and fill in the values.\n');
    process.exit(1);
  }

  // Initialize database
  try {
    await initializeDatabase();
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }

  // Create Express app
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Twilio webhook
  app.use('/', webhookRouter);

  // Start server
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Server running on port ${config.port}`);
    console.log(`Webhook URL: http://localhost:${config.port}/webhook`);
  });

  // Initialize scheduler after server is ready
  try {
    await initializeScheduler();
  } catch (error) {
    console.error('Scheduler initialization error:', error);
    // Don't exit - scheduler is not critical for basic operation
  }

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
