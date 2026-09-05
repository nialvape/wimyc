import type { InboundMessage } from '../types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Normaliza el body de un webhook de Kapso a una lista de mensajes entrantes.
 *
 * Soporta las dos formas que manda la plataforma:
 *  - sin buffering: `{ message, conversation, phone_number_id }`
 *  - con buffering: `{ batch: true, data: [ ...lo de arriba... ] }`
 *
 * Descarta lo que no nos sirve (mensajes salientes, tipos que no manejamos con
 * datos incompletos) devolviendo menos elementos, nunca tirando una excepción:
 * un payload raro no puede tumbar el endpoint.
 */
export function parseWebhookBody(body: unknown): InboundMessage[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, any>;

  const entries: any[] = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.messages)
      ? root.messages
      : [root];

  const out: InboundMessage[] = [];
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseEntry(entry: any): InboundMessage | null {
  if (!entry || typeof entry !== 'object') return null;

  const message = entry.message ?? entry;
  if (!message || typeof message !== 'object') return null;

  const kapso = message.kapso ?? {};

  // Nunca contestarle a nuestros propios mensajes.
  if (kapso.direction && kapso.direction !== 'inbound') return null;

  const from = str(message.from) ?? str(entry.conversation?.phone_number);
  const waMessageId = str(message.id);
  if (!from || !waMessageId) return null;

  const base = {
    waMessageId,
    from,
    profileName: pickProfileName(entry, message),
    timestamp: parseTimestamp(message.timestamp),
    phoneNumberId: str(entry.phone_number_id) ?? str(message.phone_number_id),
    conversationId: str(entry.conversation?.id) ?? str(message.conversation_id),
  };

  switch (message.type) {
    case 'text': {
      const text = str(message.text?.body);
      if (!text) return null;
      return { ...base, kind: 'text', text };
    }

    case 'audio':
    case 'voice': {
      return {
        ...base,
        kind: 'audio',
        mediaId: str(message.audio?.id) ?? str(message.voice?.id),
        mediaUrl: str(kapso.media_url) ?? str(message.audio?.link),
        kapsoTranscript: str(kapso.transcript?.text),
      };
    }

    case 'location': {
      const lat = num(message.location?.latitude);
      const lng = num(message.location?.longitude);
      if (lat === null || lng === null) return null;
      return {
        ...base,
        kind: 'location',
        lat,
        lng,
        name: str(message.location?.name),
        address: str(message.location?.address),
      };
    }

    case 'interactive': {
      const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
      const buttonId = str(reply?.id);
      if (!buttonId) return null;
      return { ...base, kind: 'button', buttonId, buttonTitle: str(reply?.title) ?? '' };
    }

    // Formato viejo de Meta para botones de plantilla.
    case 'button': {
      const buttonId = str(message.button?.payload);
      if (!buttonId) return null;
      return { ...base, kind: 'button', buttonId, buttonTitle: str(message.button?.text) ?? '' };
    }

    default:
      return { ...base, kind: 'unsupported', waType: str(message.type) ?? 'unknown' };
  }
}

/** El nombre de perfil viaja en distintos lugares según el formato; probamos todos. */
function pickProfileName(entry: any, message: any): string | null {
  return (
    str(entry.contact?.profile?.name) ??
    str(entry.contacts?.[0]?.profile?.name) ??
    str(entry.conversation?.contact_name) ??
    str(entry.conversation?.username) ??
    str(message.kapso?.profile_name) ??
    str(message.profile?.name) ??
    null
  );
}

function parseTimestamp(value: unknown): Date {
  // WhatsApp manda epoch en segundos, como string.
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000);

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
