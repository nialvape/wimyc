import type { Db } from './index.js';

export type ParkingStatus = 'pending' | 'active' | 'archived' | 'discarded';
export type ParkingSource = 'text' | 'audio' | 'location';

export interface ParkingRow {
  id: number;
  status: ParkingStatus;
  description: string | null;
  level: string | null;
  spot: string | null;
  lat: number | null;
  lng: number | null;
  source: ParkingSource;
  transcript: string | null;
  created_by_phone: string;
  created_by_name: string | null;
  wa_message_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  archived_at: string | null;
}

export interface NewParking {
  status: Extract<ParkingStatus, 'pending' | 'active'>;
  description?: string | null;
  level?: string | null;
  spot?: string | null;
  lat?: number | null;
  lng?: number | null;
  source: ParkingSource;
  transcript?: string | null;
  createdByPhone: string;
  createdByName?: string | null;
  waMessageId?: string | null;
}

const nowIso = (): string => new Date().toISOString();

export class Repo {
  constructor(private readonly db: Db) {}

  /* ── Acceso ──────────────────────────────────────────────────────────── */

  isAuthorized(phone: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM authorized_phones WHERE wa_phone = ?')
      .get(phone);
    return row !== undefined;
  }

  authorize(phone: string, displayName: string | null): void {
    this.db
      .prepare(
        `INSERT INTO authorized_phones (wa_phone, display_name, authorized_at)
         VALUES (?, ?, ?)
         ON CONFLICT(wa_phone) DO UPDATE SET display_name = COALESCE(excluded.display_name, display_name)`,
      )
      .run(phone, displayName, nowIso());
  }

  /** Refresca el nombre de perfil si WhatsApp nos manda uno nuevo. */
  touchDisplayName(phone: string, displayName: string | null): void {
    if (!displayName) return;
    this.db
      .prepare('UPDATE authorized_phones SET display_name = ? WHERE wa_phone = ?')
      .run(displayName, phone);
  }

  displayNameFor(phone: string): string | null {
    const row = this.db
      .prepare('SELECT display_name FROM authorized_phones WHERE wa_phone = ?')
      .get(phone) as { display_name: string | null } | undefined;
    return row?.display_name ?? null;
  }

  /* ── Idempotencia ────────────────────────────────────────────────────── */

  /** `true` si es la primera vez que vemos esta key. Reintentos de Kapso dan `false`. */
  markProcessed(key: string): boolean {
    const result = this.db
      .prepare('INSERT OR IGNORE INTO processed_events (key, processed_at) VALUES (?, ?)')
      .run(key, nowIso());
    return result.changes > 0;
  }

  pruneProcessedEvents(olderThanDays = 7): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    return this.db.prepare('DELETE FROM processed_events WHERE processed_at < ?').run(cutoff)
      .changes;
  }

  /* ── Estacionamientos ────────────────────────────────────────────────── */

  activeParking(): ParkingRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM parkings WHERE status = 'active' ORDER BY id DESC LIMIT 1`)
        .get() as ParkingRow | undefined) ?? null
    );
  }

  pendingParking(): ParkingRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM parkings WHERE status = 'pending' ORDER BY id DESC LIMIT 1`)
        .get() as ParkingRow | undefined) ?? null
    );
  }

  findParking(id: number): ParkingRow | null {
    return (
      (this.db.prepare('SELECT * FROM parkings WHERE id = ?').get(id) as ParkingRow | undefined) ??
      null
    );
  }

  private insert(parking: NewParking): number {
    const result = this.db
      .prepare(
        `INSERT INTO parkings
           (status, description, level, spot, lat, lng, source, transcript,
            created_by_phone, created_by_name, wa_message_id, created_at, confirmed_at)
         VALUES (@status, @description, @level, @spot, @lat, @lng, @source, @transcript,
                 @createdByPhone, @createdByName, @waMessageId, @createdAt, @confirmedAt)`,
      )
      .run({
        status: parking.status,
        description: parking.description ?? null,
        level: parking.level ?? null,
        spot: parking.spot ?? null,
        lat: parking.lat ?? null,
        lng: parking.lng ?? null,
        source: parking.source,
        transcript: parking.transcript ?? null,
        createdByPhone: parking.createdByPhone,
        createdByName: parking.createdByName ?? null,
        waMessageId: parking.waMessageId ?? null,
        createdAt: nowIso(),
        confirmedAt: parking.status === 'active' ? nowIso() : null,
      });
    return Number(result.lastInsertRowid);
  }

  /**
   * Guarda un estacionamiento y lo deja activo, archivando el anterior.
   * Todo en una transacción: nunca puede quedar la base con dos activos ni con
   * el viejo archivado y el nuevo sin insertar.
   */
  saveActive(parking: Omit<NewParking, 'status'>): ParkingRow {
    const run = this.db.transaction((input: Omit<NewParking, 'status'>): number => {
      this.archiveAllActive();
      this.discardAllPending();
      return this.insert({ ...input, status: 'active' });
    });
    const id = run(parking);
    return this.findParking(id)!;
  }

  /** Guarda un estacionamiento a la espera de que el usuario toque "Confirmar". */
  savePending(parking: Omit<NewParking, 'status'>): ParkingRow {
    const run = this.db.transaction((input: Omit<NewParking, 'status'>): number => {
      // Un audio nuevo pisa la confirmación anterior sin avisar.
      this.discardAllPending();
      return this.insert({ ...input, status: 'pending' });
    });
    const id = run(parking);
    return this.findParking(id)!;
  }

  /** Pasa un pending a activo. Devuelve `null` si ya no estaba pendiente. */
  confirmPending(id: number): ParkingRow | null {
    const run = this.db.transaction((parkingId: number): boolean => {
      const row = this.db
        .prepare(`SELECT id FROM parkings WHERE id = ? AND status = 'pending'`)
        .get(parkingId);
      if (!row) return false;

      this.archiveAllActive();
      this.db
        .prepare(`UPDATE parkings SET status = 'active', confirmed_at = ? WHERE id = ?`)
        .run(nowIso(), parkingId);
      return true;
    });
    return run(id) ? this.findParking(id) : null;
  }

  /** Descarta un pending. Devuelve `false` si ya no estaba pendiente. */
  discardPending(id: number): boolean {
    return (
      this.db
        .prepare(`UPDATE parkings SET status = 'discarded' WHERE id = ? AND status = 'pending'`)
        .run(id).changes > 0
    );
  }

  /** "Ya lo saqué": archiva el activo. Devuelve el que archivó, o `null`. */
  clearActive(): ParkingRow | null {
    const current = this.activeParking();
    if (!current) return null;
    this.archiveAllActive();
    return this.findParking(current.id);
  }

  private archiveAllActive(): void {
    this.db
      .prepare(`UPDATE parkings SET status = 'archived', archived_at = ? WHERE status = 'active'`)
      .run(nowIso());
  }

  private discardAllPending(): void {
    this.db.prepare(`UPDATE parkings SET status = 'discarded' WHERE status = 'pending'`).run();
  }
}
