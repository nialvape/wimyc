import { describe, expect, it } from 'vitest';

import { CITY_HINT, STT_PROMPT } from '../src/places.js';
import { interpret } from '../src/pipeline/interpret.js';
import { ScriptedLlm, silentLogger } from './helpers.js';

describe('contexto geográfico', () => {
  it('a Whisper le damos acento, registro y dominio, no un diccionario', () => {
    expect(STT_PROMPT).toContain('rioplatense');
    expect(STT_PROMPT).toContain('Buenos Aires');

    // Enumerar calles concretas empuja a Whisper a escuchar esas calles aunque
    // el usuario haya dicho otra. Corregir nombres es trabajo del LLM.
    for (const street of ['Cabildo', 'Scalabrini', 'Corrientes', 'Rivadavia']) {
      expect(STT_PROMPT).not.toContain(street);
    }
    // Whisper corta el prompt en 224 tokens; esto deja margen de sobra.
    expect(STT_PROMPT.length).toBeLessThan(400);
  });

  it('el system prompt del LLM le dice que las calles son de CABA', async () => {
    const llm = new ScriptedLlm().push({ intent: 'save', description: 'Cabildo 2200' });

    await interpret(llm, 'lo dejé en cabilo dos mil doscientos', {
      hasActive: false,
      activeDescription: null,
      fromAudio: true,
      logger: silentLogger,
    });

    const systemPrompt = llm.calls[0]!.find((message) => message.role === 'system')!.content;
    expect(systemPrompt).toContain(CITY_HINT);
    expect(systemPrompt).toContain('CABA');
  });
});
