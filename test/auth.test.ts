import { describe, expect, it } from 'vitest';

import { handleMessage } from '../src/pipeline/handle.js';
import { messages } from '../src/reply/messages.js';
import {
  audioMessage,
  createTestContext,
  PASSWORD,
  PHONE_A,
  textMessage,
} from './helpers.js';

describe('gate de acceso', () => {
  it('le pide la contraseña a un número desconocido', async () => {
    const context = createTestContext();

    await handleMessage(context, textMessage('hola'));

    expect(context.kapso.bodies).toEqual([messages.askPassword]);
    expect(context.repo.isAuthorized(PHONE_A)).toBe(false);
  });

  it('no transcribe ni llama al LLM para un desconocido', async () => {
    const context = createTestContext();

    await handleMessage(context, audioMessage());

    expect(context.kapso.bodies).toEqual([messages.askPassword]);
    expect(context.llm.calls).toHaveLength(0);
  });

  it('autoriza al recibir la contraseña y no la vuelve a pedir', async () => {
    const context = createTestContext();

    await handleMessage(context, textMessage(PASSWORD));
    expect(context.kapso.bodies).toEqual([messages.welcome]);
    expect(context.repo.isAuthorized(PHONE_A)).toBe(true);

    context.llm.push({ intent: 'query' });
    await handleMessage(context, textMessage('dónde está el auto?'));

    expect(context.kapso.bodies.at(-1)).toBe(messages.nothingSaved);
  });

  it('tolera espacios alrededor de la contraseña', async () => {
    const context = createTestContext();

    await handleMessage(context, textMessage(`  ${PASSWORD}  `));

    expect(context.repo.isAuthorized(PHONE_A)).toBe(true);
  });

  it('no trata la contraseña como texto para interpretar', async () => {
    const context = createTestContext();

    await handleMessage(context, textMessage(PASSWORD));

    expect(context.llm.calls).toHaveLength(0);
  });

  it('deja de contestar después de demasiados intentos fallidos', async () => {
    const context = createTestContext();

    for (let i = 0; i < 5; i += 1) {
      await handleMessage(context, textMessage(`intento ${i}`));
    }
    expect(context.kapso.sent).toHaveLength(5);

    // El sexto ya no recibe respuesta: no le damos un oráculo gratis.
    await handleMessage(context, textMessage('intento 6'));
    expect(context.kapso.sent).toHaveLength(5);
  });

  it('guarda el nombre de perfil al autorizar', async () => {
    const context = createTestContext();

    await handleMessage(context, {
      ...textMessage(PASSWORD),
      profileName: 'Papá',
    });

    expect(context.repo.displayNameFor(PHONE_A)).toBe('Papá');
  });
});
