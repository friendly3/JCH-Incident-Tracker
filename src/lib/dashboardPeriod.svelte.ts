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
