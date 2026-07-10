/**
 * Parse AusPost-style incident email subjects for NSW delivery locations.
 *
 * Example:
 *   "SOD Disputed Delivery: 72956318 N22226 Menai CHENGZ2 - Blaxland Dr"
 *   → suburb Menai, street Blaxland Dr, facility N22226, driver CHENGZ2
 *
 * Manual locationStreet / locationSuburb on an incident always win over the subject.
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

export type IncidentLocationFields = {
	emailSubject?: string;
	referenceNo?: string;
	locationStreet?: string;
	locationSuburb?: string;
};

/**
 * Extract suburb + street (and related fields) from an email subject.
 * Returns null when the subject does not match the known template.
 */
export function parseEmailSubjectLocation(
	subject: string | undefined | null
): ParsedEmailLocation | null {
	if (!subject?.trim()) return null;
	const s = subject.trim();

	// : <article> N##### <suburb…> <DRIVER> - <street…>
	const m = s.match(
		/:\s*(\d{6,})\s+(N\d{4,})\s+(.+?)\s+([A-Za-z][A-Za-z0-9]{2,})\s*[-–—]\s*(.+?)\s*$/i
	);
	if (!m) return null;

	const articleNo = m[1];
	const facilityCode = m[2].toUpperCase();
	const suburb = m[3].trim().replace(/\s+/g, ' ');
	const driver = m[4].toUpperCase();
	const street = m[5].trim().replace(/\s+/g, ' ');

	if (!suburb || !street) return null;
	// Driver tokens are usually all-caps usernames; reject obvious street leftovers
	if (street.length < 2) return null;

	return {
		articleNo,
		facilityCode,
		suburb,
		driver,
		street,
		query: `${street}, ${suburb} NSW, Australia`,
		raw: s,
		source: 'subject'
	};
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
