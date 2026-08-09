/**
 * Dashboard UI state that should survive client navigations (e.g. drill-down →
 * Back to Dashboard) and soft reloads. Period filter lives in dashboardPeriod.
 */

const STORAGE_KEY = 'jch-dashboard-ui-v1';
const RESTORE_SCROLL_FLAG = 'jch-dashboard-restore-scroll';

export type OverTimeBucket = 'day' | 'month' | 'year';
export type TeamLeaderView = 'table' | 'chart';
/** Incidents by Driver per Month card: table (default) or multi-series line chart. */
export type DriverMonthView = 'table' | 'chart';

type StoredUi = {
	overTimeBucket?: OverTimeBucket;
	teamLeaderView?: TeamLeaderView;
	driverMonthView?: DriverMonthView;
	hiddenDriverTypeLabels?: string[];
	hiddenTypeOverTimeLabels?: string[];
	scrollY?: number;
};

function isOverTimeBucket(v: unknown): v is OverTimeBucket {
	return v === 'day' || v === 'month' || v === 'year';
}

function isTeamLeaderView(v: unknown): v is TeamLeaderView {
	return v === 'table' || v === 'chart';
}

function isDriverMonthView(v: unknown): v is DriverMonthView {
	return v === 'table' || v === 'chart';
}

function sameStringArray(a: string[], b: string[]): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function readStored(): StoredUi {
	if (typeof window === 'undefined') return {};
	try {
		const raw = sessionStorage.getItem(STORAGE_KEY)?.trim() ?? '';
		if (!raw) return {};
		const parsed = JSON.parse(raw) as StoredUi;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function writeStored(patch: StoredUi) {
	if (typeof window === 'undefined') return;
	try {
		const prev = readStored();
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...patch }));
	} catch {
		/* private mode / blocked storage */
	}
}

let _overTimeBucket = $state<OverTimeBucket>('day');
let _teamLeaderView = $state<TeamLeaderView>('chart');
let _driverMonthView = $state<DriverMonthView>('table');
let _hiddenDriverTypeLabels = $state<string[]>([]);
let _hiddenTypeOverTimeLabels = $state<string[]>([]);
/** Last scroll position on /dashboard (session only). */
let _scrollY = $state(0);
let _hydrated = false;

function ensureHydrated() {
	if (_hydrated || typeof window === 'undefined') return;
	_hydrated = true;
	const stored = readStored();
	if (isOverTimeBucket(stored.overTimeBucket)) {
		_overTimeBucket = stored.overTimeBucket;
	}
	if (isTeamLeaderView(stored.teamLeaderView)) {
		_teamLeaderView = stored.teamLeaderView;
	}
	if (isDriverMonthView(stored.driverMonthView)) {
		_driverMonthView = stored.driverMonthView;
	}
	if (Array.isArray(stored.hiddenDriverTypeLabels)) {
		_hiddenDriverTypeLabels = stored.hiddenDriverTypeLabels.filter(
			(s): s is string => typeof s === 'string'
		);
	}
	if (Array.isArray(stored.hiddenTypeOverTimeLabels)) {
		_hiddenTypeOverTimeLabels = stored.hiddenTypeOverTimeLabels.filter(
			(s): s is string => typeof s === 'string'
		);
	}
	if (typeof stored.scrollY === 'number' && Number.isFinite(stored.scrollY) && stored.scrollY >= 0) {
		_scrollY = stored.scrollY;
	}
}

// Eager hydrate on the client so getters never mutate during reactive reads
if (typeof window !== 'undefined') {
	ensureHydrated();
}

export const dashboardUi = {
	get overTimeBucket(): OverTimeBucket {
		ensureHydrated();
		return _overTimeBucket;
	},
	set overTimeBucket(next: OverTimeBucket) {
		ensureHydrated();
		if (!isOverTimeBucket(next) || _overTimeBucket === next) return;
		_overTimeBucket = next;
		writeStored({ overTimeBucket: next });
	},

	get teamLeaderView(): TeamLeaderView {
		ensureHydrated();
		return _teamLeaderView;
	},
	set teamLeaderView(next: TeamLeaderView) {
		ensureHydrated();
		if (!isTeamLeaderView(next) || _teamLeaderView === next) return;
		_teamLeaderView = next;
		writeStored({ teamLeaderView: next });
	},

	get driverMonthView(): DriverMonthView {
		ensureHydrated();
		return _driverMonthView;
	},
	set driverMonthView(next: DriverMonthView) {
		ensureHydrated();
		if (!isDriverMonthView(next) || _driverMonthView === next) return;
		_driverMonthView = next;
		writeStored({ driverMonthView: next });
	},

	get hiddenDriverTypeLabels(): string[] {
		ensureHydrated();
		return _hiddenDriverTypeLabels;
	},
	set hiddenDriverTypeLabels(next: string[]) {
		ensureHydrated();
		if (sameStringArray(_hiddenDriverTypeLabels, next)) return;
		_hiddenDriverTypeLabels = next;
		writeStored({ hiddenDriverTypeLabels: next });
	},

	get hiddenTypeOverTimeLabels(): string[] {
		ensureHydrated();
		return _hiddenTypeOverTimeLabels;
	},
	set hiddenTypeOverTimeLabels(next: string[]) {
		ensureHydrated();
		if (sameStringArray(_hiddenTypeOverTimeLabels, next)) return;
		_hiddenTypeOverTimeLabels = next;
		writeStored({ hiddenTypeOverTimeLabels: next });
	},

	/**
	 * Save scroll and mark that the next dashboard mount should restore it
	 * (used when leaving for a drill-down / other route).
	 */
	captureScroll() {
		if (typeof window === 'undefined') return;
		ensureHydrated();
		_scrollY = window.scrollY || window.pageYOffset || 0;
		writeStored({ scrollY: _scrollY });
		try {
			sessionStorage.setItem(RESTORE_SCROLL_FLAG, '1');
		} catch {
			/* ignore */
		}
	},

	/** True once after captureScroll; clears the flag. */
	consumeScrollRestore(): boolean {
		if (typeof window === 'undefined') return false;
		try {
			const flag = sessionStorage.getItem(RESTORE_SCROLL_FLAG);
			if (flag !== '1') return false;
			sessionStorage.removeItem(RESTORE_SCROLL_FLAG);
			return true;
		} catch {
			return false;
		}
	},

	/**
	 * Restore scroll after dashboard content is ready. Clamps to document height
	 * so a stale large Y does not leave the viewport in empty space.
	 */
	restoreScroll() {
		if (typeof window === 'undefined') return;
		ensureHydrated();
		const y = _scrollY;
		if (!y || y <= 0) return;

		const apply = () => {
			const maxY = Math.max(
				0,
				(document.documentElement?.scrollHeight ?? 0) - window.innerHeight
			);
			window.scrollTo(0, Math.min(y, maxY));
		};

		// Multi-pass: layout grows as charts/map mount
		requestAnimationFrame(() => {
			apply();
			requestAnimationFrame(apply);
			setTimeout(apply, 100);
			setTimeout(apply, 400);
		});
	}
};
