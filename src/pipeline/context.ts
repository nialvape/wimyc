import type { Logger } from 'pino';

import type { AccessGate } from '../auth.js';
import type { Repo } from '../db/repo.js';
import type { Transcriber } from '../providers/groq.js';
import type { Messenger } from '../providers/kapso.js';
import type { ChatProvider } from '../providers/llm.js';

/** Todo lo que necesita el pipeline, inyectado para poder testearlo. */
export interface AppContext {
  repo: Repo;
  kapso: Messenger;
  llm: ChatProvider;
  transcriber: Transcriber;
  gate: AccessGate;
  logger: Logger;
  pendingTtlMs: number;
}
