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

export type TeamLeaderResolution = 'ongoing' | 'resolved' | 'new';

/**
 * Ongoing = action ONGOING.
 * New is excluded from Ongoing and Resolved columns but counted in Total.
 * Resolved = any other status (including blank).
 */
export function classifyTeamLeaderResolution(
	action: string | undefined | null
): TeamLeaderResolution {
	const a = (action ?? '').trim().toUpperCase();
	if (a === 'ONGOING') return 'ongoing';
	if (a === 'NEW') return 'new';
	return 'resolved';
}

export type TeamLeaderStatCounts = { ongoing: number; resolved: number; newCount: number };

export type TeamLeaderStatRow = TeamLeaderStatCounts & {
	key: string;
	label: string;
	ongoingPct: number;
	resolvedPct: number;
	total: number;
};

export type TeamLeaderStatsResult = {
	rows: TeamLeaderStatRow[];
	unassignedOngoing: number;
	unassignedResolved: number;
	unassignedNew: number;
	unassignedOngoingPct: number;
	unassignedResolvedPct: number;
	/** All blank Responded By in the period, including New. */
	unassignedTotal: number;
	totalOngoing: number;
	totalResolved: number;
	/** Equals incidents.length: every period incident is in exactly one row. */
	grandTotal: number;
};

function emptyCounts(): TeamLeaderStatCounts {
	return { ongoing: 0, resolved: 0, newCount: 0 };
}

function addResolution(counts: TeamLeaderStatCounts, resolution: TeamLeaderResolution): void {
	if (resolution === 'ongoing') counts.ongoing += 1;
	else if (resolution === 'resolved') counts.resolved += 1;
	else counts.newCount += 1;
}

function withPercents(counts: TeamLeaderStatCounts): {
	ongoingPct: number;
	resolvedPct: number;
	total: number;
} {
	const openClosed = counts.ongoing + counts.resolved;
	return {
		total: openClosed + counts.newCount,
		ongoingPct: openClosed > 0 ? (counts.ongoing / openClosed) * 100 : 0,
		resolvedPct: openClosed > 0 ? (counts.resolved / openClosed) * 100 : 0
	};
}

/** Tally period incidents: named leaders + Unassigned, same Ongoing/Resolved/Total rules. */
export function buildTeamLeaderStats(
	incidents: readonly Incident[],
	officialNames: readonly string[] = []
): TeamLeaderStatsResult {
	const byLeader = new Map<string, { key: string; label: string } & TeamLeaderStatCounts>();
	for (const name of officialNames) {
		const label = canonicalLeaderLabel(name, officialNames);
		const key = label.toUpperCase();
		if (!byLeader.has(key)) {
			byLeader.set(key, { key, label, ...emptyCounts() });
		}
	}

	const unassigned = emptyCounts();

	for (const incident of incidents) {
		const resolution = classifyTeamLeaderResolution(incident.action);
		const bucket = teamLeaderStatsBucket(incident, officialNames);
		if (bucket.kind === 'unassigned') {
			addResolution(unassigned, resolution);
			continue;
		}

		let row = byLeader.get(bucket.key);
		if (!row) {
			row = { key: bucket.key, label: bucket.label, ...emptyCounts() };
			byLeader.set(bucket.key, row);
		}
		addResolution(row, resolution);
	}

	const rows = [...byLeader.values()]
		.sort((a, b) => {
			if (b.ongoing !== a.ongoing) return b.ongoing - a.ongoing;
			if (b.resolved !== a.resolved) return b.resolved - a.resolved;
			return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
		})
		.map((row) => ({
			key: row.key,
			label: row.label,
			ongoing: row.ongoing,
			resolved: row.resolved,
			newCount: row.newCount,
			...withPercents(row)
		}));

	const unassignedPct = withPercents(unassigned);
	const totalOngoing = rows.reduce((sum, row) => sum + row.ongoing, 0) + unassigned.ongoing;
	const totalResolved = rows.reduce((sum, row) => sum + row.resolved, 0) + unassigned.resolved;

	return {
		rows,
		unassignedOngoing: unassigned.ongoing,
		unassignedResolved: unassigned.resolved,
		unassignedNew: unassigned.newCount,
		unassignedOngoingPct: unassignedPct.ongoingPct,
		unassignedResolvedPct: unassignedPct.resolvedPct,
		unassignedTotal: unassignedPct.total,
		totalOngoing,
		totalResolved,
		grandTotal: rows.reduce((sum, row) => sum + row.total, 0) + unassignedPct.total
	};
}

/**
 * Stats by Team Leader is Responded By only — same rule that makes CaringbahPDC
 * tally correctly. Blank Responded By → Unassigned.
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
