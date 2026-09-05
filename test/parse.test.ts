import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseWebhookBody } from '../src/webhook/parse.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', `${name}.json`), 'utf8'));

describe('parseWebhookBody', () => {
  it('normaliza un mensaje de texto', () => {
    const [message] = parseWebhookBody(fixture('text'));

    expect(message).toMatchObject({
      kind: 'text',
      waMessageId: 'wamid.TEXT001',
      from: '5491122334455',
      profileName: 'Joaco',
      text: 'dejé el auto en Cabildo 2200, cochera nivel 2',
      phoneNumberId: '123456789012345',
      conversationId: 'conv_123',
    });
    expect(message?.timestamp.getTime()).toBe(1730092800 * 1000);
  });

  it('normaliza un audio con media_url y transcripción de Kapso', () => {
    const [message] = parseWebhookBody(fixture('audio'));

    expect(message).toMatchObject({
      kind: 'audio',
      mediaId: 'media_id_456',
      mediaUrl: 'https://api.kapso.ai/media/abc123.ogg',
      kapsoTranscript: 'dejé el auto en cabilo dos mil doscientos',
    });
  });

  it('normaliza un pin de ubicación', () => {
    const [message] = parseWebhookBody(fixture('location'));

    expect(message).toMatchObject({
      kind: 'location',
      lat: -34.5627,
      lng: -58.4583,
      name: 'Av. Cabildo 2200',
    });
  });

  it('normaliza la respuesta de un botón', () => {
    const [message] = parseWebhookBody(fixture('button'));

    expect(message).toMatchObject({ kind: 'button', buttonId: 'confirm:1', buttonTitle: 'Confirmar' });
  });

  it('desarma un batch en varios mensajes', () => {
    const parsed = parseWebhookBody(fixture('batch'));

    expect(parsed).toHaveLength(2);
    expect(parsed.map((message) => message.from)).toEqual(['5491122334455', '5491199887766']);
  });

  it('ignora nuestros propios mensajes salientes', () => {
    expect(parseWebhookBody(fixture('outbound'))).toHaveLength(0);
  });

  it('marca como unsupported los tipos que no manejamos', () => {
    const parsed = parseWebhookBody({
      message: { id: 'wamid.X', type: 'image', from: '5491100000000', image: { id: 'a' } },
    });

    expect(parsed[0]).toMatchObject({ kind: 'unsupported', waType: 'image' });
  });

  it('no explota con payloads rotos', () => {
    expect(parseWebhookBody(null)).toEqual([]);
    expect(parseWebhookBody({})).toEqual([]);
    expect(parseWebhookBody({ data: [null, 'qué', 42] })).toEqual([]);
    expect(parseWebhookBody({ message: { type: 'text', text: { body: 'sin id ni from' } } })).toEqual([]);
  });
});
