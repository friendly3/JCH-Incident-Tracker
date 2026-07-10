/**
 * Parse AusPost / SOD-style incident email subjects.
 *
 * Canonical example:
 *   "SOD Disputed Delivery: 72956318 N22226 Menai CHENGZ2 - Blaxland Dr"
 *   → type Disputed Delivery, ref 72956318, facility N22226,
 *     suburb Menai, driver CHENGZ2, street Blaxland Dr
 *
 * Also handles Re:/FW: prefixes, multi-word suburbs, and looser spacing/dashes.
 * Manual locationStreet / locationSuburb on an incident always win for the map.
 */

export type ParsedEmailLocation = {
	articleNo: string;
	facilityCode: string;
	suburb: string;
	driver: string;
	street: string;
	/** Query string for geocoders (always NSW, Australia). */
	query: string;
	raw: string;
	/** How the location was obtained. */
	source: 'manual' | 'subject';
};

/** Full subject parse (ref, type, driver, location). */
export type ParsedEmailSubject = {
	raw: string;
	/** Article / tracking-style number (preferred reference no.). */
	referenceNo: string | null;
	/** Type text as it appears before the colon (cleaned). */
	typeName: string | null;
	/** Facility code e.g. N22226 */
	facilityCode: string | null;
	suburb: string | null;
	/** Driver username / code as found in subject */
	driver: string | null;
	street: string | null;
	/** Geocode query when suburb is known */
	query: string | null;
	/** Confidence notes for UI */
	notes: string[];
};

export type IncidentLocationFields = {
	emailSubject?: string;
	referenceNo?: string;
	locationStreet?: string;
	locationSuburb?: string;
};

const RE_PREFIX = /^(?:(?:re|fw|fwd)\s*:\s*)+/i;
/** Leading ops tags before the human type name */
const TYPE_PREFIX_TAGS = /^(?:sod|ap|auspost|jch)\s+/i;
/** Driver token: starts with a letter, mostly alnum, usually has a digit (AusPost usernames) */
const DRIVER_TOKEN = /^[A-Za-z][A-Za-z0-9]{2,24}$/;
const DRIVER_LIKELY = /[0-9]/; // preferred if contains a digit
const FACILITY = /^N\d{3,6}$/i;
const ARTICLE = /^\d{6,14}$/;

function cleanSpaces(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function stripSubjectNoise(subject: string): string {
	return cleanSpaces(subject.replace(RE_PREFIX, ''));
}

/**
 * Split "Type: payload" — type may include spaces; first colon is the separator.
 */
function splitTypeAndBody(s: string): { typePart: string | null; body: string } {
	const idx = s.indexOf(':');
	if (idx <= 0) return { typePart: null, body: s };
	const typePart = cleanSpaces(s.slice(0, idx).replace(TYPE_PREFIX_TAGS, ''));
	const body = cleanSpaces(s.slice(idx + 1));
	return { typePart: typePart || null, body };
}

/**
 * From "72956318 N22226 Menai CHENGZ2 - Blaxland Dr" extract fields.
 * Street is after the last dash group; driver is the last token before the dash.
 */
function parseBody(body: string): {
	referenceNo: string | null;
	facilityCode: string | null;
	suburb: string | null;
	driver: string | null;
	street: string | null;
	notes: string[];
} {
	const notes: string[] = [];
	let working = body;

	// Normalise dash variants around street separator
	working = working.replace(/\s*[-–—―]\s*/g, ' - ');

	let street: string | null = null;
	let left = working;

	const dashIdx = working.lastIndexOf(' - ');
	if (dashIdx >= 0) {
		street = cleanSpaces(working.slice(dashIdx + 3)) || null;
		left = cleanSpaces(working.slice(0, dashIdx));
		if (street && street.length < 2) {
			notes.push('Street segment after dash was too short');
			street = null;
		}
	} else {
		notes.push('No street dash separator found');
	}

	const tokens = left.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) {
		return {
			referenceNo: null,
			facilityCode: null,
			suburb: null,
			driver: null,
			street,
			notes
		};
	}

	let i = 0;
	let referenceNo: string | null = null;
	let facilityCode: string | null = null;

	// Article / ref number (first long digit run)
	if (tokens[i] && ARTICLE.test(tokens[i])) {
		referenceNo = tokens[i];
		i += 1;
	} else {
		// Scan for article-like token near the start
		const artIdx = tokens.findIndex((t, idx) => idx < 3 && ARTICLE.test(t));
		if (artIdx >= 0) {
			referenceNo = tokens[artIdx];
			tokens.splice(artIdx, 1);
			notes.push('Reference number was not the first body token');
		}
	}

	// Facility N#####
	if (tokens[i] && FACILITY.test(tokens[i])) {
		facilityCode = tokens[i].toUpperCase();
		i += 1;
	} else {
		const facIdx = tokens.findIndex((t, idx) => idx <= i + 1 && FACILITY.test(t));
		if (facIdx >= 0) {
			facilityCode = tokens[facIdx].toUpperCase();
			tokens.splice(facIdx, 1);
			// re-align i if we removed before i
			if (facIdx < i) i = Math.max(0, i - 1);
			notes.push('Facility code was not immediately after the article number');
		}
	}

	const mid = tokens.slice(i);
	if (mid.length === 0) {
		return { referenceNo, facilityCode, suburb: null, driver: null, street, notes };
	}

	// Driver = last mid token that looks like a username; suburb = the rest
	let driver: string | null = null;
	let suburbTokens = mid;

	const last = mid[mid.length - 1];
	if (last && DRIVER_TOKEN.test(last)) {
		// Prefer tokens with digits (PHAMT60) over plain words (Bay)
		const lastLooksDriver = DRIVER_LIKELY.test(last) || last === last.toUpperCase();
		// Multi-word suburb: if last is ALLCAPS with digit, take as driver
		if (DRIVER_LIKELY.test(last) || (lastLooksDriver && mid.length >= 2)) {
			driver = last.toUpperCase();
			suburbTokens = mid.slice(0, -1);
		} else if (mid.length === 1 && DRIVER_LIKELY.test(last)) {
			driver = last.toUpperCase();
			suburbTokens = [];
		}
	}

	// Fallback: scan from end for first digit-containing alnum token
	if (!driver) {
		for (let j = mid.length - 1; j >= 0; j--) {
			const t = mid[j];
			if (DRIVER_TOKEN.test(t) && DRIVER_LIKELY.test(t)) {
				driver = t.toUpperCase();
				suburbTokens = [...mid.slice(0, j), ...mid.slice(j + 1)];
				notes.push('Driver token recovered by reverse scan');
				break;
			}
		}
	}

	const suburb = suburbTokens.length ? cleanSpaces(suburbTokens.join(' ')) : null;
	if (!suburb) notes.push('Suburb could not be determined');
	if (!driver) notes.push('Driver token could not be determined');

	return { referenceNo, facilityCode, suburb, driver, street, notes };
}

