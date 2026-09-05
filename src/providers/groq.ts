import type { Config } from '../config.js';
import { OpenAICompatibleProvider, type ChatProvider } from './llm.js';

export function createGroqProvider(config: Config): ChatProvider {
  return new OpenAICompatibleProvider('groq', {
    baseUrl: config.GROQ_BASE_URL,
    apiKey: config.GROQ_API_KEY,
    model: config.GROQ_LLM,
    timeoutMs: config.HTTP_TIMEOUT_MS,
  });
}

export interface Transcriber {
  transcribe(audio: Buffer, filename: string): Promise<string>;
}

/** Speech-to-text con Whisper en Groq. */
export class GroqTranscriber implements Transcriber {
  constructor(private readonly config: Config) {}

  async transcribe(audio: Buffer, filename = 'audio.ogg'): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)]), filename);
    form.append('model', this.config.GROQ_STT_MODEL);
    form.append('language', 'es');
    form.append('response_format', 'json');
    // Sesga la transcripción hacia el dominio: direcciones y cocheras.
    form.append(
      'prompt',
      'Nota de voz en español rioplatense sobre dónde quedó estacionado un auto: ' +
        'calles, alturas, esquinas, niveles de cochera y números de lugar.',
    );

    const response = await fetch(
      `${this.config.GROQ_BASE_URL.replace(/\/+$/, '')}/audio/transcriptions`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.GROQ_API_KEY}` },
        body: form,
        signal: AbortSignal.timeout(this.config.HTTP_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Groq STT respondió ${response.status}: ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json()) as { text?: string };
    const text = payload.text?.trim();
    if (!text) throw new Error('Groq STT devolvió una transcripción vacía');
    return text;
  }
}
