import type { SupabaseClient } from '@supabase/supabase-js';
import type { Incident } from './incidents';
import {
	applyCoordUpdatesToList,
	type CoordPersistUpdate,
	withGeocodedLocation
} from '../geocodeIncidentCoords';
import { createDb } from '../supabase/queries';

let _incidents = $state<Incident[]>([]);
let _isLoading = $state(false);
let _error = $state<string | null>(null);
let _db: ReturnType<typeof createDb> | null = null;
let _initialized = false;

export const incidentStore = {
	get list() {
		return _incidents;
	},
	get isLoading() {
		return _isLoading;
	},
	get error() {
		return _error;
	},
	get isInitialized() {
		return _initialized;
	},
	/** @deprecated Use syncFromServer — delegates to avoid stale-init when already initialized */
	initFromServer(supabase: SupabaseClient, incidents: Incident[]) {
		this.syncFromServer(supabase, incidents);
	},
	/** Always sync both the client and incident list (used after invalidateAll) */
	syncFromServer(supabase: SupabaseClient, incidents: Incident[]) {
		_db = createDb(supabase);
		_incidents = incidents;
		_initialized = true;
		_error = null;
	},
	/** Re-fetch from database (e.g. after mutation) */
	async reload(userId?: string) {
		if (!_db) return;
		_isLoading = true;
		_error = null;
		try {
			_incidents = await _db.getIncidents(userId);
		} catch (err) {
			_error = err instanceof Error ? err.message : 'Failed to load incidents';
			console.error('Error loading incidents:', err);
		} finally {
			_isLoading = false;
		}
	},
	async add(
		incident: Incident,
		userId?: string,
		audit?: { userId?: string | null; userName?: string | null }
	) {
		if (!_db) return false;
		try {
			// Geocode once at write time so the map can plot without Nominatim on load
			const withCoords = await withGeocodedLocation(incident);
			const success = await _db.addIncident(withCoords, userId, audit);
			if (success) {
				// userId is for insert ownership only; main page shows all incidents
				await this.reload();
			}
			return success;
		} catch (err) {
			_error = err instanceof Error ? err.message : 'Failed to add incident';
			console.error('Error adding incident:', err);
			return false;
		}
	},
	clearError() {
		_error = null;
	},
	async update(
		id: string,
		updated: Incident,
		audit?: { userId?: string | null; userName?: string | null }
	) {
		if (!_db) return false;
		_error = null;
		try {
			const withCoords = await withGeocodedLocation(updated);
			const success = await _db.updateIncident(id, withCoords, audit);
			if (success) {
				await this.reload();
			}
			return success;
		} catch (err) {
			_error = err instanceof Error ? err.message : 'Failed to update incident';
			console.error('Error updating incident:', err);
			return false;
		}
	},
	async delete(id: string) {
		if (!_db) return false;
		const success = await _db.deleteIncident(id);
		if (success) {
			_incidents = _incidents.filter((i) => i.id !== id);
		}
		return success;
	},
	/**
	 * Write lat/lng for incidents that already have map text but no coords
	 * (e.g. first map visit after migration). Updates local list without full reload.
	 */
	async persistLocationCoords(updates: CoordPersistUpdate[]): Promise<number> {
		if (!_db || updates.length === 0) return 0;
		let saved = 0;
		const okUpdates: CoordPersistUpdate[] = [];
		// Modest concurrency so a large first-time backfill does not stall
		const chunkSize = 8;
		for (let i = 0; i < updates.length; i += chunkSize) {
			const chunk = updates.slice(i, i + chunkSize);
			const results = await Promise.all(
				chunk.map(async (u) => {
					const ok = await _db!.updateIncidentCoords(u.id, {
						locationLat: u.locationLat,
						locationLng: u.locationLng,
						locationPrecision: u.locationPrecision,
						locationGeocodedAt: u.locationGeocodedAt
					});
					return ok ? u : null;
				})
			);
			for (const u of results) {
				if (u) {
					saved += 1;
					okUpdates.push(u);
				}
			}
		}
		if (okUpdates.length > 0) {
			_incidents = applyCoordUpdatesToList(_incidents, okUpdates);
		}
		return saved;
	},
	reset() {
		_incidents = [];
		_db = null;
		_initialized = false;
		_error = null;
		_isLoading = false;
	}
};
