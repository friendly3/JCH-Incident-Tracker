import type { SupabaseClient } from '@supabase/supabase-js';
import type { TeamLeader, Driver } from './team';
import { createDb } from '../supabase/queries';

let _teamLeaders = $state<TeamLeader[]>([]);
let _drivers = $state<Driver[]>([]);
let _isLoading = $state(false);
let _error = $state<string | null>(null);
let _db: ReturnType<typeof createDb> | null = null;

export const teamStore = {
	get teamLeaders() {
		return _teamLeaders;
	},
	get drivers() {
		return _drivers;
	},
	get isLoading() {
		return _isLoading;
	},
	get error() {
		return _error;
	},
	/** Initialize with server-loaded data and a supabase client for mutations */
	initFromServer(supabase: SupabaseClient, teamLeaders: TeamLeader[], drivers: Driver[]) {
		_db = createDb(supabase);
		_teamLeaders = teamLeaders;
		_drivers = drivers;
		_error = null;
	},
	/** Re-fetch from database (e.g. after mutation) */
	async reload(userId?: string) {
		if (!_db) return;
		_isLoading = true;
		_error = null;
		try {
			_teamLeaders = await _db.getTeamLeaders(userId);
			_drivers = await _db.getDrivers(userId);
		} catch (err) {
			_error = err instanceof Error ? err.message : 'Failed to reload team data';
			console.error('Error reloading team data:', err);
		} finally {
			_isLoading = false;
		}
	},
	async addTeamLeader(leader: TeamLeader, userId?: string) {
		if (!_db) return false;
		const success = await _db.addTeamLeader(leader, userId);
		if (success) {
			_teamLeaders = [..._teamLeaders, leader].sort((a, b) => a.name.localeCompare(b.name));
		}
		return success;
	},
	async updateTeamLeader(id: string, updated: TeamLeader) {
		if (!_db) return false;
		const success = await _db.updateTeamLeader(id, updated);
		if (success) {
			_teamLeaders = _teamLeaders
				.map((l) => (l.id === id ? updated : l))
				.sort((a, b) => a.name.localeCompare(b.name));
		}
		return success;
	},
	async deleteTeamLeader(id: string) {
		if (!_db) return false;
		const success = await _db.deleteTeamLeader(id);
		if (success) {
			_teamLeaders = _teamLeaders.filter((l) => l.id !== id);
		}
		return success;
	},
	async addDriver(driver: Driver, userId?: string) {
		if (!_db) return false;
		const success = await _db.addDriver(driver, userId);
		if (success) {
			_drivers = [..._drivers, driver].sort((a, b) => a.name.localeCompare(b.name));
		}
		return success;
	},
	async updateDriver(id: string, updated: Driver) {
		if (!_db) return false;
		const success = await _db.updateDriver(id, updated);
		if (success) {
			_drivers = _drivers
				.map((d) => (d.id === id ? updated : d))
				.sort((a, b) => a.name.localeCompare(b.name));
		}
		return success;
	},
	async deleteDriver(id: string) {
		if (!_db) return false;
		const success = await _db.deleteDriver(id);
		if (success) {
			_drivers = _drivers.filter((d) => d.id !== id);
		}
		return success;
	}
};
