import { messages } from '../reply/messages.js';
import type { AppContext } from '../pipeline/context.js';
import type { InboundMessage } from '../types.js';

export async function clearParking(context: AppContext, message: InboundMessage): Promise<void> {
  const cleared = context.repo.clearActive();
  await context.kapso.sendText(
    message.from,
    cleared ? messages.cleared : messages.nothingToClear,
  );
}
