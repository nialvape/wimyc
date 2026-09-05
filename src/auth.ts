import { createHash, timingSafeEqual } from 'node:crypto';

import type { Repo } from './db/repo.js';
import type { InboundMessage } from './types.js';

export type AuthResult =
  | { status: 'authorized' }
  | { status: 'just-authorized' }
  | { status: 'needs-password' }
  | { status: 'rate-limited' };

/**
 * Puerta de entrada. Corre **antes** de transcribir o de llamar al LLM: un
 * número desconocido no nos tiene que costar plata.
 */
export class AccessGate {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly repo: Repo,
    private readonly password: string,
    private readonly maxAttemptsPerHour: number,
  ) {}

  check(message: InboundMessage): AuthResult {
    if (this.repo.isAuthorized(message.from)) {
      this.repo.touchDisplayName(message.from, message.profileName);
      return { status: 'authorized' };
    }

    // Sólo un texto puede ser la contraseña. Un audio de un desconocido ni se
    // transcribe.
    if (message.kind === 'text' && matches(message.text.trim(), this.password)) {
      this.repo.authorize(message.from, message.profileName);
      this.attempts.delete(message.from);
      return { status: 'just-authorized' };
    }

    if (this.tooManyAttempts(message.from)) return { status: 'rate-limited' };
    return { status: 'needs-password' };
  }

  private tooManyAttempts(phone: string): boolean {
    const cutoff = Date.now() - 3_600_000;
    const recent = (this.attempts.get(phone) ?? []).filter((at) => at > cutoff);
    recent.push(Date.now());
    this.attempts.set(phone, recent);
    return recent.length > this.maxAttemptsPerHour;
  }
}

/**
 * Comparación de largo constante. Hasheamos primero para que `timingSafeEqual`
 * reciba buffers del mismo largo sin filtrar el largo de la contraseña.
 */
function matches(candidate: string, password: string): boolean {
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(password).digest();
  return timingSafeEqual(a, b);
}
