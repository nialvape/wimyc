import { describe, expect, it } from 'vitest';

import { computeSignature, verifySignature } from '../src/webhook/signature.js';

const SECRET = 'un-secreto-de-prueba';

describe('verifySignature', () => {
  const body = Buffer.from(JSON.stringify({ hola: 'mundo' }));

  it('acepta una firma válida', () => {
    expect(verifySignature(body, computeSignature(body, SECRET), SECRET)).toBe(true);
  });

  it('acepta el prefijo sha256=', () => {
    expect(verifySignature(body, `sha256=${computeSignature(body, SECRET)}`, SECRET)).toBe(true);
  });

  it('rechaza una firma de otro secreto', () => {
    expect(verifySignature(body, computeSignature(body, 'otro'), SECRET)).toBe(false);
  });

  it('rechaza si el body cambió aunque sea un byte', () => {
    const signature = computeSignature(body, SECRET);
    expect(verifySignature(Buffer.from(JSON.stringify({ hola: 'Mundo' })), signature, SECRET)).toBe(
      false,
    );
  });

  it('rechaza cuando no viene el header', () => {
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
  });

  it('rechaza firmas de largo distinto sin explotar', () => {
    expect(verifySignature(body, 'abc', SECRET)).toBe(false);
  });

  it('la firma se calcula sobre los bytes crudos, no sobre el JSON reordenado', () => {
    // Mismo objeto, distinto orden de claves: firmas distintas.
    const a = Buffer.from('{"a":1,"b":2}');
    const b = Buffer.from('{"b":2,"a":1}');
    expect(computeSignature(a, SECRET)).not.toBe(computeSignature(b, SECRET));
  });
});
