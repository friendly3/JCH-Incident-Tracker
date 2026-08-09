/**
 * Dashboard UI state that should survive client navigations (e.g. drill-down →
 * Back to Dashboard) and soft reloads. Period filter lives in dashboardPeriod.
 */

const STORAGE_KEY = 'jch-dashboard-ui-v1';

export type OverTimeBucket = 'day' | 'month' | 'year';
export type TeamLeaderView = 'table' | 'chart';

type StoredUi = {
	overTimeBucket?: OverTimeBucket;
	teamLeaderView?: TeamLeaderView;
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

	get hiddenDriverTypeLabels(): string[] {
		ensureHydrated();
		return _hiddenDriverTypeLabels;
	},
	set hiddenDriverTypeLabels(next: string[]) {
		ensureHydrated();
		_hiddenDriverTypeLabels = next;
		writeStored({ hiddenDriverTypeLabels: next });
	},

	get hiddenTypeOverTimeLabels(): string[] {
		ensureHydrated();
		return _hiddenTypeOverTimeLabels;
	},
	set hiddenTypeOverTimeLabels(next: string[]) {
		ensureHydrated();
		_hiddenTypeOverTimeLabels = next;
		writeStored({ hiddenTypeOverTimeLabels: next });
	},

	/** Call when leaving the dashboard so Back restores scroll. */
	captureScroll() {
		if (typeof window === 'undefined') return;
		ensureHydrated();
		_scrollY = window.scrollY || window.pageYOffset || 0;
		writeStored({ scrollY: _scrollY });
	},

	/**
	 * Restore scroll after dashboard mounts. Uses rAF so layout/charts have a
	 * chance to size before jumping.
	 */
	restoreScroll() {
		if (typeof window === 'undefined') return;
		ensureHydrated();
		const y = _scrollY;
		if (!y || y <= 0) return;
		requestAnimationFrame(() => {
			window.scrollTo(0, y);
			// Second pass after charts/async layout settle
			requestAnimationFrame(() => {
				window.scrollTo(0, y);
			});
		});
	}
};
