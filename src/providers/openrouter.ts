import type { Config } from '../config.js';
import { OpenAICompatibleProvider, type ChatProvider } from './llm.js';

/** Fallback del LLM. Devuelve `null` si no está configurado. */
export function createOpenRouterProvider(config: Config): ChatProvider | null {
  if (!config.openRouterEnabled) return null;

  return new OpenAICompatibleProvider('openrouter', {
    baseUrl: config.OPENROUTER_BASE_URL,
    apiKey: config.OPENROUTER_API_KEY!,
    model: config.OPENROUTER_MODEL!,
    timeoutMs: config.HTTP_TIMEOUT_MS,
    temperature: config.LLM_TEMPERATURE,
    extraHeaders: {
      ...(config.PUBLIC_BASE_URL ? { 'HTTP-Referer': config.PUBLIC_BASE_URL } : {}),
      'X-Title': 'WIMYC',
    },
  });
}
