import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pino } from 'pino';

import { openDatabase } from '../src/db/index.js';
import { Repo } from '../src/db/repo.js';
import type { App } from '../src/http.js';
import { SerialQueue } from '../src/queue.js';
import { buildServer } from '../src/server.js';
import type { InboundMessage } from '../src/types.js';
import { computeSignature } from '../src/webhook/signature.js';

const SECRET = 'secreto-de-webhook';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8');

describe('POST /webhooks/kapso', () => {
  let app: App;
  let queue: SerialQueue;
  let received: InboundMessage[];

  beforeEach(async () => {
    received = [];
    queue = new SerialQueue(() => undefined);

    app = await buildServer({
      logger: pino({ level: 'silent' }),
      repo: new Repo(openDatabase(':memory:')),
      queue,
      webhookSecret: SECRET,
      handleMessage: async (message) => {
        received.push(message);
      },
    });
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (payload: string, signature?: string) =>
    app.inject({
      method: 'POST',
      url: '/webhooks/kapso',
      headers: {
        'content-type': 'application/json',
        ...(signature === undefined ? {} : { 'x-webhook-signature': signature }),
        'x-idempotency-key': 'evt-1',
      },
      payload,
    });

  it('acepta un webhook firmado y encola el mensaje', async () => {
    const payload = fixture('text');
    const response = await post(payload, computeSignature(payload, SECRET));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, accepted: 1 });

    await queue.drain();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: 'text', waMessageId: 'wamid.TEXT001' });
  });

  it('rechaza con 401 una firma inválida y no procesa nada', async () => {
    const response = await post(fixture('text'), 'firma-trucha');

    expect(response.statusCode).toBe(401);
    await queue.drain();
    expect(received).toHaveLength(0);
  });

  it('rechaza con 401 si no viene la firma', async () => {
    expect((await post(fixture('text'))).statusCode).toBe(401);
  });

  it('ignora el reintento del mismo evento', async () => {
    const payload = fixture('text');
    const signature = computeSignature(payload, SECRET);

    await post(payload, signature);
    await post(payload, signature);
    await queue.drain();

    expect(received).toHaveLength(1);
  });

  it('desarma un batch en varios mensajes y no los confunde entre sí', async () => {
    const payload = fixture('batch');

    await post(payload, computeSignature(payload, SECRET));
    await queue.drain();

    expect(received).toHaveLength(2);
    // Con batch la key del evento es compartida, así que la deduplicación va
    // por id de mensaje: si fuera por evento perderíamos el segundo.
    expect(received.map((message) => message.waMessageId)).toEqual([
      'wamid.BATCH001',
      'wamid.BATCH002',
    ]);
  });

  it('contesta 200 aunque el payload no traiga nada usable', async () => {
    const payload = fixture('outbound');
    const response = await post(payload, computeSignature(payload, SECRET));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, accepted: 0 });
  });

  it('/health responde ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});

describe('SerialQueue', () => {
  it('serializa por clave y deja correr claves distintas en paralelo', async () => {
    const order: string[] = [];
    const queue = new SerialQueue(() => undefined);
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    queue.push('a', async () => {
      await wait(20);
      order.push('a1');
    });
    queue.push('a', async () => {
      order.push('a2');
    });
    queue.push('b', async () => {
      order.push('b1');
    });

    await queue.drain();

    // b1 no espera a la cadena de 'a', pero a2 sí espera a a1.
    expect(order.indexOf('a1')).toBeLessThan(order.indexOf('a2'));
    expect(order).toContain('b1');
  });

  it('un error no rompe la cadena ni escapa del drain', async () => {
    const errors: unknown[] = [];
    const queue = new SerialQueue((error) => errors.push(error));
    const done: string[] = [];

    queue.push('a', async () => {
      throw new Error('boom');
    });
    queue.push('a', async () => {
      done.push('siguiente');
    });

    await queue.drain();

    expect(errors).toHaveLength(1);
    expect(done).toEqual(['siguiente']);
  });
});
