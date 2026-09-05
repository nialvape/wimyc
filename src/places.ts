/**
 * Contexto geográfico y lingüístico del bot.
 *
 * Si el auto se muda a otra ciudad, este archivo es lo único que hay que tocar.
 */

/**
 * Va en el prompt del LLM, que es el único que interpreta.
 *
 * Sin esto, "cabilo" queda tal cual: los nombres porteños no están en el
 * vocabulario frecuente del modelo y necesita saber hacia dónde corregir.
 */
export const CITY_HINT = 'la Ciudad Autónoma de Buenos Aires (CABA) y el conurbano bonaerense';

/**
 * Va en el `prompt` de Whisper. A propósito es apenas una pista de acento, no
 * un diccionario de calles: Whisper transcribe lo que escucha y el que arregla
 * los nombres mal transcritos es el LLM, que tiene contexto para hacerlo bien.
 */
export const STT_PROMPT = 'Nota de voz en español rioplatense.';
