import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../src/index.js';

// Vercel function adapter: hand the raw Node request to Fastify's server.
// This preserves streaming (SSE chat) and Fastify's own routing.
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await app.ready();
  app.server.emit('request', req, res);
}
