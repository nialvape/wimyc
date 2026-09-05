import { describe, expect, it } from 'vitest';

import { interpret } from '../src/pipeline/interpret.js';
import type { ChatProvider } from '../src/providers/llm.js';
import { ScriptedLlm } from './helpers.js';

const ctx = { hasActive: false, activeDescription: null, fromAudio: false };

/** Proveedor que devuelve texto crudo, para probar el parseo defensivo. */
function raw(...responses: string[]): ChatProvider {
  let index = 0;
  return {
    name: 'raw',
    async chatJson() {
      return responses[Math.min(index++, responses.length - 1)]!;
    },
  };
}

describe('interpret', () => {
  it('valida y devuelve la interpretación', async () => {
    const llm = new ScriptedLlm().push({
      intent: 'save',
      description: 'Cabildo 2200',
      level: '2',
      confidence: 0.9,
    });

    expect(await interpret(llm, 'dejé el auto en Cabildo 2200 nivel 2', ctx)).toEqual({
      intent: 'save',
      description: 'Cabildo 2200',
      level: '2',
      spot: null,
      confidence: 0.9,
    });
  });

  it('desenvuelve el JSON si viene en un bloque de código', async () => {
    const provider = raw('```json\n{"intent":"query","description":null,"level":null,"spot":null,"confidence":1}\n```');

    expect((await interpret(provider, 'dónde está?', ctx)).intent).toBe('query');
  });

  it('rescata el JSON si el modelo agrega texto alrededor', async () => {
    const provider = raw('Claro: {"intent":"clear","description":null,"level":null,"spot":null,"confidence":1} listo');

    expect((await interpret(provider, 'ya lo saqué', ctx)).intent).toBe('clear');
  });

  it('reintenta una vez y después devuelve unknown en vez de explotar', async () => {
    const provider = raw('esto no es json');

    expect(await interpret(provider, 'cualquier cosa', ctx)).toEqual({
      intent: 'unknown',
      description: null,
      level: null,
      spot: null,
      confidence: 0,
    });
  });

  it('sobrevive a un error transitorio del proveedor', async () => {
    // Groq tira 400 json_validate_failed cada tanto; al segundo intento sale.
    const llm = new ScriptedLlm().push(new Error('groq 400 json_validate_failed'), {
      intent: 'save',
      description: 'Cabildo 2200',
    });

    expect((await interpret(llm, 'lo dejé en cabilo 2200', ctx)).description).toBe('Cabildo 2200');
    expect(llm.calls).toHaveLength(2);
  });

  it('tira si el proveedor falla en los dos intentos', async () => {
    // Que el servicio esté caído no es lo mismo que "no te entendí": el
    // usuario tiene que recibir el mensaje de error, no uno de incomprensión.
    const llm = new ScriptedLlm().push(new Error('groq 500'), new Error('groq 500'));

    await expect(interpret(llm, 'lo dejé en cabilo 2200', ctx)).rejects.toThrow('groq 500');
  });

  it('devuelve unknown si el intent no es uno de los nuestros', async () => {
    const provider = raw('{"intent":"borrar_todo","description":null,"level":null,"spot":null,"confidence":1}');

    expect((await interpret(provider, 'x', ctx)).intent).toBe('unknown');
  });

  it('le pasa al modelo el estado actual y el origen del texto', async () => {
    const llm = new ScriptedLlm().push({ intent: 'save' });

    await interpret(llm, 'en la esquina', {
      hasActive: true,
      activeDescription: 'Cabildo 2200',
      fromAudio: true,
    });

    const prompt = llm.calls[0]!.at(-1)!.content;
    expect(prompt).toContain('Cabildo 2200');
    expect(prompt).toContain('nota de voz');
  });
});
