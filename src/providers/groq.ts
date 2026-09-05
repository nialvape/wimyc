import type { Config } from '../config.js';
import { STT_PROMPT } from '../places.js';
import { ProviderError, readErrorBody } from './errors.js';
import { OpenAICompatibleProvider, type ChatProvider } from './llm.js';

export function createGroqProvider(config: Config): ChatProvider {
  return new OpenAICompatibleProvider('groq', {
    baseUrl: config.GROQ_BASE_URL,
    apiKey: config.GROQ_API_KEY,
    model: config.GROQ_LLM,
    timeoutMs: config.HTTP_TIMEOUT_MS,
    temperature: config.LLM_TEMPERATURE,
    // Interpretar una dirección dictada mal transcrita necesita razonar, así
    // que no lo apretamos más de la cuenta. Si vuelve el 400
    // json_validate_failed —gpt-oss gastando toda la salida en razonar— la
    // palanca es bajarlo, no subirlo.
    extraBody:
      config.GROQ_REASONING_EFFORT === 'off'
        ? {}
        : { reasoning_effort: config.GROQ_REASONING_EFFORT },
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
    // Sólo una pista de acento. Whisper transcribe lo que escucha; corregir los
    // nombres de calles es trabajo del LLM, que sabe en qué ciudad estamos.
    form.append('prompt', STT_PROMPT);

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
      throw new ProviderError('groq-stt', response.status, await readErrorBody(response));
    }

    const payload = (await response.json()) as { text?: string };
    const text = payload.text?.trim();
    if (!text) throw new ProviderError('groq-stt', 200, 'transcripción vacía');
    return text;
  }
}
