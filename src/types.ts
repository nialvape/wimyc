/** Un mensaje entrante ya normalizado, sin las formas raras del payload de Kapso. */
export interface InboundBase {
  waMessageId: string;
  /** Teléfono del remitente, tal como lo manda WhatsApp (sin `+`). */
  from: string;
  profileName: string | null;
  timestamp: Date;
  phoneNumberId: string | null;
  conversationId: string | null;
}

export type InboundMessage =
  | (InboundBase & { kind: 'text'; text: string })
  | (InboundBase & {
      kind: 'audio';
      mediaId: string | null;
      /** Kapso a veces espeja el audio en su CDN y adjunta la URL directa. */
      mediaUrl: string | null;
      /** Kapso a veces ya transcribió el audio; lo usamos sólo si Groq falla. */
      kapsoTranscript: string | null;
    })
  | (InboundBase & {
      kind: 'location';
      lat: number;
      lng: number;
      name: string | null;
      address: string | null;
    })
  | (InboundBase & { kind: 'button'; buttonId: string; buttonTitle: string })
  | (InboundBase & { kind: 'unsupported'; waType: string });

export type InboundKind = InboundMessage['kind'];
