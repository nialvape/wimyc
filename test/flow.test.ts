import { describe, expect, it } from 'vitest';

import { handleMessage } from '../src/pipeline/handle.js';
import { messages } from '../src/reply/messages.js';
import {
  ageParking,
  audioMessage,
  buttonMessage,
  createTestContext,
  locationMessage,
  PHONE_A,
  PHONE_B,
  textMessage,
} from './helpers.js';

const authorized = { authorized: [PHONE_A, PHONE_B] };

describe('guardar por texto', () => {
  it('guarda y confirma sin pedir confirmación', async () => {
    const context = createTestContext(authorized);
    context.llm.push({ intent: 'save', description: 'Cabildo 2200', level: '2' });

    await handleMessage(context, textMessage('dejé el auto en Cabildo 2200, nivel 2'));

    expect(context.kapso.last).toEqual({
      to: PHONE_A,
      body: '🚗 Anotado: Cabildo 2200 (nivel 2)',
    });
    expect(context.repo.activeParking()).toMatchObject({
      status: 'active',
      description: 'Cabildo 2200',
      source: 'text',
    });
  });

  it('el segundo guardado archiva el primero', async () => {
    const context = createTestContext(authorized);
    context.llm.push(
      { intent: 'save', description: 'Cabildo 2200' },
      { intent: 'save', description: 'Santa Fe 900' },
    );

    await handleMessage(context, textMessage('lo dejé en Cabildo 2200'));
    await handleMessage(context, textMessage('ahora en Santa Fe 900'));

    expect(context.repo.activeParking()?.description).toBe('Santa Fe 900');
  });
});

describe('guardar por ubicación', () => {
  it('guarda lat/lng y devuelve el link sin pasar por el LLM', async () => {
    const context = createTestContext(authorized);

    await handleMessage(context, locationMessage(-34.5627, -58.4583));

    expect(context.llm.calls).toHaveLength(0);
    expect(context.kapso.last?.body).toBe(
      '📍 Anotado: https://www.google.com/maps?q=-34.5627,-58.4583',
    );
    expect(context.repo.activeParking()).toMatchObject({
      lat: -34.5627,
      lng: -58.4583,
      source: 'location',
    });
  });
});

describe('guardar por audio', () => {
  it('transcribe, interpreta y pide confirmación con dos botones', async () => {
    const context = createTestContext(authorized);
    context.transcriber.set('dejé el auto en cabilo dos mil doscientos nivel dos');
    context.llm.push({ intent: 'save', description: 'Cabildo 2200', level: '2' });

    await handleMessage(context, audioMessage());

    expect(context.kapso.last?.body).toBe('Entendí: Cabildo 2200 (nivel 2).\n¿Está bien?');
    expect(context.kapso.last?.buttons).toEqual([
      { id: 'confirm:1', title: 'Confirmar' },
      { id: 'edit:1', title: 'Modificar' },
    ]);

    // Todavía no está activo: espera la confirmación.
    expect(context.repo.activeParking()).toBeNull();
    expect(context.repo.pendingParking()).toMatchObject({ status: 'pending', source: 'audio' });
  });

  it('guarda la transcripción cruda para poder debuggear', async () => {
    const context = createTestContext(authorized);
    context.transcriber.set('cabilo dos mil doscientos');
    context.llm.push({ intent: 'save', description: 'Cabildo 2200' });

    await handleMessage(context, audioMessage());

    expect(context.repo.pendingParking()?.transcript).toBe('cabilo dos mil doscientos');
  });

  it('cae a la transcripción de Kapso si Groq falla', async () => {
    const context = createTestContext(authorized);
    context.transcriber.set(new Error('groq caído'));
    context.llm.push({ intent: 'save', description: 'Cabildo 2200' });

    await handleMessage(context, {
      ...audioMessage(),
      kind: 'audio',
      mediaId: 'media_1',
      mediaUrl: null,
      kapsoTranscript: 'dejé el auto en cabildo',
    });

    expect(context.repo.pendingParking()).not.toBeNull();
  });

  it('avisa si no hay forma de transcribir', async () => {
    const context = createTestContext(authorized);
    context.transcriber.set(new Error('groq caído'));

    await handleMessage(context, audioMessage());

    expect(context.kapso.last?.body).toBe(messages.audioNotUnderstood);
    expect(context.llm.calls).toHaveLength(0);
  });

  it('consultar por audio no pide confirmación', async () => {
    const context = createTestContext(authorized);
    context.transcriber.set('che dónde está el auto');
    context.llm.push({ intent: 'query' });

    await handleMessage(context, audioMessage());

    expect(context.kapso.last?.buttons).toBeUndefined();
    expect(context.kapso.last?.body).toBe(messages.nothingSaved);
  });
});

