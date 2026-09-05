import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../src/config.js';
import { createGroqProvider } from '../src/providers/groq.js';
import { createOpenRouterProvider } from '../src/providers/openrouter.js';

const config = {
  GROQ_BASE_URL: 'https://api.groq.com/openai/v1',
  GROQ_API_KEY: 'gsk-test',
  GROQ_LLM: 'openai/gpt-oss-20b',
  GROQ_REASONING_EFFORT: 'low',
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  OPENROUTER_API_KEY: 'or-test',
  OPENROUTER_MODEL: 'meta-llama/llama-3.3-70b-instruct',
  openRouterEnabled: true,
  HTTP_TIMEOUT_MS: 5000,
} as unknown as Config;

/** Intercepta fetch y devuelve el body que se mandó. */
function captureBody(): () => Record<string, unknown> {
  let captured: Record<string, unknown> = {};

  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    captured = JSON.parse(init.body as string) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }), {
      status: 200,
    });
  });

  return () => captured;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider de Groq', () => {
  it('manda temperature 1, no 0', async () => {
    const body = captureBody();
    await createGroqProvider(config).chatJson([{ role: 'user', content: 'hola' }]);

    // Los modelos de razonamiento están recomendados a 1; en 0 devuelven
    // content vacío y Groq rechaza con 400 json_validate_failed.
    expect(body().temperature).toBe(1);
  });

  it('acota el razonamiento para que quede presupuesto para el JSON', async () => {
    const body = captureBody();
    await createGroqProvider(config).chatJson([{ role: 'user', content: 'hola' }]);

    expect(body().reasoning_effort).toBe('low');
    expect(body().response_format).toEqual({ type: 'json_object' });
  });

  it('omite reasoning_effort si está en off', async () => {
    const body = captureBody();
    await createGroqProvider({ ...config, GROQ_REASONING_EFFORT: 'off' } as Config).chatJson([
      { role: 'user', content: 'hola' },
    ]);

    expect(body()).not.toHaveProperty('reasoning_effort');
  });
});

describe('provider de OpenRouter', () => {
  it('no le manda reasoning_effort, que es propio de Groq', async () => {
    const body = captureBody();
    await createOpenRouterProvider(config)!.chatJson([{ role: 'user', content: 'hola' }]);

    expect(body()).not.toHaveProperty('reasoning_effort');
    expect(body().temperature).toBe(1);
  });
});
