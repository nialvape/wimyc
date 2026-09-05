import type { ParkingRow } from '../db/repo.js';

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/**
 * "recién", "hace 12 min", "hace 2 h 15 min", "hace 3 días".
 * Sin librerías: los tramos que nos importan son minutos, horas y días.
 */
export function relativeTime(from: Date, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60_000);

  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `hace ${hours} h` : `hace ${hours} h ${rest} min`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

/** Arma la descripción legible de un estacionamiento a partir de sus campos. */
export function describeParking(parking: Pick<ParkingRow, 'description' | 'level' | 'spot' | 'lat' | 'lng'>): string {
  const detail = [
    parking.level ? `nivel ${stripLabel(parking.level, 'nivel')}` : null,
    parking.spot ? `lugar ${stripLabel(parking.spot, 'lugar')}` : null,
  ].filter((part): part is string => part !== null);

  const base = parking.description?.trim();

  if (base && detail.length > 0) return `${base} (${detail.join(', ')})`;
  if (base) return base;
  if (detail.length > 0) return capitalize(detail.join(', '));
  if (parking.lat !== null && parking.lng !== null) return 'la ubicación que me pasaste';
  return 'donde me dijiste';
}

/** Evita "nivel nivel 2" cuando el LLM ya devolvió la etiqueta en el campo. */
function stripLabel(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(label.toLowerCase())) return trimmed;
  return trimmed.slice(label.length).trim() || trimmed;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
