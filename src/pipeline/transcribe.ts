import type { InboundMessage } from '../types.js';
import type { AppContext } from './context.js';

type AudioMessage = Extract<InboundMessage, { kind: 'audio' }>;

/**
 * Pasa una nota de voz a texto con Groq Whisper.
 *
 * Si Groq falla (rate limit, timeout, audio raro) caemos a la transcripción que
 * Kapso a veces ya adjunta en el webhook. Devuelve `null` si no hay forma.
 */
export async function transcribeAudio(
  context: AppContext,
  message: AudioMessage,
): Promise<string | null> {
  try {
    const audio = await context.kapso.downloadMedia({
      mediaUrl: message.mediaUrl,
      mediaId: message.mediaId,
    });
    const text = await context.transcriber.transcribe(audio, `${message.waMessageId}.ogg`);
    if (text.trim().length > 0) return text.trim();
  } catch (error) {
    context.logger.warn({ err: error }, 'falló Groq STT, pruebo con la transcripción de Kapso');
  }

  const fallback = message.kapsoTranscript?.trim();
  return fallback && fallback.length > 0 ? fallback : null;
}
