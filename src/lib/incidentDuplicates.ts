import type { Incident } from '$lib/data/incidents';

/**
 * Incident ids that share a reference number with an older row (DUPE tag).
 * The earliest occurrence of each ref (by date received + time) is left untagged.
 * Blank / missing references are ignored.
 * Rows with {@link Incident.duplicateExempt} are never tagged (user untag override).
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
		// Skip index 0 (original); tag all later rows unless user exempted them
		for (let n = 1; n < group.length; n++) {
			const row = group[n];
			if (row.duplicateExempt) continue;
			ids.add(row.id);
		}
	}
	return ids;
}

/** True when another incident shares this reference number (case-insensitive). */
export function sharesReferenceWithOther(
	incident: Incident,
	incidents: readonly Incident[]
): boolean {
	const ref = incident.referenceNo?.trim().toUpperCase();
	if (!ref) return false;
	return incidents.some(
		(i) => i.id !== incident.id && (i.referenceNo?.trim().toUpperCase() ?? '') === ref
	);
}

/** Incidents that are not later duplicates of another row with the same reference. */
export function withoutDuplicateIncidents(incidents: readonly Incident[]): Incident[] {
	const dupeIds = getDuplicateIncidentIds(incidents);
	if (dupeIds.size === 0) return [...incidents];
	return incidents.filter((i) => !dupeIds.has(i.id));
}
