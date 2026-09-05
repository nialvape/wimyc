import type { ParkingRow } from '../db/repo.js';
import { describeParking, mapsUrl, relativeTime } from './format.js';

/**
 * Todos los textos que ve el usuario viven acá. Castellano rioplatense, corto
 * y seco. Ninguno de estos pasa por el LLM: son templates.
 */
export const messages = {
  /* ── Acceso ───────────────────────────────────────────────────────────── */

  askPassword: 'Para usar WIMYC mandame la contraseña.',

  welcome:
    'Listo, ya estás dentro. 🚗\n\n' +
    'Contame dónde dejás el auto —por texto, audio o pasándome la ubicación— y lo anoto. ' +
    'Después preguntame dónde está.',

  /* ── Guardado ─────────────────────────────────────────────────────────── */

  saved(parking: ParkingRow): string {
    return `🚗 Anotado: ${describeParking(parking)}`;
  },

  savedLocation(parking: ParkingRow): string {
    const link = parking.lat !== null && parking.lng !== null ? mapsUrl(parking.lat, parking.lng) : '';
    return `📍 Anotado: ${link}`;
  },

  /* ── Confirmación de audio (todo hardcodeado, sin LLM) ────────────────── */

  confirmAudio(description: string): string {
    return `Entendí: ${description}.\n¿Está bien?`;
  },

  confirmButtonTitle: 'Confirmar',
  editButtonTitle: 'Modificar',

  audioConfirmed: '🚗 Anotado.',
  audioRejected: 'Dale, mandame de nuevo dónde lo dejaste.',
  confirmationExpired: 'Esa confirmación ya venció, mandámelo de nuevo.',
  confirmationGone: 'Esa confirmación ya no está vigente.',

  /* ── Consulta ─────────────────────────────────────────────────────────── */

  whereIsIt(parking: ParkingRow, options: { askedBySamePerson: boolean; now?: Date }): string {
    const when = relativeTime(new Date(parking.created_at), options.now);
    const who = options.askedBySamePerson
      ? 'lo dejaste'
      : parking.created_by_name
        ? `lo dejó ${parking.created_by_name}`
        : 'lo dejaron';

    let text = `🚗 ${describeParking(parking)} — ${who} ${when}.`;
    if (parking.lat !== null && parking.lng !== null) {
      text += `\n${mapsUrl(parking.lat, parking.lng)}`;
    }
    return text;
  },

  nothingSaved: 'No tengo ningún auto guardado.',

  /* ── Borrado ──────────────────────────────────────────────────────────── */

  cleared: 'Listo, borré la ubicación. 👋',
  nothingToClear: 'No tenía nada guardado igual.',

  /* ── Ayuda y errores ──────────────────────────────────────────────────── */

  help:
    'Soy WIMYC, me acuerdo dónde quedó el auto.\n\n' +
    '• Decime dónde lo dejaste (texto, audio o ubicación) y lo anoto.\n' +
    '• Preguntame "¿dónde está el auto?" y te digo.\n' +
    '• Decime "ya lo saqué" y me lo olvido.',

  audioNotUnderstood: 'No pude escuchar bien el audio, ¿me lo escribís?',
  couldNotUnderstand: 'No te entendí. Decime dónde dejaste el auto, o preguntame dónde está.',
  unsupportedType: 'Por ahora entiendo texto, audios y ubicaciones.',
  processingError: 'Se me complicó procesar eso, probá de nuevo en un momento.',
} as const;
