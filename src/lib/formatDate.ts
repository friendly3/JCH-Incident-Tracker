const MONTH_ABBRS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
] as const;

/**
 * True when `dateStr` is a real calendar day in `YYYY-MM-DD` form
 * (rejects `2024-02-30`, `2024-13-01`, etc.).
 */
export function isValidDateOnly(dateStr: string | undefined | null): boolean {
	if (!dateStr?.trim()) return false;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
	if (!match) return false;
	const year = parseInt(match[1], 10);
	const month = parseInt(match[2], 10);
	const day = parseInt(match[3], 10);
	if (month < 1 || month > 12 || day < 1 || day > 31) return false;
	const d = new Date(year, month - 1, day);
	return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Returns `YYYY-MM-DD` when the input starts with a valid calendar date; otherwise `''`.
 * Stricter than a bare regex prefix — invalid calendar days normalize to empty.
 */
export function normalizeDateOnly(date: string | undefined | null): string {
	if (!date?.trim()) return '';
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(date.trim());
	if (!match) return '';
	return isValidDateOnly(match[1]) ? match[1] : '';
}

function parseDate(dateStr: string): Date | null {
	if (!dateStr) return null;

	// Handle YYYY-MM-DD date-only strings safely (avoid UTC timezone shift)
	const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
	if (dateOnlyMatch) {
		if (!isValidDateOnly(dateOnlyMatch[0])) return null;
		const year = parseInt(dateOnlyMatch[1], 10);
		const month = parseInt(dateOnlyMatch[2], 10);
		const day = parseInt(dateOnlyMatch[3], 10);
		return new Date(year, month - 1, day);
	}

	const d = new Date(dateStr);
	if (isNaN(d.getTime())) return null;
	return d;
}

export function formatDate(dateStr: string): string {
	const d = parseDate(dateStr);
	if (!d) return '';

	const day = String(d.getDate()).padStart(2, '0');
	const month = MONTH_ABBRS[d.getMonth()];
	const year = d.getFullYear();

	return `${day}-${month}-${year}`;
}

/** Normalizes a time field to HH:mm or empty when unset. Accepts HH:mm:ss. */
export function normalizeTimeField(time?: string): string {
	const t = time?.trim() ?? '';
	if (!t) return '';
	const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(t);
	if (m) {
		const hh = m[1].padStart(2, '0');
		const mm = m[2];
		const h = parseInt(hh, 10);
		const mi = parseInt(mm, 10);
		if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return `${hh}:${mm}`;
	}
	return t.slice(0, 5);
}

/**
 * Parse a datetime string into local calendar date (YYYY-MM-DD) and HH:mm.
 * Used when email-received time was stored inside date_received.
 */
export function splitDateTimeToLocalParts(
	raw: string
): { date: string; time: string } | null {
	const s = raw.trim();
	if (!s) return null;

	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return isValidDateOnly(s) ? { date: s, time: '' } : null;
	}

	const iso = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
	if (iso) {
		const datePart = iso[1];
		if (!isValidDateOnly(datePart)) return null;
		if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
			const d = new Date(s);
			if (!Number.isNaN(d.getTime())) {
				try {
					const fmt = new Intl.DateTimeFormat('en-AU', {
						timeZone: 'Australia/Sydney',
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
						hour: '2-digit',
						minute: '2-digit',
						hour12: false
					});
					const parts = Object.fromEntries(
						fmt.formatToParts(d).map((p) => [p.type, p.value])
					);
					let hh = parts.hour;
					if (hh === '24') hh = '00';
					const date = `${parts.year}-${parts.month}-${parts.day}`;
					if (isValidDateOnly(date)) {
						return { date, time: `${hh.padStart(2, '0')}:${parts.minute}` };
					}
				} catch {
					/* fall through */
				}
				const y = d.getFullYear();
				const m = String(d.getMonth() + 1).padStart(2, '0');
				const day = String(d.getDate()).padStart(2, '0');
				const hh = String(d.getHours()).padStart(2, '0');
				const mm = String(d.getMinutes()).padStart(2, '0');
				const date = `${y}-${m}-${day}`;
				if (isValidDateOnly(date)) return { date, time: `${hh}:${mm}` };
			}
		}
		return { date: datePart, time: `${iso[2]}:${iso[3]}` };
	}

	const loose = /(\d{4}-\d{2}-\d{2}).*?(\d{1,2}):(\d{2})/.exec(s);
	if (loose && isValidDateOnly(loose[1])) {
		return {
			date: loose[1],
			time: `${loose[2].padStart(2, '0')}:${loose[3]}`
		};
	}

	return null;
}

/** Formats a time field (HH:mm) for display; returns empty string when unset. */
export function formatTimeField(time?: string): string {
	return normalizeTimeField(time);
}

/** Formats separate date (YYYY-MM-DD) and time (HH:mm) fields for display and assistive text. */
export function formatDateTimeFields(date: string, time?: string): string {
	const formattedDate = formatDate(date);
	if (!formattedDate) return '';

	const trimmedTime = normalizeTimeField(time);
	if (!trimmedTime) return formattedDate;

	return `${formattedDate} ${trimmedTime}`;
}

/** Returns YYYY-MM month key, or 'unknown' for invalid/missing dates. */
export function getMonthKey(dateStr: string): string {
	if (!dateStr) return 'unknown';

	const match = /^(\d{4})-(\d{2})/.exec(dateStr);
	if (!match) return 'unknown';

	const month = parseInt(match[2], 10);
	if (month < 1 || month > 12) return 'unknown';

	return `${match[1]}-${match[2]}`;
}

/** Formats a YYYY-MM key as a human-readable month label, e.g. "July 2026". */
export function formatMonthYear(monthKey: string): string {
	if (monthKey === 'unknown') return 'Unknown date';

	const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
	if (!match) return 'Unknown date';

	const year = parseInt(match[1], 10);
	const month = parseInt(match[2], 10);
	if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return 'Unknown date';

	return new Date(year, month - 1, 1).toLocaleDateString('en-AU', {
		month: 'long',
		year: 'numeric'
	});
}