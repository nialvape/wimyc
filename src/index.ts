import { AccessGate } from './auth.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { errorFields } from './providers/errors.js';
import { Repo } from './db/repo.js';
import { getLogger, maskPhone } from './logger.js';
import { handleMessage } from './pipeline/handle.js';
import type { AppContext } from './pipeline/context.js';
import { createGroqProvider, GroqTranscriber } from './providers/groq.js';
import { KapsoClient } from './providers/kapso.js';
import { withFallback, type ChatProvider } from './providers/llm.js';
import { createOpenRouterProvider } from './providers/openrouter.js';
import { SerialQueue } from './queue.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = getLogger();

  const db = openDatabase(config.DATABASE_PATH);
  const repo = new Repo(db);
  const pruned = repo.pruneProcessedEvents();
  if (pruned > 0) logger.debug({ pruned }, 'eventos viejos borrados');

  const providers: ChatProvider[] = [createGroqProvider(config)];
  const openRouter = createOpenRouterProvider(config);
  if (openRouter) providers.push(openRouter);
  else logger.warn('OpenRouter no configurado: el LLM no tiene fallback');

  const queue = new SerialQueue((error, key) => {
    logger.error({ ...errorFields(error), key: maskPhone(key) }, 'tarea de la cola falló');
  });

  const context: AppContext = {
    repo,
    kapso: new KapsoClient(config),
    llm: withFallback(providers, (failed, error) => {
      logger.warn({ ...errorFields(error), failed }, 'proveedor de LLM caído, voy al siguiente');
    }),
    transcriber: new GroqTranscriber(config),
    gate: new AccessGate(repo, config.ACCESS_PASSWORD, config.PASSWORD_ATTEMPTS_PER_HOUR),
    logger,
    pendingTtlMs: config.PENDING_TTL_MINUTES * 60_000,
  };

  const app = await buildServer({
    logger,
    repo,
    queue,
    webhookSecret: config.KAPSO_WEBHOOK_SECRET,
    handleMessage: (message) => handleMessage(context, message),
  });

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT, db: config.DATABASE_PATH }, 'WIMYC arriba');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'apagando');
    // Cerramos el server primero para no aceptar nada nuevo, después esperamos
    // a que la cola termine lo que tenía en vuelo.
    await app.close();
    await queue.drain();
    db.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
