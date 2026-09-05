import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const EnvSchema = z.object({
  // Kapso
  PHONE_NUMBER_ID: z.string().min(1),
  KAPSO_BASE_URL: z.string().url().default('https://api.kapso.ai/meta/whatsapp'),
  KAPSO_API_KEY: z.string().min(1),
  KAPSO_WEBHOOK_SECRET: z.string().min(1),
  GRAPH_API_VERSION: z.string().default('v24.0'),

  // Acceso
  ACCESS_PASSWORD: z.string().min(1),

  // Groq
  GROQ_API_KEY: z.string().min(1),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  GROQ_LLM: z.string().min(1),

  // OpenRouter (fallback del LLM, opcional)
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z.string().optional(),

  // App
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_PATH: z.string().default('./data/wimyc.db'),
  DEFAULT_TZ: z.string().default('America/Argentina/Buenos_Aires'),
  PUBLIC_BASE_URL: z.string().url().optional(),

  // Reglas de negocio
  PENDING_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  PASSWORD_ATTEMPTS_PER_HOUR: z.coerce.number().int().positive().default(5),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

export type Config = z.infer<typeof EnvSchema> & {
  /** El fallback a OpenRouter sólo existe si están la key y el modelo. */
  openRouterEnabled: boolean;
};

let cached: Config | null = null;

/**
 * Valida el entorno y devuelve la config. Falla ruidosamente al arrancar si
 * falta algo, en vez de romper a mitad de un mensaje de un usuario.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida. Revisá el .env (ver .env.example):\n${detail}`);
  }

  const openRouterEnabled = Boolean(parsed.data.OPENROUTER_API_KEY && parsed.data.OPENROUTER_MODEL);
  cached = { ...parsed.data, openRouterEnabled };
  return cached;
}

export function getConfig(): Config {
  if (!cached) return loadConfig();
  return cached;
}

/** Sólo para tests. */
export function setConfig(config: Config): void {
  cached = config;
}
