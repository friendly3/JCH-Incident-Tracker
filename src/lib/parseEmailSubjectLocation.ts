/**
 * Parse AusPost-style incident email subjects for NSW delivery locations.
 *
 * Example:
 *   "SOD Disputed Delivery: 72956318 N22226 Menai CHENGZ2 - Blaxland Dr"
 *   → suburb Menai, street Blaxland Dr, facility N22226, driver CHENGZ2
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
		raw: s
	};
}

export type LocationAggregate = {
	key: string;
	suburb: string;
	street: string;
	query: string;
	count: number;
	/** Sample subjects / refs for popup */
	samples: string[];
};

/** Aggregate incidents by parsed street+suburb key. */
export function aggregateLocationsFromSubjects(
	subjects: { emailSubject?: string; referenceNo?: string }[]
): LocationAggregate[] {
	const map = new Map<string, LocationAggregate>();

	for (const row of subjects) {
		const parsed = parseEmailSubjectLocation(row.emailSubject);
		if (!parsed) continue;
		const key = `${parsed.suburb.toLowerCase()}|${parsed.street.toLowerCase()}`;
		const existing = map.get(key);
		const sample = row.referenceNo?.trim() || parsed.articleNo || parsed.raw;
		if (existing) {
			existing.count += 1;
			if (existing.samples.length < 5) existing.samples.push(sample);
		} else {
			map.set(key, {
				key,
				suburb: parsed.suburb,
				street: parsed.street,
				query: parsed.query,
				count: 1,
				samples: [sample]
			});
		}
	}

	return [...map.values()].sort((a, b) => b.count - a.count);
}
