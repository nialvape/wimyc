/**
 * Cola en memoria que serializa el trabajo por clave (usamos el teléfono).
 *
 * Dos mensajes seguidos del mismo número se procesan en orden, así no puede
 * pasar que el "confirmar" gane la carrera contra el audio que lo generó.
 * Mensajes de números distintos corren en paralelo.
 */
export class SerialQueue {
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly onError: (error: unknown, key: string) => void) {}

  push(key: string, task: () => Promise<void>): void {
    const previous = this.chains.get(key) ?? Promise.resolve();

    const next = previous
      .then(task)
      .catch((error: unknown) => {
        this.onError(error, key);
      })
      .finally(() => {
        // Sólo limpiamos si nadie encoló algo nuevo mientras corríamos.
        if (this.chains.get(key) === next) this.chains.delete(key);
      });

    this.chains.set(key, next);
  }

  /** Espera a que se vacíe la cola. Para tests y para un shutdown prolijo. */
  async drain(): Promise<void> {
    while (this.chains.size > 0) {
      await Promise.allSettled([...this.chains.values()]);
    }
  }

  get pending(): number {
    return this.chains.size;
  }
}
