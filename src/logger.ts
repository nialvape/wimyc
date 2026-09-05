import { pino, type Logger } from 'pino';

import { getConfig } from './config.js';

let cached: Logger | null = null;

export function getLogger(): Logger {
  if (cached) return cached;

  const config = getConfig();
  const pretty = config.NODE_ENV === 'development';

  cached = pino({
    level: config.LOG_LEVEL,
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
    // No logueamos números completos ni la contraseña.
    redact: {
      paths: ['req.headers["x-webhook-signature"]', 'req.headers["x-api-key"]', 'password'],
      remove: true,
    },
  });

  return cached;
}

/** `+5491122334455` -> `+549…4455`, para poder debuggear sin dejar el número en los logs. */
export function maskPhone(phone: string): string {
  if (phone.length <= 8) return '***';
  return `${phone.slice(0, 4)}…${phone.slice(-4)}`;
}
