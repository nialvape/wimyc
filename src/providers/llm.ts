import { ProviderError, readErrorBody } from './errors.js';

/** Interfaz mínima de un proveedor de chat: nos alcanza con JSON de vuelta. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatProvider {
  readonly name: string;
  /** Devuelve el texto crudo de la respuesta, que esperamos que sea JSON. */
  chatJson(messages: ChatMessage[]): Promise<string>;
}

/**
 * Encadena proveedores: usa el primero, y si explota (rate limit, 5xx, timeout)
 * cae al siguiente. Si fallan todos, tira el último error.
 */
export function withFallback(
  providers: ChatProvider[],
  onFallback?: (failed: string, error: unknown) => void,
): ChatProvider {
  if (providers.length === 0) throw new Error('withFallback necesita al menos un proveedor');

  return {
    name: providers.map((provider) => provider.name).join('→'),
    async chatJson(messages) {
      let lastError: unknown;
      for (const provider of providers) {
        try {
          return await provider.chatJson(messages);
        } catch (error) {
          lastError = error;
          onFallback?.(provider.name, error);
        }
      }
      throw lastError;
    },
  };
}

/** Cliente de cualquier API compatible con OpenAI chat/completions. */
export class OpenAICompatibleProvider implements ChatProvider {
  constructor(
    readonly name: string,
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      model: string;
      timeoutMs: number;
      temperature: number;
      extraHeaders?: Record<string, string>;
      /** Campos extra del body, para parámetros propios de cada proveedor. */
      extraBody?: Record<string, unknown>;
    },
  ) {}

  async chatJson(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.apiKey}`,
        ...this.options.extraHeaders,
      },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        temperature: this.options.temperature,
        response_format: { type: 'json_object' },
        ...this.options.extraBody,
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (!response.ok) {
      throw new ProviderError(this.name, response.status, await readErrorBody(response));
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    // Los modelos de razonamiento a veces gastan toda la salida razonando y
    // devuelven 200 con el content vacío. Es un fallo del proveedor, no un
    // JSON inválido: hay que reintentar, no dar por perdida la interpretación.
    if (!content) throw new ProviderError(this.name, 200, 'respuesta sin content');
    return content;
  }
}
