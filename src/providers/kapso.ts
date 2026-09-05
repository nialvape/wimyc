import type { Config } from '../config.js';
import { ProviderError, readErrorBody } from './errors.js';

export interface Button {
  /** Máximo 256 caracteres. Le metemos el id del parking adentro. */
  id: string;
  /** WhatsApp corta a los 20 caracteres. */
  title: string;
}

/** Lo que el pipeline necesita para contestar. Permite mockearlo en tests. */
export interface Messenger {
  sendText(to: string, body: string): Promise<void>;
  sendButtons(to: string, body: string, buttons: Button[]): Promise<void>;
  downloadMedia(options: { mediaUrl?: string | null; mediaId?: string | null }): Promise<Buffer>;
}

const MAX_BUTTON_TITLE = 20;
const MAX_BODY_TEXT = 1024;

/** Cliente del proxy meta-compatible de Kapso. */
export class KapsoClient implements Messenger {
  private readonly messagesUrl: string;
  private readonly mediaBaseUrl: string;

  constructor(private readonly config: Config) {
    const base = config.KAPSO_BASE_URL.replace(/\/+$/, '');
    this.messagesUrl = `${base}/${config.GRAPH_API_VERSION}/${config.PHONE_NUMBER_ID}/messages`;
    this.mediaBaseUrl = `${base}/${config.GRAPH_API_VERSION}`;
  }

  async sendText(to: string, body: string): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: truncate(body, MAX_BODY_TEXT), preview_url: true },
    });
  }

  async sendButtons(to: string, body: string, buttons: Button[]): Promise<void> {
    if (buttons.length === 0 || buttons.length > 3) {
      throw new Error(`WhatsApp acepta entre 1 y 3 botones, recibí ${buttons.length}`);
    }

    await this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: truncate(body, MAX_BODY_TEXT) },
        action: {
          buttons: buttons.map((button) => ({
            type: 'reply',
            reply: { id: button.id, title: truncate(button.title, MAX_BUTTON_TITLE) },
          })),
        },
      },
    });
  }

  /**
   * Baja los bytes de un audio. Preferimos la URL que Kapso ya espejó; si no
   * vino, resolvemos el media id contra la API estilo Meta.
   */
  async downloadMedia(options: { mediaUrl?: string | null; mediaId?: string | null }): Promise<Buffer> {
    const url = options.mediaUrl ?? (options.mediaId ? await this.resolveMediaUrl(options.mediaId) : null);
    if (!url) throw new Error('el mensaje de audio no trae ni media_url ni media id');

    const response = await fetch(url, {
      headers: this.authHeadersFor(url),
      signal: AbortSignal.timeout(this.config.HTTP_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new ProviderError('kapso-media', response.status, await readErrorBody(response));
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async resolveMediaUrl(mediaId: string): Promise<string> {
    const response = await fetch(`${this.mediaBaseUrl}/${mediaId}`, {
      headers: { 'X-API-Key': this.config.KAPSO_API_KEY },
      signal: AbortSignal.timeout(this.config.HTTP_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new ProviderError('kapso-media', response.status, await readErrorBody(response));
    }

    const payload = (await response.json()) as { url?: string };
    if (!payload.url) throw new Error(`la respuesta del media ${mediaId} no trae url`);
    return payload.url;
  }

  /** El CDN público de WhatsApp rechaza los pedidos que llevan nuestra API key. */
  private authHeadersFor(url: string): Record<string, string> {
    try {
      const host = new URL(url).hostname;
      if (host.endsWith('kapso.ai')) return { 'X-API-Key': this.config.KAPSO_API_KEY };
    } catch {
      /* url rara: mejor no mandar la key */
    }
    return {};
  }

  private async post(body: unknown): Promise<void> {
    const response = await fetch(this.messagesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.KAPSO_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.HTTP_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new ProviderError('kapso', response.status, await readErrorBody(response));
    }
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
