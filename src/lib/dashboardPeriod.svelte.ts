/**
 * Dashboard period filter — survives client-side navigation via sessionStorage
 * and a module-level reactive value.
 */

const STORAGE_KEY = 'jch-dashboard-time-range';

export type RelativeTimeRangeKey =
	| 'all'
	| 'today'
	| 'week'
	| 'year'
	| '7'
	| '30'
	| '90';
export type MonthTimeRangeKey = `m:${string}`;
/** Single calendar day from over-time chart drill-down: d:YYYY-MM-DD */
export type DayTimeRangeKey = `d:${string}`;
/** Full calendar year from over-time chart drill-down: y:YYYY */
export type YearTimeRangeKey = `y:${string}`;
export type TimeRangeKey =
	| RelativeTimeRangeKey
	| MonthTimeRangeKey
	| DayTimeRangeKey
	| YearTimeRangeKey;

export const TIME_RANGE_OPTIONS: { value: RelativeTimeRangeKey; label: string }[] = [
	{ value: 'all', label: 'All time' },
	{ value: 'today', label: 'Today' },
	{ value: 'week', label: 'This Week' },
	{ value: 'year', label: 'This Year' },
	{ value: '90', label: 'Last 90 days' },
	{ value: '30', label: 'Last 30 days' },
	{ value: '7', label: 'Last 7 days' }
];

/**
 * Local start of the current week (Sunday 00:00:00.000).
 * Week is always Sunday → Saturday (not Monday-based).
 */
export function startOfWeekSunday(now = new Date()): Date {
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
	// getDay(): 0 = Sunday … 6 = Saturday
	start.setDate(start.getDate() - start.getDay());
	return start;
}

export function isMonthTimeRange(range: string): range is MonthTimeRangeKey {
	return /^m:\d{4}-\d{2}$/.test(range);
}

export function isDayTimeRange(range: string): range is DayTimeRangeKey {
	return /^d:\d{4}-\d{2}-\d{2}$/.test(range);
}

export function isYearTimeRange(range: string): range is YearTimeRangeKey {
	return /^y:\d{4}$/.test(range);
}

export function monthKeyFromRange(range: MonthTimeRangeKey): string {
	return range.slice(2); // YYYY-MM
}

export function dayKeyFromRange(range: DayTimeRangeKey): string {
	return range.slice(2); // YYYY-MM-DD
}

export function yearKeyFromRange(range: YearTimeRangeKey): string {
	return range.slice(2); // YYYY
}

/** Build a single-day period key for drill-down / list filter. */
export function dayTimeRange(dateKey: string): DayTimeRangeKey | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey?.trim() ?? '');
	return m ? (`d:${m[1]}-${m[2]}-${m[3]}` as DayTimeRangeKey) : null;
}

/** Build a calendar-year period key for drill-down / list filter. */
export function yearTimeRange(yearKey: string): YearTimeRangeKey | null {
	const m = /^(\d{4})$/.exec(yearKey?.trim() ?? '');
	return m ? (`y:${m[1]}` as YearTimeRangeKey) : null;
}

/** en-AU long month label, e.g. "March 2026" */
export function formatMonthYearLabel(ym: string): string {
	const m = /^(\d{4})-(\d{2})$/.exec(ym);
	if (!m) return ym;
	const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
	if (Number.isNaN(d.getTime())) return ym;
	return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

/** Local calendar month as YYYY-MM */
export function currentMonthYm(now = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	return `${y}-${m}`;
}

/** Dashboard default period: current calendar month (`m:YYYY-MM`). */
export function currentMonthTimeRange(now = new Date()): MonthTimeRangeKey {
	return `m:${currentMonthYm(now)}`;
}

/**
 * Inclusive calendar window ending today (local) for relative ranges,
 * a single calendar month (YYYY-MM) when range is m:YYYY-MM,
 * a single calendar day when range is d:YYYY-MM-DD,
 * or a full calendar year when range is y:YYYY.
 * e.g. last 7 days = today and the previous 6 calendar days.
 * `today` → current local calendar day only.
 * `week` → this calendar week Sunday–Saturday (through today; no future days).
 * `year` → this local calendar year 1 January through today (no future days).
 * `all` → no lower bound.
 */
export function isDateReceivedInTimeRange(
	dateStr: string,
	range: TimeRangeKey,
	now = new Date()
): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr?.trim() ?? '');
	if (!match) return false;
	const year = parseInt(match[1], 10);
	const month = parseInt(match[2], 10);
	const day = parseInt(match[3], 10);
	const received = new Date(year, month - 1, day);
	if (Number.isNaN(received.getTime())) return false;

	if (isDayTimeRange(range)) {
		const dayKey = dayKeyFromRange(range);
		return match[0] === dayKey || `${match[1]}-${match[2]}-${match[3]}` === dayKey;
	}

	if (isMonthTimeRange(range)) {
		const ym = monthKeyFromRange(range);
		return match[1] === ym.slice(0, 4) && match[2] === ym.slice(5, 7);
	}

	if (isYearTimeRange(range)) {
		return match[1] === yearKeyFromRange(range);
	}

	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
	if (received > end) return false;

	if (range === 'all') return true;

	// Today = current local calendar day only
	if (range === 'today') {
		const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
		return received >= start && received <= end;
	}

	// This week = Sunday 00:00 through today (week always Sun–Sat)
	if (range === 'week') {
		const start = startOfWeekSunday(now);
		return received >= start && received <= end;
	}

	// This year = local calendar year 1 Jan through today (no future days)
	if (range === 'year') {
		const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
		return received >= start && received <= end;
	}

	const days = parseInt(range, 10);
	if (!Number.isFinite(days) || days < 1) return true;

	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	start.setDate(start.getDate() - (days - 1));
	start.setHours(0, 0, 0, 0);
	return received >= start;
}

function isValidTimeRange(value: string): value is TimeRangeKey {
	if (
		value === 'all' ||
		value === 'today' ||
		value === 'week' ||
		value === 'year' ||
		value === '7' ||
		value === '30' ||
		value === '90'
	) {
		return true;
	}
	return isMonthTimeRange(value) || isDayTimeRange(value) || isYearTimeRange(value);
}

function readStored(): TimeRangeKey {
	// Default: current calendar month (even with zero incidents)
	const fallback = currentMonthTimeRange();
	if (typeof window === 'undefined') return fallback;
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY)?.trim() ?? '';
		if (raw && isValidTimeRange(raw)) return raw;
	} catch {
		/* private mode / blocked storage */
	}
	return fallback;
}

function writeStored(value: TimeRangeKey) {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_KEY, value);
	} catch {
		/* ignore */
	}
}

// Default to current month; hydrate from sessionStorage on first client read
let _timeRange = $state<TimeRangeKey>(currentMonthTimeRange());
let _hydrated = false;

function ensureHydrated() {
	if (_hydrated || typeof window === 'undefined') return;
	_hydrated = true;
	_timeRange = readStored();
}

export const dashboardPeriod = {
	get value(): TimeRangeKey {
		ensureHydrated();
		return _timeRange;
	},
	set value(next: TimeRangeKey) {
		if (!isValidTimeRange(next)) return;
		// Avoid no-op writes — prevents effect thrashing when bound from the UI
		if (_timeRange === next) return;
		_timeRange = next;
		writeStored(next);
	},
	/**
	 * Previously fell back to "all time" when a selected month had no data.
	 * That is disabled: empty months (including the current month default) stay selected.
	 */
	resetIfMissingMonth(_availableYm: string[]) {
		ensureHydrated();
		// no-op — keep m:YYYY-MM even when the month has zero incidents
	}
};
