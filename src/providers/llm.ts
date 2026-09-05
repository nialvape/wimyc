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
      extraHeaders?: Record<string, string>;
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
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${this.name} respondió ${response.status}: ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${this.name} devolvió una respuesta vacía`);
    return content;
  }
}
