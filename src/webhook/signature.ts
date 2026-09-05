import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Kapso firma el **raw body** con HMAC-SHA256 y lo manda en hex en el header
 * `X-Webhook-Signature`. Hay que verificar sobre los bytes crudos: reparsear y
 * volver a serializar el JSON cambia el orden y el espaciado, y la firma no da.
 */
export function computeSignature(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifySignature(
  rawBody: Buffer | string,
  headerValue: string | undefined,
  secret: string,
): boolean {
  if (!headerValue) return false;

  // Algunos proveedores prefijan el algoritmo; toleramos ambas formas.
  const received = headerValue.startsWith('sha256=') ? headerValue.slice(7) : headerValue;
  const expected = computeSignature(rawBody, secret);

  // timingSafeEqual explota si los largos difieren, así que lo chequeamos antes.
  if (received.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}
