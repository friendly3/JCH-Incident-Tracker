const STORAGE_KEY = 'incidents-expanded-months';

/**
 * Load persisted expanded month keys.
 * - `null` = no preference stored → UI uses default (most recent month expanded)
 * - `[]` = user explicitly collapsed all months
 * - non-empty array = those months expanded
 */
export function loadExpandedMonths(): string[] | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		// Missing key only — empty JSON array is a deliberate "all collapsed" preference
		if (raw === null) return null;
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.every((k) => typeof k === 'string')) {
			return parsed;
		}
	} catch {
		// ignore invalid storage
	}
	return null;
}

export function saveExpandedMonths(keys: Iterable<string>): void {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
	} catch {
		// ignore storage write failures (quota, private browsing, disabled storage)
	}
}

/**
 * Keep only keys present in current data.
 * - `null` when `saved` is null (no preference → default most-recent)
 * - empty Set when user collapsed everything or saved keys no longer exist
 */
export function filterExpandedMonths(
	saved: string[] | null,
	validKeys: Set<string>
): Set<string> | null {
	if (saved === null) return null;
	const filtered = saved.filter((k) => validKeys.has(k));
	return new Set(filtered);
}