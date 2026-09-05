import { describe, expect, it } from 'vitest';

import { describeParking, mapsUrl, relativeTime } from '../src/reply/format.js';

describe('relativeTime', () => {
  const now = new Date('2026-09-05T18:00:00Z');
  const ago = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);

  it.each([
    [0, 'recién'],
    [1, 'hace 1 min'],
    [12, 'hace 12 min'],
    [59, 'hace 59 min'],
    [60, 'hace 1 h'],
    [135, 'hace 2 h 15 min'],
    [1440, 'hace 1 día'],
    [4320, 'hace 3 días'],
  ])('%i minutos -> %s', (minutes, expected) => {
    expect(relativeTime(ago(minutes), now)).toBe(expected);
  });
});

describe('describeParking', () => {
  const empty = { description: null, level: null, spot: null, lat: null, lng: null };

  it('usa la descripción sola', () => {
    expect(describeParking({ ...empty, description: 'Cabildo 2200' })).toBe('Cabildo 2200');
  });

  it('agrega nivel y lugar entre paréntesis', () => {
    expect(describeParking({ ...empty, description: 'Cabildo 2200', level: '2', spot: '47' })).toBe(
      'Cabildo 2200 (nivel 2, lugar 47)',
    );
  });

  it('no repite la etiqueta si el LLM ya la mandó adentro del campo', () => {
    expect(describeParking({ ...empty, description: 'el shopping', level: 'nivel -1' })).toBe(
      'el shopping (nivel -1)',
    );
  });

  it('se banca no tener descripción', () => {
    expect(describeParking({ ...empty, level: '3' })).toBe('Nivel 3');
    expect(describeParking({ ...empty, lat: -34.5, lng: -58.4 })).toBe('la ubicación que me pasaste');
    expect(describeParking(empty)).toBe('donde me dijiste');
  });
});

describe('mapsUrl', () => {
  it('arma el link de Google Maps', () => {
    expect(mapsUrl(-34.5627, -58.4583)).toBe('https://www.google.com/maps?q=-34.5627,-58.4583');
  });
});
