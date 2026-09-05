import { messages } from '../reply/messages.js';
import { describeParking } from '../reply/format.js';
import type { Interpretation } from '../pipeline/interpret.js';
import type { AppContext } from '../pipeline/context.js';
import type { InboundMessage } from '../types.js';

/** Guarda directo y confirma. Para texto escrito, donde no hay nada que dudar. */
export async function saveFromText(
  context: AppContext,
  message: Extract<InboundMessage, { kind: 'text' }>,
  interpretation: Interpretation,
): Promise<void> {
  const parking = context.repo.saveActive({
    description: interpretation.description,
    level: interpretation.level,
    spot: interpretation.spot,
    source: 'text',
    createdByPhone: message.from,
    createdByName: message.profileName,
    waMessageId: message.waMessageId,
  });

  await context.kapso.sendText(message.from, messages.saved(parking));
}

/** Guarda el pin de ubicación. No pasa por el LLM: las coordenadas son exactas. */
export async function saveFromLocation(
  context: AppContext,
  message: Extract<InboundMessage, { kind: 'location' }>,
): Promise<void> {
  const parking = context.repo.saveActive({
    description: message.name ?? message.address,
    lat: message.lat,
    lng: message.lng,
    source: 'location',
    createdByPhone: message.from,
    createdByName: message.profileName,
    waMessageId: message.waMessageId,
  });

  await context.kapso.sendText(message.from, messages.savedLocation(parking));
}

/**
 * Guarda como pendiente y pide confirmación con botones.
 *
 * Es el único camino para los audios: Whisper puede errarle a una calle, así
 * que el usuario ve lo que entendimos antes de que quede guardado.
 */
export async function saveFromAudioPending(
  context: AppContext,
  message: Extract<InboundMessage, { kind: 'audio' }>,
  interpretation: Interpretation,
  transcript: string,
): Promise<void> {
  const parking = context.repo.savePending({
    description: interpretation.description,
    level: interpretation.level,
    spot: interpretation.spot,
    source: 'audio',
    transcript,
    createdByPhone: message.from,
    createdByName: message.profileName,
    waMessageId: message.waMessageId,
  });

  await context.kapso.sendButtons(
    message.from,
    messages.confirmAudio(describeParking(parking)),
    [
      { id: `confirm:${parking.id}`, title: messages.confirmButtonTitle },
      { id: `edit:${parking.id}`, title: messages.editButtonTitle },
    ],
  );
}
