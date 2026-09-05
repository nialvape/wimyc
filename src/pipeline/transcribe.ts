import { errorFields } from '../providers/errors.js';
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
  const startedAt = Date.now();

  try {
    const audio = await context.kapso.downloadMedia({
      mediaUrl: message.mediaUrl,
      mediaId: message.mediaId,
    });
    const downloadedAt = Date.now();

    const text = await context.transcriber.transcribe(audio, `${message.waMessageId}.ogg`);

    if (text.trim().length > 0) {
      // El texto crudo es lo primero que se mira cuando el bot guarda mal una
      // calle: dice si le erró Whisper o le erró el LLM.
      context.logger.debug(
        {
          bytes: audio.length,
          downloadMs: downloadedAt - startedAt,
          sttMs: Date.now() - downloadedAt,
          transcript: text.trim(),
        },
        'whisper transcribió',
      );
      return text.trim();
    }
  } catch (error) {
    context.logger.warn(
      { ...errorFields(error), ms: Date.now() - startedAt, hasKapsoFallback: Boolean(message.kapsoTranscript) },
      'falló la transcripción con Groq',
    );
  }

  const fallback = message.kapsoTranscript?.trim();
  if (fallback && fallback.length > 0) {
    context.logger.info({ transcript: fallback }, 'uso la transcripción que ya trajo Kapso');
    return fallback;
  }

  return null;
}