/**
 * Full parse of an incident email subject for ref, type, driver, and location.
 */
export function parseEmailSubject(
	subject: string | undefined | null
): ParsedEmailSubject | null {
	if (!subject?.trim()) return null;
	const raw = subject.trim();
	const cleaned = stripSubjectNoise(raw);
	if (!cleaned) return null;

	const { typePart, body } = splitTypeAndBody(cleaned);
	const bodyParsed = parseBody(body);

	// If no colon, try body-style parse on the whole string
	const effective =
		typePart || bodyParsed.referenceNo || bodyParsed.facilityCode
			? bodyParsed
			: parseBody(cleaned);

	const suburb = effective.suburb;
	const street = effective.street;
	const query =
		suburb && street
			? `${street}, ${suburb} NSW, Australia`
			: suburb
				? `${suburb} NSW, Australia`
				: null;

	// Require at least one useful field
	if (
		!typePart &&
		!effective.referenceNo &&
		!effective.driver &&
		!suburb &&
		!street
	) {
		return null;
	}

	return {
		raw,
		referenceNo: effective.referenceNo,
		typeName: typePart,
		facilityCode: effective.facilityCode,
		suburb,
		driver: effective.driver,
		street,
		query,
		notes: effective.notes
	};
}

/**
 * Extract suburb + street (and related fields) from an email subject.
 * Returns null when the subject does not yield a usable location.
 * (Map / geocode entry point — prefers full parser.)
 */
export function parseEmailSubjectLocation(
	subject: string | undefined | null
): ParsedEmailLocation | null {
	const full = parseEmailSubject(subject);
	if (!full?.suburb) return null;
	// Street optional for suburb-centre pins; require street for legacy shape when both present
	const street = full.street?.trim() ?? '';
	const suburb = full.suburb.trim();
	if (!suburb) return null;

	return {
		articleNo: full.referenceNo ?? '',
		facilityCode: full.facilityCode ?? '',
		suburb,
		driver: full.driver ?? '',
		street,
		query: full.query ?? `${suburb} NSW, Australia`,
		raw: full.raw,
		source: 'subject'
	};
}

/**
 * Match parsed type text to a known incident type name (dropdown).
 * Prefers exact (case-insensitive), then starts-with / includes.
 */
