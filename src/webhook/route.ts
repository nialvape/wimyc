import type { FastifyRequest } from 'fastify';

import type { App } from '../http.js';

import type { Repo } from '../db/repo.js';
import type { SerialQueue } from '../queue.js';
import type { InboundMessage } from '../types.js';
import { parseWebhookBody } from './parse.js';
import { verifySignature } from './signature.js';

export interface WebhookDeps {
  repo: Repo;
  queue: SerialQueue;
  webhookSecret: string;
  handleMessage: (message: InboundMessage) => Promise<void>;
}

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

export async function registerWebhook(app: App, deps: WebhookDeps): Promise<void> {
  // Necesitamos los bytes crudos para verificar el HMAC: reparsear el JSON y
  // volver a serializarlo cambia el orden y el espaciado, y la firma no da.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body: Buffer, done) => {
      (request as RawBodyRequest).rawBody = body;
      if (body.length === 0) return done(null, {});
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.post('/webhooks/kapso', async (request, reply) => {
    const rawBody = (request as RawBodyRequest).rawBody ?? Buffer.alloc(0);
    const signature = request.headers['x-webhook-signature'];

    if (!verifySignature(rawBody, asString(signature), deps.webhookSecret)) {
      request.log.warn('webhook con firma inválida');
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const messages = parseWebhookBody(request.body);
    const idempotencyKey = asString(request.headers['x-idempotency-key']);

    // Contestamos ya: Kapso corta a los 10s y reintenta. El trabajo pesado
    // (transcribir, LLM, responder) va a la cola.
    reply.code(200).send({ ok: true, accepted: messages.length });

    for (const message of messages) {
      // La key del evento identifica el reintento; el id del mensaje identifica
      // el mensaje. Con batch, varios mensajes comparten la key del evento.
      const dedupeKey = messages.length > 1 || !idempotencyKey
        ? `msg:${message.waMessageId}`
        : `evt:${idempotencyKey}`;

      if (!deps.repo.markProcessed(dedupeKey)) {
        request.log.debug({ dedupeKey }, 'evento repetido, ignorado');
        continue;
      }

      deps.queue.push(message.from, () => deps.handleMessage(message));
    }
  });
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
