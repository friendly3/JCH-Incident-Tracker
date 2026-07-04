import type { SupabaseClient } from '@supabase/supabase-js';
import type { Incident } from './incidents';
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
	async add(incident: Incident, userId?: string) {
		if (!_db) return false;
		try {
			const success = await _db.addIncident(incident, userId);
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
	async update(id: string, updated: Incident) {
		if (!_db) return false;
		try {
			const success = await _db.updateIncident(id, updated);
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
	reset() {
		_incidents = [];
		_db = null;
		_initialized = false;
		_error = null;
		_isLoading = false;
	}
};