export function matchIncidentTypeName(
	parsedType: string | null | undefined,
	knownTypes: { id: string; name: string }[]
): { id: string; name: string } | null {
	if (!parsedType?.trim() || knownTypes.length === 0) return null;
	const needle = parsedType.trim().toLowerCase().replace(/\s+/g, ' ');

	const exact = knownTypes.find((t) => t.name.trim().toLowerCase() === needle);
	if (exact) return exact;

	// Parsed may be shorter ("Disputed Delivery") vs DB "DISPUTED DELIVERY"
	const starts = knownTypes.filter((t) => {
		const n = t.name.trim().toLowerCase();
		return n.startsWith(needle) || needle.startsWith(n);
	});
	if (starts.length === 1) return starts[0];

	const includes = knownTypes.filter((t) => {
		const n = t.name.trim().toLowerCase();
		return n.includes(needle) || needle.includes(n);
	});
	// Prefer longest known name match to avoid short false positives
	if (includes.length >= 1) {
		return includes.sort((a, b) => b.name.length - a.name.length)[0];
	}
	return null;
}

/**
 * Match parsed driver code to a known driver username (dropdown).
 */
export function matchDriverUsername(
	parsedDriver: string | null | undefined,
	knownDrivers: { id: string; username?: string; name?: string }[]
): { id: string; username: string } | null {
	if (!parsedDriver?.trim() || knownDrivers.length === 0) return null;
	const needle = parsedDriver.trim().toUpperCase();

	const byUser = knownDrivers.find(
		(d) => (d.username ?? '').trim().toUpperCase() === needle
	);
	if (byUser?.username) {
		return { id: byUser.id, username: byUser.username };
	}

	// Partial: subject code contained in username or vice versa
	const partial = knownDrivers.filter((d) => {
		const u = (d.username ?? '').trim().toUpperCase();
		return u && (u.includes(needle) || needle.includes(u));
	});
	if (partial.length === 1 && partial[0].username) {
		return { id: partial[0].id, username: partial[0].username };
	}
	return null;
}

/**
 * Resolve an incident’s map location: manual street/suburb first, else email subject.
 * Suburb alone is enough (street optional) for suburb-centre geocoding.
 */
export function resolveIncidentLocation(
	row: IncidentLocationFields
): ParsedEmailLocation | null {
	const street = (row.locationStreet ?? '').trim().replace(/\s+/g, ' ');
	const suburb = (row.locationSuburb ?? '').trim().replace(/\s+/g, ' ');

	if (suburb) {
		const query = street
			? `${street}, ${suburb} NSW, Australia`
			: `${suburb} NSW, Australia`;
		return {
			articleNo: '',
			facilityCode: '',
			suburb,
			driver: '',
			street,
			query,
			raw: street ? `${street}, ${suburb}` : suburb,
			source: 'manual'
		};
	}

	return parseEmailSubjectLocation(row.emailSubject);
}

export type LocationAggregate = {
	key: string;
	suburb: string;
	street: string;
	query: string;
	count: number;
	/** Sample subjects / refs for popup */
	samples: string[];
	/** At least one incident in this group used a manual location. */
	hasManual: boolean;
};

/** Aggregate incidents by resolved street+suburb key (manual overrides subject). */
export function aggregateLocationsFromSubjects(
	rows: IncidentLocationFields[]
): LocationAggregate[] {
	const map = new Map<string, LocationAggregate>();

	for (const row of rows) {
		const parsed = resolveIncidentLocation(row);
		if (!parsed) continue;
		const key = `${parsed.suburb.toLowerCase()}|${parsed.street.toLowerCase()}`;
		const existing = map.get(key);
		const sample =
			row.referenceNo?.trim() || parsed.articleNo || parsed.raw;
		if (existing) {
			existing.count += 1;
			if (parsed.source === 'manual') existing.hasManual = true;
			if (existing.samples.length < 5) existing.samples.push(sample);
		} else {
			map.set(key, {
				key,
				suburb: parsed.suburb,
				street: parsed.street,
				query: parsed.query,
				count: 1,
				samples: [sample],
				hasManual: parsed.source === 'manual'
			});
		}
	}

	return [...map.values()].sort((a, b) => b.count - a.count);
}

export type LocationParseSummary = {
	/** Distinct street+suburb groups that resolved successfully. */
	locations: LocationAggregate[];
	/** Incidents with a usable location (manual or subject). */
	parseableIncidentCount: number;
	/**
	 * Incidents with no usable location
	 * (no manual suburb and subject missing / not matching template).
	 */
	unparseableIncidentCount: number;
	totalIncidents: number;
};

/** Aggregate locations and count incidents that cannot be placed on the map. */
export function summarizeLocationsFromSubjects(
	rows: IncidentLocationFields[]
): LocationParseSummary {
	const locations = aggregateLocationsFromSubjects(rows);
	const parseableIncidentCount = locations.reduce((sum, loc) => sum + loc.count, 0);
	const totalIncidents = rows.length;
	return {
		locations,
		parseableIncidentCount,
		unparseableIncidentCount: Math.max(0, totalIncidents - parseableIncidentCount),
		totalIncidents
	};
}
