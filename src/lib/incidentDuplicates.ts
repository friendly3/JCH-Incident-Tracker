import type { Incident } from '$lib/data/incidents';

/**
 * Incident ids that share a reference number with an older row (DUPE tag).
 * The earliest occurrence of each ref (by date received + time) is left untagged.
 * Blank / missing references are ignored.
 * Rows with {@link Incident.duplicateExempt} are never tagged (user untag override).
 */
function receivedSortKey(incident: Incident): string {
	const date = (incident.dateReceived ?? '').trim();
	const time = (incident.time ?? '').trim();
	return `${date}T${time}`;
}

/** Normalize reference for grouping (trim, collapse space, case-fold). */
function referenceKey(referenceNo: string | undefined | null): string | null {
	const ref = referenceNo?.trim().replace(/\s+/g, ' ');
	if (!ref) return null;
	return ref.toUpperCase();
}

export function getDuplicateIncidentIds(incidents: readonly Incident[]): Set<string> {
	const byRef = new Map<string, Incident[]>();
	for (const i of incidents) {
		const key = referenceKey(i.referenceNo);
		if (!key) continue;
		const list = byRef.get(key);
		if (list) list.push(i);
		else byRef.set(key, [i]);
	}
	const ids = new Set<string>();
	for (const group of byRef.values()) {
		if (group.length < 2) continue;
		group.sort((a, b) => receivedSortKey(a).localeCompare(receivedSortKey(b)));
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
	const ref = referenceKey(incident.referenceNo);
	if (!ref) return false;
	return incidents.some(
		(i) => i.id !== incident.id && referenceKey(i.referenceNo) === ref
	);
}

/**
 * True when this row shares a reference with others and is not the earliest
 * occurrence (by date received + time). Only later rows can be tagged as duplicates.
 */
export function isLaterSameReferenceRow(
	incident: Incident,
	incidents: readonly Incident[]
): boolean {
	const ref = referenceKey(incident.referenceNo);
	if (!ref) return false;
	const group = incidents.filter((i) => referenceKey(i.referenceNo) === ref);
	if (group.length < 2) return false;
	group.sort((a, b) => receivedSortKey(a).localeCompare(receivedSortKey(b)));
	return group[0]?.id !== incident.id;
}

/** Incidents that are not later duplicates of another row with the same reference. */
export function withoutDuplicateIncidents(incidents: readonly Incident[]): Incident[] {
	const dupeIds = getDuplicateIncidentIds(incidents);
	if (dupeIds.size === 0) return [...incidents];
	return incidents.filter((i) => !dupeIds.has(i.id));
}
