import type { FastifyInstance, RawServerDefault } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';

/**
 * La instancia de Fastify con NUESTRO logger de pino.
 *
 * Por defecto Fastify se tipa con `FastifyBaseLogger`, que no es compatible con
 * el `Logger` concreto de pino que le inyectamos. Fijamos el genérico una sola
 * vez acá para que server.ts y las rutas hablen del mismo tipo.
 */
export type App = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  Logger
>;
