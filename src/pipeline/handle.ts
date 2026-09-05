import { handleButton } from '../handlers/confirmButton.js';
import { clearParking } from '../handlers/clearParking.js';
import { help } from '../handlers/help.js';
import { queryParking } from '../handlers/queryParking.js';
import { saveFromAudioPending, saveFromLocation, saveFromText } from '../handlers/saveParking.js';
import { maskPhone } from '../logger.js';
import { errorFields } from '../providers/errors.js';
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
 *
 * Deja exactamente una línea de INFO por mensaje, con el desenlace y cuánto
 * tardó. El detalle (transcripción, interpretación, latencias por servicio) va
 * en DEBUG; lo que salió mal, en WARN.
 */
export async function handleMessage(context: AppContext, message: InboundMessage): Promise<void> {
  const startedAt = Date.now();
  const log = context.logger.child({ from: maskPhone(message.from), kind: message.kind });
  const scoped: AppContext = { ...context, logger: log };

  const done = (outcome: string, extra: Record<string, unknown> = {}): void => {
    log.info({ outcome, ms: Date.now() - startedAt, ...extra }, 'mensaje procesado');
  };

  try {
    const auth = context.gate.check(message);

    switch (auth.status) {
      case 'rate-limited':
        done('rate-limited');
        return;
      case 'needs-password':
        await context.kapso.sendText(message.from, messages.askPassword);
        done('sin-autorizar');
        return;
      case 'just-authorized':
        await context.kapso.sendText(message.from, messages.welcome);
        done('autorizado');
        return;
      case 'authorized':
        break;
    }

    done(await route(scoped, message));
  } catch (error) {
    log.error(
      { ...errorFields(error), ms: Date.now() - startedAt },
      'no pude procesar el mensaje',
    );

    await context.kapso.sendText(message.from, messages.processingError).catch((sendError: unknown) => {
      log.error(errorFields(sendError), 'tampoco pude avisarle del error al usuario');
    });
  }
}

/** Devuelve una etiqueta corta de qué terminó pasando, para la línea de INFO. */
async function route(context: AppContext, message: InboundMessage): Promise<string> {
  switch (message.kind) {
    case 'button': {
      const handled = await handleButton(context, message);
      if (handled) return 'boton';

      context.logger.warn({ buttonId: message.buttonId }, 'id de botón desconocido');
      await context.kapso.sendText(message.from, messages.couldNotUnderstand);
      return 'boton-desconocido';
    }

    case 'location':
      // El pin trae coordenadas exactas: no hay nada que interpretar.
      await saveFromLocation(context, message);
      return 'guardado-ubicacion';

    case 'text': {
      const interpretation = await interpretWith(context, message.text, false);

      if (interpretation.intent === 'save') {
        await saveFromText(context, message, interpretation);
        return 'guardado-texto';
      }
      return routeNonSave(context, message, interpretation);
    }

    case 'audio': {
      const transcript = await transcribeAudio(context, message);
      if (!transcript) {
        await context.kapso.sendText(message.from, messages.audioNotUnderstood);
        return 'audio-sin-transcribir';
      }

      const interpretation = await interpretWith(context, transcript, true);

      // Sólo el guardado pide confirmación: es lo único donde un error de
      // Whisper deja algo mal anotado. Consultar o borrar se hace de una.
      if (interpretation.intent === 'save') {
        await saveFromAudioPending(context, message, interpretation, transcript);
        return 'pendiente-de-confirmar';
      }
      return routeNonSave(context, message, interpretation);
    }

    case 'unsupported':
      context.logger.debug({ waType: message.waType }, 'tipo de mensaje no soportado');
      await context.kapso.sendText(message.from, messages.unsupportedType);
      return 'tipo-no-soportado';
  }
}

async function routeNonSave(
  context: AppContext,
  message: InboundMessage,
  interpretation: Interpretation,
): Promise<string> {
  switch (interpretation.intent) {
    case 'query':
      await queryParking(context, message);
      return 'consulta';
    case 'clear':
      await clearParking(context, message);
      return 'borrado';
    case 'help':
      await help(context, message);
      return 'ayuda';
    default:
      await context.kapso.sendText(message.from, messages.couldNotUnderstand);
      return 'no-entendido';
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
    logger: context.logger,
  });
}
