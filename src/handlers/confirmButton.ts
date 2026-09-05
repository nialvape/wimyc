import { messages } from '../reply/messages.js';
import type { AppContext } from '../pipeline/context.js';
import type { InboundMessage } from '../types.js';

type ButtonMessage = Extract<InboundMessage, { kind: 'button' }>;

interface ButtonAction {
  action: 'confirm' | 'edit';
  parkingId: number;
}

/**
 * Resuelve los botones de confirmación de un audio.
 *
 * Acá NO interviene el LLM: la acción viene codificada en el id del botón y
 * todas las respuestas son texto fijo.
 */
export async function handleButton(context: AppContext, message: ButtonMessage): Promise<boolean> {
  const parsed = parseButtonId(message.buttonId);
  if (!parsed) return false;

  const parking = context.repo.findParking(parsed.parkingId);

  if (!parking || parking.status !== 'pending') {
    await context.kapso.sendText(message.from, messages.confirmationGone);
    return true;
  }

  if (Date.now() - new Date(parking.created_at).getTime() > context.pendingTtlMs) {
    context.repo.discardPending(parking.id);
    await context.kapso.sendText(message.from, messages.confirmationExpired);
    return true;
  }

  if (parsed.action === 'confirm') {
    const confirmed = context.repo.confirmPending(parking.id);
    await context.kapso.sendText(
      message.from,
      confirmed ? messages.audioConfirmed : messages.confirmationGone,
    );
    return true;
  }

  // "Modificar": tiramos el pendiente y dejamos intacto lo que ya estaba activo.
  context.repo.discardPending(parking.id);
  await context.kapso.sendText(message.from, messages.audioRejected);
  return true;
}

function parseButtonId(buttonId: string): ButtonAction | null {
  const match = /^(confirm|edit):(\d+)$/.exec(buttonId.trim());
  if (!match) return null;

  return {
    action: match[1] as 'confirm' | 'edit',
    parkingId: Number(match[2]),
  };
}
