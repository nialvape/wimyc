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
  // Sólo lo entienden los modelos de razonamiento (gpt-oss). 'off' lo omite,
  // para poder cambiar a un modelo que rechace el parámetro.
  GROQ_REASONING_EFFORT: z.enum(['off', 'low', 'medium', 'high']).default('medium'),
  // El formato lo fija response_format, así que esto sólo regula cuánto se
  // suelta el modelo al interpretar. Se toca seguido: mejor en el .env.
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.5),

  // OpenRouter (fallback del LLM, opcional)
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z.string().optional(),

  // App
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Sin valor explícito el default depende del entorno: ver más abajo.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
  DATABASE_PATH: z.string().default('./data/wimyc.db'),
  DEFAULT_TZ: z.string().default('America/Argentina/Buenos_Aires'),
  PUBLIC_BASE_URL: z.string().url().optional(),

  // Reglas de negocio
  PENDING_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  PASSWORD_ATTEMPTS_PER_HOUR: z.coerce.number().int().positive().default(5),
  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

export type Config = z.infer<typeof EnvSchema> & {
  LOG_LEVEL: NonNullable<z.infer<typeof EnvSchema>['LOG_LEVEL']>;
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

  // En desarrollo querés ver qué transcribió Whisper y qué entendió el LLM;
  // en producción esa misma línea imprime la ubicación del auto en cada
  // mensaje, así que ahí el default es info.
  const logLevel =
    parsed.data.LOG_LEVEL ?? (parsed.data.NODE_ENV === 'development' ? 'debug' : 'info');

  cached = { ...parsed.data, LOG_LEVEL: logLevel, openRouterEnabled };
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
