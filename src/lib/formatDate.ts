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

function parseDate(dateStr: string): Date | null {
	if (!dateStr) return null;

	// Handle YYYY-MM-DD date-only strings safely (avoid UTC timezone shift)
	const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
	if (dateOnlyMatch) {
		const year = parseInt(dateOnlyMatch[1], 10);
		const month = parseInt(dateOnlyMatch[2], 10);
		const day = parseInt(dateOnlyMatch[3], 10);
		if (month < 1 || month > 12 || day < 1 || day > 31) return null;
		const d = new Date(year, month - 1, day);
		if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
			return null;
		}
		return d;
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

/** Formats a datetime-local value (YYYY-MM-DDTHH:mm) as dd-mmm-yyyy with optional time. */
export function formatDateTimeLocal(value: string): string {
	if (!value?.trim()) return '';

	const [datePart, timePart] = value.trim().split('T');
	const formattedDate = formatDate(datePart);
	if (!formattedDate) return '';

	const time = timePart?.trim().slice(0, 5) ?? '';
	if (!time || time === '00:00') return formattedDate;

	return `${formattedDate} ${time}`;
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