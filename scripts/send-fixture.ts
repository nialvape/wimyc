/**
 * Postea un webhook firmado al server local, para probar el bot sin WhatsApp.
 *
 *   npm run send-fixture               -> lista los fixtures disponibles
 *   npm run send-fixture text          -> manda test/fixtures/text.json
 *   npm run send-fixture text "hola"   -> reemplaza el body del texto
 *
 * Cubre todo el flujo salvo la entrega real: la respuesta del bot sale por
 * Kapso, así que mirala en los logs del server (o en WhatsApp si apuntás a un
 * número real).
 */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { computeSignature } from '../src/webhook/signature.js';

loadDotenv();

const FIXTURES_DIR = join(import.meta.dirname, '..', 'test', 'fixtures');

async function main(): Promise<void> {
  const [name, override] = process.argv.slice(2);

  const available = readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''));

  if (!name || !available.includes(name)) {
    console.error(`Uso: npm run send-fixture <${available.join('|')}> [texto]`);
    process.exit(1);
  }

  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret) {
    console.error('Falta KAPSO_WEBHOOK_SECRET en el .env');
    process.exit(1);
  }

  const payload = JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8'));

  // Un id nuevo en cada corrida, si no la idempotencia lo descarta.
  if (payload.message?.id) payload.message.id = `wamid.LOCAL${Date.now()}`;
  if (override && payload.message?.text) payload.message.text.body = override;

  const body = JSON.stringify(payload);
  const port = process.env.PORT ?? '3000';
  const url = `http://localhost:${port}/webhooks/kapso`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Event': 'whatsapp.message.received',
      'X-Webhook-Signature': computeSignature(body, secret),
      'X-Idempotency-Key': randomUUID(),
      'X-Webhook-Payload-Version': 'v2',
    },
    body,
  });

  console.log(`${response.status} ${await response.text()}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
