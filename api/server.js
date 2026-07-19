import Fastify from 'fastify';
import cors from '@fastify/cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { importListings, seedAlerts } from './db/importer.js';
import listingsRoutes  from './routes/listings.js';
import analyticsRoutes from './routes/analytics.js';
import alertsRoutes    from './routes/alerts.js';
import pipelineRoutes  from './routes/pipeline.js';
import emailRoutes     from './routes/email.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: { level: 'warn' } });

await fastify.register(cors, { origin: true });

// Seed DB on startup
importListings();
seedAlerts();

// Register all route groups under /api
await fastify.register(async (app) => {
  await app.register(listingsRoutes);
  await app.register(analyticsRoutes);
  await app.register(alertsRoutes);
  await app.register(pipelineRoutes);
  await app.register(emailRoutes);
}, { prefix: '/api' });

// Health check
fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

const PORT = Number(process.env.PORT || 3001);
await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`API running → http://localhost:${PORT}`);
