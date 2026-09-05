import { handleButton } from '../handlers/confirmButton.js';
import { clearParking } from '../handlers/clearParking.js';
import { help } from '../handlers/help.js';
import { queryParking } from '../handlers/queryParking.js';
import { saveFromAudioPending, saveFromLocation, saveFromText } from '../handlers/saveParking.js';
import { maskPhone } from '../logger.js';
import { describeParking } from '../reply/format.js';
import { messages } from '../reply/messages.js';
import type { InboundMessage } from '../types.js';
import type { AppContext } from './context.js';
import { interpret, type Interpretation } from './interpret.js';
import { transcribeAudio } from './transcribe.js';

/**
 * Orquesta un mensaje entrante de punta a punta.
 *
 * Nunca tira: cualquier error se convierte en un mensaje al usuario, porque
 * arriba está la cola y un throw dejaría al usuario esperando para siempre.
 */
export async function handleMessage(context: AppContext, message: InboundMessage): Promise<void> {
  const log = context.logger.child({ from: maskPhone(message.from), kind: message.kind });

  try {
    const auth = context.gate.check(message);

    switch (auth.status) {
      case 'rate-limited':
        log.warn('demasiados intentos de contraseña, ignoro');
        return;
      case 'needs-password':
        await context.kapso.sendText(message.from, messages.askPassword);
        return;
      case 'just-authorized':
        log.info('teléfono nuevo autorizado');
        await context.kapso.sendText(message.from, messages.welcome);
        return;
      case 'authorized':
        break;
    }

    await route(context, message, log);
  } catch (error) {
    log.error({ err: error }, 'no pude procesar el mensaje');
    await context.kapso
      .sendText(message.from, messages.processingError)
      .catch((sendError: unknown) => log.error({ err: sendError }, 'tampoco pude avisar del error'));
  }
}

async function route(
  context: AppContext,
  message: InboundMessage,
  log: AppContext['logger'],
): Promise<void> {
  switch (message.kind) {
    case 'button': {
      const handled = await handleButton(context, message);
      if (!handled) await context.kapso.sendText(message.from, messages.couldNotUnderstand);
      return;
    }

    case 'location':
      // El pin trae coordenadas exactas: no hay nada que interpretar.
      await saveFromLocation(context, message);
      return;

    case 'text': {
      const interpretation = await interpretWith(context, message.text, false);
      log.debug({ intent: interpretation.intent }, 'texto interpretado');

      if (interpretation.intent === 'save') {
        await saveFromText(context, message, interpretation);
        return;
      }
      await routeNonSave(context, message, interpretation);
      return;
    }

    case 'audio': {
      const transcript = await transcribeAudio(context, message);
      if (!transcript) {
        await context.kapso.sendText(message.from, messages.audioNotUnderstood);
        return;
      }

      const interpretation = await interpretWith(context, transcript, true);
      log.debug({ intent: interpretation.intent }, 'audio interpretado');

      // Sólo el guardado pide confirmación: es lo único donde un error de
      // Whisper deja algo mal anotado. Consultar o borrar se hace de una.
      if (interpretation.intent === 'save') {
        await saveFromAudioPending(context, message, interpretation, transcript);
        return;
      }
      await routeNonSave(context, message, interpretation);
      return;
    }

    case 'unsupported':
      await context.kapso.sendText(message.from, messages.unsupportedType);
      return;
  }
}

async function routeNonSave(
  context: AppContext,
  message: InboundMessage,
  interpretation: Interpretation,
): Promise<void> {
  switch (interpretation.intent) {
    case 'query':
      await queryParking(context, message);
      return;
    case 'clear':
      await clearParking(context, message);
      return;
    case 'help':
      await help(context, message);
      return;
    default:
      await context.kapso.sendText(message.from, messages.couldNotUnderstand);
  }
}

/** Le pasa al LLM el estado actual, así entiende frases sueltas como "ya está". */
async function interpretWith(
  context: AppContext,
  text: string,
  fromAudio: boolean,
): Promise<Interpretation> {
  const active = context.repo.activeParking();

  return interpret(context.llm, text, {
    hasActive: active !== null,
    activeDescription: active ? describeParking(active) : null,
    fromAudio,
  });
}
