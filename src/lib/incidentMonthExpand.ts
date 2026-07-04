const STORAGE_KEY = 'incidents-expanded-months';

export function loadExpandedMonths(): string[] | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
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

/** Keep only keys present in current data; null means use default (most recent month). */
export function filterExpandedMonths(
	saved: string[] | null,
	validKeys: Set<string>
): Set<string> | null {
	if (!saved || saved.length === 0) return null;
	const filtered = saved.filter((k) => validKeys.has(k));
	if (filtered.length === 0) return null;
	return new Set(filtered);
}