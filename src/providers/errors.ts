/**
 * Error de un servicio externo (Kapso, Groq, OpenRouter).
 *
 * Existe para separar lo esperable de lo inesperado en los logs: que Groq
 * conteste 429 no es un bug nuestro y su stack trace no aporta nada — apunta
 * siempre al mismo `fetch`. Lo que sirve es el proveedor, el status y qué dijo.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`${provider} respondió ${status}: ${detail}`);
    this.name = 'ProviderError';
  }
}

/**
 * Campos para pino. A un `ProviderError` lo aplana en datos consultables; a
 * cualquier otro error lo pasa entero, con stack, porque ahí sí es un bug.
 */
export function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof ProviderError) {
    return { provider: error.provider, status: error.status, detail: error.detail };
  }
  return { err: error };
}

/** Lee el cuerpo de una respuesta fallida sin romper si no se puede. */
export async function readErrorBody(response: Response, maxChars = 200): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, ' ').trim().slice(0, maxChars);
  } catch {
    return '<sin cuerpo>';
  }
}
