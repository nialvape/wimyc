import { messages } from '../reply/messages.js';
import type { AppContext } from '../pipeline/context.js';
import type { InboundMessage } from '../types.js';

export async function queryParking(context: AppContext, message: InboundMessage): Promise<void> {
  const parking = context.repo.activeParking();

  if (!parking) {
    await context.kapso.sendText(message.from, messages.nothingSaved);
    return;
  }

  await context.kapso.sendText(
    message.from,
    messages.whereIsIt(parking, { askedBySamePerson: parking.created_by_phone === message.from }),
  );
}
