/**
 * Dashboard period filter — survives client-side navigation via sessionStorage
 * and a module-level reactive value.
 */

const STORAGE_KEY = 'jch-dashboard-time-range';

export type RelativeTimeRangeKey = 'all' | '7' | '30' | '90';
export type MonthTimeRangeKey = `m:${string}`;
export type TimeRangeKey = RelativeTimeRangeKey | MonthTimeRangeKey;

export const TIME_RANGE_OPTIONS: { value: RelativeTimeRangeKey; label: string }[] = [
	{ value: 'all', label: 'All time' },
	{ value: '90', label: 'Last 90 days' },
	{ value: '30', label: 'Last 30 days' },
	{ value: '7', label: 'Last 7 days' }
];

export function isMonthTimeRange(range: string): range is MonthTimeRangeKey {
	return /^m:\d{4}-\d{2}$/.test(range);
}

export function monthKeyFromRange(range: MonthTimeRangeKey): string {
	return range.slice(2); // YYYY-MM
}

/** en-AU long month label, e.g. "March 2026" */
export function formatMonthYearLabel(ym: string): string {
	const m = /^(\d{4})-(\d{2})$/.exec(ym);
	if (!m) return ym;
	const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
	if (Number.isNaN(d.getTime())) return ym;
	return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

/**
 * Inclusive calendar window ending today (local) for relative ranges,
 * or a single calendar month (YYYY-MM) when range is m:YYYY-MM.
 * e.g. last 7 days = today and the previous 6 calendar days.
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

	if (isMonthTimeRange(range)) {
		const ym = monthKeyFromRange(range);
		return match[1] === ym.slice(0, 4) && match[2] === ym.slice(5, 7);
	}

	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
	if (received > end) return false;

	if (range === 'all') return true;

	const days = parseInt(range, 10);
	if (!Number.isFinite(days) || days < 1) return true;

	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	start.setDate(start.getDate() - (days - 1));
	start.setHours(0, 0, 0, 0);
	return received >= start;
}

function isValidTimeRange(value: string): value is TimeRangeKey {
	if (value === 'all' || value === '7' || value === '30' || value === '90') return true;
	return isMonthTimeRange(value);
}

function readStored(): TimeRangeKey {
	if (typeof window === 'undefined') return 'all';
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY)?.trim() ?? '';
		if (raw && isValidTimeRange(raw)) return raw;
	} catch {
		/* private mode / blocked storage */
	}
	return 'all';
}

function writeStored(value: TimeRangeKey) {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_KEY, value);
	} catch {
		/* ignore */
	}
}

// SSR-safe default; hydrate from sessionStorage on first client read via ensureHydrated
let _timeRange = $state<TimeRangeKey>('all');
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
	 * If the stored selection is a calendar month that no longer has data,
	 * fall back to all time. Only call when `availableYm` is a settled list
	 * (not empty while data is still loading).
	 */
	resetIfMissingMonth(availableYm: string[]) {
		ensureHydrated();
		if (!isMonthTimeRange(_timeRange)) return;
		// Empty list usually means "still loading" or "no refs yet" — don't clobber selection
		if (availableYm.length === 0) return;
		const ym = _timeRange.slice(2);
		if (!availableYm.includes(ym)) {
			_timeRange = 'all';
			writeStored('all');
		}
	}
};
