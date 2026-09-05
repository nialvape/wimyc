import type { Logger } from 'pino';
import { z } from 'zod';

import { CITY_HINT } from '../places.js';
import { errorFields } from '../providers/errors.js';
import type { ChatProvider } from '../providers/llm.js';

export const InterpretationSchema = z.object({
  intent: z.enum(['save', 'query', 'clear', 'help', 'unknown']),
  description: z.string().trim().min(1).nullable().catch(null),
  level: z.string().trim().min(1).nullable().catch(null),
  spot: z.string().trim().min(1).nullable().catch(null),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;

export interface InterpretContext {
  hasActive: boolean;
  activeDescription: string | null;
  /** `true` si el texto viene de Whisper y puede tener errores de transcripción. */
  fromAudio: boolean;
  logger: Logger;
}

const SYSTEM_PROMPT = `Sos el intérprete de WIMYC, un bot de WhatsApp que recuerda dónde quedó estacionado un auto.
Tu única tarea es leer el mensaje del usuario y devolver JSON. No conversás, no saludás, no explicás.

Devolvés exactamente este objeto:
{
  "intent": "save" | "query" | "clear" | "help" | "unknown",
  "description": string | null,
  "level": string | null,
  "spot": string | null,
  "confidence": number
}

INTENCIONES
- "save": el usuario está diciendo dónde dejó el auto.
  Ej: "lo dejé en Cabildo y Juramento", "estacioné frente a la farmacia", "cochera del shopping".
- "query": pregunta dónde está el auto.
  Ej: "dónde está el auto", "dónde lo dejé", "dónde quedó", "che, el auto?".
- "clear": ya lo sacó / ya lo tiene.
  Ej: "ya lo saqué", "ya lo agarré", "borralo", "estoy manejando".
- "help": pide ayuda o pregunta qué hacés.
- "unknown": no es ninguna de las anteriores.

CAMPOS
- "description": la ubicación en una frase corta, limpia y en castellano.
  Sacá el relleno ("che", "mirá", "eh", "o sea") y el verbo ("dejé el auto en").
  Guardá calles, alturas, esquinas, referencias y el nombre del lugar.
  Poné null si intent no es "save".
- "level": nivel/piso de cochera si lo menciona, sólo el valor ("2", "-1", "subsuelo"). Si no, null.
- "spot": número o código del lugar si lo menciona ("47", "B12"). Si no, null.
- "confidence": qué tan seguro estás de la intención, entre 0 y 1.

DÓNDE ESTÁ EL AUTO
Todas las ubicaciones son en ${CITY_HINT}. Cuando corrijas o completes un nombre de calle, avenida,
barrio o lugar, tiene que ser uno que exista ahí. Ante una transcripción ambigua elegí la calle
porteña más parecida fonéticamente antes que un nombre genérico o de otra ciudad.

CORRECCIÓN DE TRANSCRIPCIÓN
El texto puede venir de un dictado y traer errores. Corregí nombres propios al escribirlos en
"description": "cabilo" -> "Cabildo", "escala brini ortiz" -> "Scalabrini Ortiz",
"puerto madero" -> "Puerto Madero", "curapa ligue" -> "Curapaligüe", "aca suenaga" -> "Azcuénaga".
Normalizá los números dictados: "mil doscientos treinta y cuatro" -> "1234".
Corregí sólo lo que es claramente un error de dictado. Si no reconocés el nombre, dejalo como vino.
Nunca inventes una calle, una altura ni un dato que el usuario no dijo.

FORMATO DE LA RESPUESTA
Respondé ÚNICA Y ESTRICTAMENTE con un objeto JSON válido.
No incluyas explicaciones, saludos, comentarios ni bloques de código markdown.
No escribas nada antes de la primera llave ni después de la última.
El primer carácter de tu respuesta tiene que ser { y el último tiene que ser }.
Las cinco claves —intent, description, level, spot, confidence— van siempre, aunque el valor sea null.`;

const ATTEMPTS = 2;

/**
 * Manda el texto al LLM y devuelve la interpretación validada.
 *
 * Reintenta una vez, y por dos motivos distintos:
 *  - el modelo devolvió algo que no es el JSON que esperamos
 *  - el proveedor falló. Groq tira `400 json_validate_failed` cada tanto
 *    cuando su propio validador rechaza la generación; es transitorio y al
 *    segundo intento sale bien.
 *
 * Si igual no se puede parsear, devuelve `unknown` y el usuario recibe "no te
 * entendí". Si el proveedor falla también en el último intento, tira: eso no es
 * "no te entendí", es que el servicio está caído, y el usuario merece saberlo.
 */
export async function interpret(
  provider: ChatProvider,
  text: string,
  context: InterpretContext,
): Promise<Interpretation> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(text, context) },
  ];

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();

    try {
      const raw = await provider.chatJson(messages);
      const parsed = safeParse(raw);

      if (parsed) {
        context.logger.debug(
          { ms: Date.now() - startedAt, attempt, intent: parsed.intent, description: parsed.description },
          'llm interpretó',
        );
        return parsed;
      }

      // Sin esto, un modelo que empezó a devolver prosa es indistinguible de
      // uno que no entiende al usuario.
      context.logger.warn(
        { attempt, ms: Date.now() - startedAt, raw: raw.replace(/\s+/g, ' ').slice(0, 200) },
        'el llm no devolvió el JSON que esperábamos',
      );
    } catch (error) {
      context.logger.warn(
        { ...errorFields(error), attempt, ms: Date.now() - startedAt },
        attempt < ATTEMPTS ? 'el llm falló, reintento' : 'el llm falló en todos los intentos',
      );
      if (attempt === ATTEMPTS) throw error;
    }
  }

  context.logger.warn({ attempts: ATTEMPTS }, 'no pude interpretar el mensaje, lo doy por unknown');
  return { intent: 'unknown', description: null, level: null, spot: null, confidence: 0 };
}

function buildUserPrompt(text: string, context: InterpretContext): string {
  const state = context.hasActive
    ? `Ahora mismo hay un auto guardado en: ${context.activeDescription ?? 'una ubicación sin descripción'}.`
    : 'Ahora mismo no hay ningún auto guardado.';

  const origin = context.fromAudio
    ? 'El mensaje viene de una nota de voz transcrita automáticamente y puede tener errores de dictado.'
    : 'El mensaje lo escribió el usuario a mano.';

  return `${state}\n${origin}\n\nMensaje del usuario:\n"""\n${text}\n"""`;
}

function safeParse(raw: string): Interpretation | null {
  const json = extractJson(raw);
  if (!json) return null;

  try {
    const result = InterpretationSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Algunos modelos envuelven el JSON en ```json a pesar de response_format. */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  return candidate.slice(start, end + 1);
}
