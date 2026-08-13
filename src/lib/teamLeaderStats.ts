import type { Incident } from '$lib/data/incidents';

export type TeamLeaderStatsBucket =
	| { kind: 'unassigned' }
	| {
			kind: 'leader';
			key: string;
			label: string;
			/** `response` = Responded By was set; `fallback` = facility mailbox / team name only. */
			source: 'response' | 'fallback';
	  };

/** Collapse punctuation so "Caringbah Cust Exp" and "caringbah-cust-exp" match. */
function foldName(raw: string | undefined | null): string {
	return (raw ?? '')
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function titleCaseWords(folded: string): string {
	return folded
		.split(' ')
		.filter(Boolean)
		.map((w) => w.charAt(0) + w.slice(1).toLowerCase())
		.join(' ');
}

/**
 * Facility / depot CX mailboxes that should appear as their own Stats by Team Leader row.
 * Includes the common Caringbah typo ("Caingbah").
 */
export function facilityTeamFromName(raw: string | undefined | null): string | null {
	const folded = foldName(raw);
	if (!folded) return null;
	// "Caringbah", "Caringbah Cust Exp", "Caingbah Cust Exp"
	if (/\bCAI?NGBAH\b/.test(folded)) return 'Caringbah Cust Exp';
	if (/\bCUST EXP\b/.test(folded) || /\bCUSTOMER EXP\b/.test(folded)) {
		return titleCaseWords(folded);
	}
	return null;
}

/**
 * Map a free-text / mailbox / typo value onto the official Responded By dropdown name.
 * e.g. "Caringbah Cust Exp" + "Caingbah" → dropdown option "Caringbah".
 */
export function matchOfficialRespondedBy(
	raw: string | undefined | null,
	officialNames: readonly string[]
): string | null {
	const folded = foldName(raw);
	if (!folded) return null;

	const officials = officialNames
		.map((name) => ({ name: name.trim(), folded: foldName(name) }))
		.filter((o) => o.folded);

	const exact = officials.find((o) => o.folded === folded);
	if (exact) return exact.name;

	const rawFacility = facilityTeamFromName(raw);
	if (rawFacility) {
		const same = officials.filter((o) => facilityTeamFromName(o.name) === rawFacility);
		if (same.length === 1) return same[0].name;
		if (same.length > 1) {
			same.sort(
				(a, b) => a.folded.length - b.folded.length || a.name.localeCompare(b.name)
			);
			return same[0].name;
		}
	}

	return null;
}

export function canonicalLeaderLabel(
	raw: string,
	officialNames: readonly string[] = []
): string {
	const trimmed = raw.trim();
	return (
		matchOfficialRespondedBy(trimmed, officialNames) ??
		facilityTeamFromName(trimmed) ??
		trimmed
	);
}

function leaderBucket(
	label: string,
	source: 'response' | 'fallback'
): TeamLeaderStatsBucket {
	const trimmed = label.trim();
	return { kind: 'leader', key: trimmed.toUpperCase(), label: trimmed, source };
}

/**
 * Row key for Stats by Team Leader.
 * Prefer official Responded By dropdown names (Andrew Tran, Caringbah, …).
 * Facility CX mailboxes also roll into that option when Responded By is blank.
 */
export function teamLeaderStatsBucket(
	incident: Incident,
	officialNames: readonly string[] = []
): TeamLeaderStatsBucket {
	const response = (incident.response ?? '').trim();
	if (response) {
		return leaderBucket(canonicalLeaderLabel(response, officialNames), 'response');
	}

	const teamLeader = (incident.teamLeader ?? '').trim();
	if (teamLeader) {
		const official = matchOfficialRespondedBy(teamLeader, officialNames);
		const facility = official ?? facilityTeamFromName(teamLeader);
		if (facility) return leaderBucket(facility, 'fallback');
	}

	const senderRaw = (incident.sender ?? '').trim() || (incident.emailSender ?? '').trim();
	if (senderRaw) {
		const official = matchOfficialRespondedBy(senderRaw, officialNames);
		const facility = official ?? facilityTeamFromName(senderRaw);
		if (facility) return leaderBucket(facility, 'fallback');
	}

	return { kind: 'unassigned' };
}

/** List / drill-down match for a Responded By (or facility-team) filter value. */
export function incidentMatchesTeamLeaderFilter(
	incident: Incident,
	filter: string,
	officialNames: readonly string[] = []
): boolean {
	const want = filter.trim();
	if (!want) return true;

	const bucket = teamLeaderStatsBucket(incident, officialNames);
	if (bucket.kind === 'unassigned') return false;

	const wantLabel = canonicalLeaderLabel(want, officialNames);
	return bucket.key === wantLabel.toUpperCase();
}
