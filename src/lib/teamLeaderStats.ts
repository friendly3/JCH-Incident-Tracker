import type { Incident } from '$lib/data/incidents';

export type TeamLeaderStatsBucket =
	| { kind: 'unassigned' }
	| { kind: 'leader'; key: string; label: string };

/** Case-fold and collapse punctuation: "Caringbah PDC" → "CARINGBAH PDC". */
function foldName(raw: string | undefined | null): string {
	return (raw ?? '')
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Map a Responded By value onto the official dropdown name.
 * Matches exact spelling (ignoring case/spaces), not mailbox senders.
 * "CaringbahPDC" and "Caringbah PDC" are the same option;
 * "Caringbah Cust Exp" is not CaringbahPDC.
 */
export function matchOfficialRespondedBy(
	raw: string | undefined | null,
	officialNames: readonly string[]
): string | null {
	const folded = foldName(raw);
	if (!folded) return null;
	const compact = folded.replace(/\s+/g, '');

	const officials = officialNames
		.map((name) => ({ name: name.trim(), folded: foldName(name) }))
		.filter((o) => o.folded);

	const exact = officials.find((o) => o.folded === folded);
	if (exact) return exact.name;

	const byCompact = officials.find((o) => o.folded.replace(/\s+/g, '') === compact);
	return byCompact?.name ?? null;
}

export function canonicalLeaderLabel(
	raw: string,
	officialNames: readonly string[] = []
): string {
	const trimmed = raw.trim();
	return matchOfficialRespondedBy(trimmed, officialNames) ?? trimmed;
}

/**
 * Stats by Team Leader is Responded By only — same rule that makes CaringbahPDC
 * tally correctly. Blank Responded By → Unassigned. NEW is not counted here
 * (the table only splits Ongoing vs Resolved).
 */
export function teamLeaderStatsBucket(
	incident: Incident,
	officialNames: readonly string[] = []
): TeamLeaderStatsBucket {
	const response = (incident.response ?? '').trim();
	if (!response) return { kind: 'unassigned' };

	const label = canonicalLeaderLabel(response, officialNames);
	return { kind: 'leader', key: label.toUpperCase(), label };
}

/** List / drill-down: same Responded By identity as the stats table. */
export function incidentMatchesTeamLeaderFilter(
	incident: Incident,
	filter: string,
	officialNames: readonly string[] = []
): boolean {
	const want = filter.trim();
	if (!want) return true;

	const bucket = teamLeaderStatsBucket(incident, officialNames);
	if (bucket.kind === 'unassigned') return false;

	return bucket.key === canonicalLeaderLabel(want, officialNames).toUpperCase();
}
