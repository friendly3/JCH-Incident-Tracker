import type { Incident } from '$lib/data/incidents';

/**
 * Incident ids that share a reference number with an older row (DUPE tag).
 * The earliest occurrence of each ref (by date received + time) is left untagged.
 * Blank / missing references are ignored.
 */
export function getDuplicateIncidentIds(incidents: readonly Incident[]): Set<string> {
	const byRef = new Map<string, Incident[]>();
	for (const i of incidents) {
		const ref = i.referenceNo?.trim();
		if (!ref) continue;
		const key = ref.toUpperCase();
		const list = byRef.get(key);
		if (list) list.push(i);
		else byRef.set(key, [i]);
	}
	const ids = new Set<string>();
	for (const group of byRef.values()) {
		if (group.length < 2) continue;
		group.sort((a, b) =>
			`${a.dateReceived}T${a.time}`.localeCompare(`${b.dateReceived}T${b.time}`)
		);
		// Skip index 0 (original); tag all later rows
		for (let n = 1; n < group.length; n++) {
			ids.add(group[n].id);
		}
	}
	return ids;
}

/** Incidents that are not later duplicates of another row with the same reference. */
export function withoutDuplicateIncidents(incidents: readonly Incident[]): Incident[] {
	const dupeIds = getDuplicateIncidentIds(incidents);
	if (dupeIds.size === 0) return [...incidents];
	return incidents.filter((i) => !dupeIds.has(i.id));
}