describe('botones de confirmación', () => {
  async function withPending() {
    const context = createTestContext(authorized);
    context.transcriber.set('cabilo dos mil doscientos');
    context.llm.push({ intent: 'save', description: 'Cabildo 2200' });
    await handleMessage(context, audioMessage());
    return context;
  }

  it('Confirmar deja el estacionamiento activo, sin llamar al LLM', async () => {
    const context = await withPending();
    const llmCallsBefore = context.llm.calls.length;

    await handleMessage(context, buttonMessage('confirm:1'));

    expect(context.kapso.last?.body).toBe(messages.audioConfirmed);
    expect(context.repo.activeParking()?.description).toBe('Cabildo 2200');
    expect(context.llm.calls).toHaveLength(llmCallsBefore);
  });

  it('Modificar descarta el pendiente y deja intacto el activo anterior', async () => {
    const context = createTestContext(authorized);
    context.llm.push({ intent: 'save', description: 'Santa Fe 900' });
    await handleMessage(context, textMessage('lo dejé en Santa Fe 900'));

    context.transcriber.set('cabilo dos mil doscientos');
    context.llm.push({ intent: 'save', description: 'Cabildo 2200' });
    await handleMessage(context, audioMessage());

    await handleMessage(context, buttonMessage('edit:2'));

    expect(context.kapso.last?.body).toBe(messages.audioRejected);
    expect(context.repo.pendingParking()).toBeNull();
    expect(context.repo.activeParking()?.description).toBe('Santa Fe 900');
  });

  it('un audio nuevo pisa la confirmación anterior', async () => {
    const context = await withPending();
    context.llm.push({ intent: 'save', description: 'Santa Fe 900' });

    await handleMessage(context, audioMessage());

    expect(context.repo.findParking(1)?.status).toBe('discarded');
    expect(context.repo.pendingParking()?.description).toBe('Santa Fe 900');
  });

  it('confirmar dos veces no duplica nada', async () => {
    const context = await withPending();

    await handleMessage(context, buttonMessage('confirm:1'));
    await handleMessage(context, buttonMessage('confirm:1'));

    expect(context.kapso.last?.body).toBe(messages.confirmationGone);
    expect(context.repo.activeParking()?.id).toBe(1);
  });

  it('un pendiente vencido no se confirma', async () => {
    const context = await withPending();
    ageParking(context, 1, 31);

    await handleMessage(context, buttonMessage('confirm:1'));

    expect(context.kapso.last?.body).toBe(messages.confirmationExpired);
    expect(context.repo.activeParking()).toBeNull();
  });

  it('ignora un id de botón que no reconoce', async () => {
    const context = createTestContext(authorized);

    await handleMessage(context, buttonMessage('cualquier_cosa'));

    expect(context.kapso.last?.body).toBe(messages.couldNotUnderstand);
  });
});

describe('consultar', () => {
  it('otra persona ve lo que guardó el primero', async () => {
    const context = createTestContext(authorized);
    context.repo.authorize(PHONE_A, 'Papá');
    context.llm.push({ intent: 'save', description: 'Cabildo 2200' });

    await handleMessage(context, {
      ...textMessage('lo dejé en Cabildo 2200', PHONE_A),
      profileName: 'Papá',
    });

    context.llm.push({ intent: 'query' });
    await handleMessage(context, textMessage('dónde está el auto?', PHONE_B));

    expect(context.kapso.last?.to).toBe(PHONE_B);
    expect(context.kapso.last?.body).toBe('🚗 Cabildo 2200 — lo dejó Papá recién.');
  });

  it('a quien lo guardó le habla en segunda persona', async () => {
    const context = createTestContext(authorized);
    context.llm.push({ intent: 'save', description: 'Cabildo 2200' }, { intent: 'query' });

    await handleMessage(context, textMessage('lo dejé en Cabildo 2200'));
    await handleMessage(context, textMessage('dónde está?'));

    expect(context.kapso.last?.body).toBe('🚗 Cabildo 2200 — lo dejaste recién.');
  });

  it('adjunta el link de maps si hay coordenadas', async () => {
    const context = createTestContext(authorized);
    await handleMessage(context, locationMessage(-34.5627, -58.4583, PHONE_A, 'Cabildo 2200'));

    context.llm.push({ intent: 'query' });
    await handleMessage(context, textMessage('dónde está?', PHONE_B));

    expect(context.kapso.last?.body).toContain('https://www.google.com/maps?q=-34.5627,-58.4583');
  });

  it('avisa cuando no hay nada guardado', async () => {
    const context = createTestContext(authorized);
    context.llm.push({ intent: 'query' });

    await handleMessage(context, textMessage('dónde está el auto?'));

    expect(context.kapso.last?.body).toBe(messages.nothingSaved);
  });
});

describe('borrar', () => {
  it('archiva el activo', async () => {
    const context = createTestContext(authorized);
    context.llm.push({ intent: 'save', description: 'Cabildo 2200' }, { intent: 'clear' });

    await handleMessage(context, textMessage('lo dejé en Cabildo 2200'));
    await handleMessage(context, textMessage('ya lo saqué'));

    expect(context.kapso.last?.body).toBe(messages.cleared);
    expect(context.repo.activeParking()).toBeNull();
  });

  it('no miente si no había nada', async () => {
    const context = createTestContext(authorized);
    context.llm.push({ intent: 'clear' });

    await handleMessage(context, textMessage('ya lo saqué'));

    expect(context.kapso.last?.body).toBe(messages.nothingToClear);
  });
});

describe('errores', () => {
  it('avisa al usuario si el LLM se cae, sin tirar', async () => {
    const context = createTestContext(authorized);
    context.llm.push(new Error('groq 500'), new Error('groq 500'));

    await expect(handleMessage(context, textMessage('lo dejé en Cabildo'))).resolves.toBeUndefined();

    expect(context.kapso.last?.body).toBe(messages.processingError);
  });

  it('contesta a tipos de mensaje que no maneja', async () => {
    const context = createTestContext(authorized);

    await handleMessage(context, {
      ...textMessage('x'),
      kind: 'unsupported',
      waType: 'image',
    } as never);

    expect(context.kapso.last?.body).toBe(messages.unsupportedType);
  });
});
