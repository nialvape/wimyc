import Fastify from 'fastify';
import type { Logger } from 'pino';

import type { Repo } from './db/repo.js';
import type { App } from './http.js';
import type { SerialQueue } from './queue.js';
import type { InboundMessage } from './types.js';
import { registerWebhook } from './webhook/route.js';

export interface ServerDeps {
  logger: Logger;
  repo: Repo;
  queue: SerialQueue;
  webhookSecret: string;
  handleMessage: (message: InboundMessage) => Promise<void>;
}

export async function buildServer(deps: ServerDeps): Promise<App> {
  const app = Fastify({
    loggerInstance: deps.logger,
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  app.get('/health', async () => ({ status: 'ok', uptime: Math.round(process.uptime()) }));

  await registerWebhook(app, {
    repo: deps.repo,
    queue: deps.queue,
    webhookSecret: deps.webhookSecret,
    handleMessage: deps.handleMessage,
  });

  return app;
}
