import { pino, type Logger } from 'pino';

import { AccessGate } from '../src/auth.js';
import { openDatabase, type Db } from '../src/db/index.js';
import { Repo } from '../src/db/repo.js';
import type { AppContext } from '../src/pipeline/context.js';
import type { Interpretation } from '../src/pipeline/interpret.js';
import type { Transcriber } from '../src/providers/groq.js';
import type { Button, Messenger } from '../src/providers/kapso.js';
import type { ChatMessage, ChatProvider } from '../src/providers/llm.js';
import type { InboundBase, InboundMessage } from '../src/types.js';

/** Logger mudo, para los tests que llaman directo a las piezas del pipeline. */
export const silentLogger = pino({ level: 'silent' });

export const PASSWORD = 'la-contra';
export const PHONE_A = '5491122334455';
export const PHONE_B = '5491199887766';

export interface SentMessage {
  to: string;
  body: string;
  buttons?: Button[];
}

export class FakeMessenger implements Messenger {
  readonly sent: SentMessage[] = [];
  audio: Buffer = Buffer.from('audio falso');
  downloadShouldFail = false;

  async sendText(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
  }

  async sendButtons(to: string, body: string, buttons: Button[]): Promise<void> {
    this.sent.push({ to, body, buttons });
  }

  async downloadMedia(): Promise<Buffer> {
    if (this.downloadShouldFail) throw new Error('no pude bajar el audio');
    return this.audio;
  }

  get last(): SentMessage | undefined {
    return this.sent.at(-1);
  }

  get bodies(): string[] {
    return this.sent.map((message) => message.body);
  }
}

/** LLM guionado: devuelve la interpretación que le pongas, sin salir a la red. */
export class ScriptedLlm implements ChatProvider {
  readonly name = 'scripted';
  readonly calls: ChatMessage[][] = [];
  private queue: Array<Partial<Interpretation> | Error> = [];

  push(...results: Array<Partial<Interpretation> | Error>): this {
    this.queue.push(...results);
    return this;
  }

  async chatJson(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    const next = this.queue.shift();
    if (next instanceof Error) throw next;

    return JSON.stringify({
      intent: 'unknown',
      description: null,
      level: null,
      spot: null,
      confidence: 1,
      ...next,
    });
  }
}

export class ScriptedTranscriber implements Transcriber {
  constructor(private result: string | Error = 'texto transcrito') {}

  set(result: string | Error): void {
    this.result = result;
  }

  async transcribe(): Promise<string> {
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

export interface TestContext extends AppContext {
  /** Handle crudo, para poder envejecer filas y probar vencimientos. */
  db: Db;
  repo: Repo;
  kapso: FakeMessenger;
  llm: ScriptedLlm;
  transcriber: ScriptedTranscriber;
}

export function createTestContext(
  options: { authorized?: string[]; pendingTtlMs?: number; logger?: Logger } = {},
): TestContext {
  const db = openDatabase(':memory:');
  const repo = new Repo(db);
  for (const phone of options.authorized ?? []) repo.authorize(phone, null);

  return {
    db,
    repo,
    kapso: new FakeMessenger(),
    llm: new ScriptedLlm(),
    transcriber: new ScriptedTranscriber(),
    gate: new AccessGate(repo, PASSWORD, 5),
    logger: options.logger ?? silentLogger,
    pendingTtlMs: options.pendingTtlMs ?? 30 * 60_000,
  };
}

/* ── Constructores de mensajes entrantes ───────────────────────────────── */

let counter = 0;

function base(from: string, overrides: Partial<InboundBase> = {}): InboundBase {
  counter += 1;
  return {
    waMessageId: `wamid.TEST${counter}`,
    from,
    profileName: null,
    timestamp: new Date(),
    phoneNumberId: '123456789012345',
    conversationId: 'conv_test',
    ...overrides,
  };
}

export function textMessage(text: string, from = PHONE_A, overrides?: Partial<InboundBase>): InboundMessage {
  return { ...base(from, overrides), kind: 'text', text };
}

export function audioMessage(from = PHONE_A, overrides?: Partial<InboundBase>): InboundMessage {
  return {
    ...base(from, overrides),
    kind: 'audio',
    mediaId: 'media_1',
    mediaUrl: null,
    kapsoTranscript: null,
  };
}

export function locationMessage(
  lat: number,
  lng: number,
  from = PHONE_A,
  name: string | null = null,
): InboundMessage {
  return { ...base(from), kind: 'location', lat, lng, name, address: null };
}

/** Antigüa una fila de parkings para poder probar el vencimiento del pendiente. */
export function ageParking(context: TestContext, id: number, minutes: number): void {
  const when = new Date(Date.now() - minutes * 60_000).toISOString();
  context.db.prepare('UPDATE parkings SET created_at = ? WHERE id = ?').run(when, id);
}

export function buttonMessage(buttonId: string, from = PHONE_A): InboundMessage {
  return { ...base(from), kind: 'button', buttonId, buttonTitle: '' };
}
