import { describe, expect, it } from 'vitest';

import { CITY_HINT, STT_PROMPT } from '../src/places.js';
import { interpret } from '../src/pipeline/interpret.js';
import { ScriptedLlm } from './helpers.js';

describe('contexto geográfico', () => {
  it('a Whisper sólo le damos la pista del acento', () => {
    // Sesgar la transcripción con una lista de calles pisa lo que el usuario
    // realmente dijo. Corregir nombres es trabajo del LLM, que tiene contexto.
    expect(STT_PROMPT).toContain('rioplatense');
    expect(STT_PROMPT.length).toBeLessThan(80);
  });

  it('el system prompt del LLM le dice que las calles son de CABA', async () => {
    const llm = new ScriptedLlm().push({ intent: 'save', description: 'Cabildo 2200' });

    await interpret(llm, 'lo dejé en cabilo dos mil doscientos', {
      hasActive: false,
      activeDescription: null,
      fromAudio: true,
    });

    const systemPrompt = llm.calls[0]!.find((message) => message.role === 'system')!.content;
    expect(systemPrompt).toContain(CITY_HINT);
    expect(systemPrompt).toContain('CABA');
  });
});
