import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { handleMessage } from '../src/pipeline/handle.js';
import { ProviderError } from '../src/providers/errors.js';
import {
  audioMessage,
  createTestContext,
  PASSWORD,
  PHONE_A,
  textMessage,
} from './helpers.js';

interface LogLine {
  level: number;
  msg: string;
  [key: string]: unknown;
}

/** Logger que junta las líneas en memoria, para poder afirmar sobre ellas. */
function capturingLogger(level = 'info') {
  const lines: LogLine[] = [];
  const logger = pino(
    { level },
    {
      write(chunk: string) {
        lines.push(JSON.parse(chunk) as LogLine);
      },
    },
  );
  return { logger, lines };
}

const INFO = 30;
const WARN = 40;
const ERROR = 50;

describe('logs', () => {
  it('deja exactamente una línea de INFO por mensaje', async () => {
    const { logger, lines } = capturingLogger();
    const context = createTestContext({ authorized: [PHONE_A], logger });
    context.llm.push({ intent: 'save', description: 'Cabildo 2200' });

    await handleMessage(context, textMessage('lo dejé en Cabildo 2200'));

    const info = lines.filter((line) => line.level === INFO);
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({
      msg: 'mensaje procesado',
      outcome: 'guardado-texto',
      kind: 'text',
    });
    expect(info[0]!.ms).toBeTypeOf('number');
  });

  it('nunca loguea el teléfono completo ni la contraseña', async () => {
    const { logger, lines } = capturingLogger('debug');
    const context = createTestContext({ logger });

    await handleMessage(context, textMessage(PASSWORD));
    await handleMessage(context, textMessage('lo dejé en Cabildo 2200'));

    const dump = JSON.stringify(lines);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(PHONE_A);
    // Sí queda el número enmascarado, que alcanza para seguir una conversación.
    expect(dump).toContain('5491…4455');
  });

  it('un error de un servicio externo se loguea sin stack trace', async () => {
    const { logger, lines } = capturingLogger();
    const context = createTestContext({ authorized: [PHONE_A], logger });
    const failure = new ProviderError('groq', 429, 'Rate limit reached');
    context.llm.push(failure, failure);

    await handleMessage(context, textMessage('lo dejé en Cabildo 2200'));

    const error = lines.find((line) => line.level === ERROR)!;
    expect(error).toMatchObject({ provider: 'groq', status: 429, detail: 'Rate limit reached' });
    // El stack de un 429 apunta siempre al mismo fetch: no dice nada y tapa
    // todo lo demás.
    expect(error.err).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('stack');
  });

  it('un error inesperado sí conserva el stack', async () => {
    const { logger, lines } = capturingLogger();
    const context = createTestContext({ authorized: [PHONE_A], logger });
    context.llm.push(new TypeError('bug nuestro'), new TypeError('bug nuestro'));

    await handleMessage(context, textMessage('lo dejé en Cabildo 2200'));

    const error = lines.find((line) => line.level === ERROR)!;
    expect(JSON.stringify(error.err)).toContain('stack');
  });

  it('avisa cuando el LLM falla y reintenta', async () => {
    const { logger, lines } = capturingLogger();
    const context = createTestContext({ authorized: [PHONE_A], logger });
    context.llm.push(new ProviderError('groq', 400, 'json_validate_failed'), {
      intent: 'save',
      description: 'Cabildo 2200',
    });

    await handleMessage(context, textMessage('lo dejé en Cabildo 2200'));

    const retry = lines.find((line) => line.msg === 'el llm falló, reintento')!;
    expect(retry).toMatchObject({ level: WARN, provider: 'groq', status: 400, attempt: 1 });
  });

  it('muestra qué devolvió el modelo cuando no es el JSON esperado', async () => {
    const { logger, lines } = capturingLogger();
    const context = createTestContext({ authorized: [PHONE_A], logger });
    // El ScriptedLlm siempre arma JSON válido, así que vamos directo al provider.
    context.llm.chatJson = async () => 'Claro, con gusto te ayudo a guardar el auto.';

    await handleMessage(context, textMessage('lo dejé en Cabildo 2200'));

    const bad = lines.find((line) => line.msg === 'el llm no devolvió el JSON que esperábamos')!;
    expect(bad.raw).toContain('Claro, con gusto');
  });

  it('deja ver la transcripción de Whisper en debug', async () => {
    const { logger, lines } = capturingLogger('debug');
    const context = createTestContext({ authorized: [PHONE_A], logger });
    context.transcriber.set('dejé el auto en cabilo dos mil doscientos');
    context.llm.push({ intent: 'save', description: 'Cabildo 2200' });

    await handleMessage(context, audioMessage());

    const stt = lines.find((line) => line.msg === 'whisper transcribió')!;
    expect(stt.transcript).toBe('dejé el auto en cabilo dos mil doscientos');
    expect(stt.sttMs).toBeTypeOf('number');

    // Y al lado, lo que el LLM entendió: así se ve de un vistazo si el error
    // fue de Whisper o del modelo.
    const llm = lines.find((line) => line.msg === 'llm interpretó')!;
    expect(llm.description).toBe('Cabildo 2200');
  });
});
