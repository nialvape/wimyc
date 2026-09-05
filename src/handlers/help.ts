import { messages } from '../reply/messages.js';
import type { AppContext } from '../pipeline/context.js';
import type { InboundMessage } from '../types.js';

export async function help(context: AppContext, message: InboundMessage): Promise<void> {
  await context.kapso.sendText(message.from, messages.help);
}
