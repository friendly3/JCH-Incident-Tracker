<script lang="ts">
	import { incidentStore } from '$lib/data/store.svelte';
	import type { Incident } from '$lib/data/incidents';
	import CourierTruckIcon from '$lib/components/CourierTruckIcon.svelte';
	import IncidentForm from '$lib/components/IncidentForm.svelte';
	import {
		getActionPillClass,
		getPriorityPillClass,
		getTypePillClass,
		normalizePriority
	} from '$lib/pillClasses';
	import {
		formatDate,
		formatDateTimeFields,
		formatMonthYear,
		formatTimestampLocal,
		getMonthKey
	} from '$lib/formatDate';
	import { userDisplayName } from '$lib/supabase/queries';
	import {
		filterExpandedMonths,
		loadExpandedMonths,
		saveExpandedMonths
	} from '$lib/incidentMonthExpand';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import {
		incidentsFromPageData,
		syncIncidentStoreFromPageData
	} from '$lib/syncIncidentStore';
	import {
		backfillIncidentsFromSubjects,
		type SubjectBackfillResult
	} from '$lib/parseSubjectsBackfill';
	import { resolveIncidentLocation } from '$lib/parseEmailSubjectLocation';
	import {
		TIME_RANGE_OPTIONS,
		formatMonthYearLabel,
		isDateReceivedInTimeRange,
		isMonthTimeRange,
		type MonthTimeRangeKey,
		type TimeRangeKey
	} from '$lib/dashboardPeriod.svelte';
	import {
		getDuplicateIncidentIds,
		isLaterSameReferenceRow,
		sharesReferenceWithOther
	} from '$lib/incidentDuplicates';

	let { data } = $props();

	/** URL / filter sentinels for empty category fields */
	const DRIVER_FILTER_UNASSIGNED = '__unassigned__';
	const TYPE_FILTER_UNSPECIFIED = '__unspecified__';
	const RESPONDED_BY_FILTER_UNASSIGNED = '__unassigned__';

	const incidents = $derived(incidentsFromPageData(incidentStore.list, data.incidents));

	// Sync before paint so browser refresh doesn't stick on the loading state
	$effect.pre(() => {
		syncIncidentStoreFromPageData(data.supabase, data.incidents);
	});

	let isRefreshing = $state(false);
	let refreshError = $state<string | null>(null);
	let isParsingSubjects = $state(false);
	let parseSubjectsError = $state<string | null>(null);
	let parseSubjectsResult = $state<SubjectBackfillResult | null>(null);

	/**
	 * Parse email subjects → DB (fill empty fields only).
	 * Runs in the background after Refresh; stats appear in the result banner.
	 */
	async function runParseSubjectsBackfill() {
		if (!data.supabase || isParsingSubjects) return;
		isParsingSubjects = true;
		try {
			const list = incidentStore.isInitialized ? incidentStore.list : incidents;
			const result = await backfillIncidentsFromSubjects({
				supabase: data.supabase,
				incidents: list,
				incidentTypes: data.incidentTypes ?? [],
				drivers: data.drivers ?? [],
				userId: data.user?.id,
				fillOnlyEmpty: true
			});
			parseSubjectsResult = result;
			parseSubjectsError = null;
			await invalidateAll();
			await incidentStore.reload();
		} catch (err) {
			parseSubjectsError = err instanceof Error ? err.message : 'Subject parse failed';
			parseSubjectsResult = null;
		} finally {
			isParsingSubjects = false;
		}
	}

	/**
	 * Reload page data, then run parse subjects → DB in the background.
	 * Post-run stats appear in the existing result banner.
	 */
	async function handleRefresh() {
		isRefreshing = true;
		refreshError = null;
		try {
			await invalidateAll();
			await incidentStore.reload();
		} catch (err) {
			refreshError = err instanceof Error ? err.message : 'Refresh failed';
			isRefreshing = false;
			return;
		}
		isRefreshing = false;
		void runParseSubjectsBackfill();
	}

	let search = $state('');
	let filterType = $state('');
	let filterDriver = $state('');
	let filterTeamLeader = $state('');
	let filterAction = $state('');
	/** Responded By (incident.response); sentinel = null/blank. */
	let filterRespondedBy = $state('');
	/** Only incidents with no manual suburb and no parseable subject location. */
	let filterMissingMapLocation = $state(false);
	/** Date Received column: newest-first (desc) by default; click header to toggle. */
	let dateReceivedSort: 'asc' | 'desc' = $state('desc');

	/**
	 * Active dashboard drill-down (deep link). When set, list shows a context
	 * banner. Cleared when the user clears filters or dismisses the banner.
	 * Pattern: URL query params + contextual filter banner (analytics standard).
	 */
	let drillSource = $state<string | null>(null);
	/** Last applied search string from the URL (avoid re-clobbering user edits). */
	let appliedDrillKey = $state('');

	function isValidListPeriod(value: string): value is TimeRangeKey {
		return (
			value === 'all' ||
			value === 'today' ||
			value === 'week' ||
			value === '7' ||
			value === '30' ||
			value === '90' ||
			isMonthTimeRange(value)
		);
	}

	function applyUrlFiltersFromSearch(searchStr: string) {
		if (searchStr === appliedDrillKey) return;
		appliedDrillKey = searchStr;
		const params = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr);

		const hasDrillParams =
			params.has('driver') ||
			params.has('type') ||
			params.has('period') ||
			params.has('drill');

		// Clean URL (e.g. after Clear drill-down) — do not leave stale drill filters on
		if (!hasDrillParams) {
			drillSource = null;
			return;
		}

		const driver = params.get('driver');
		if (driver !== null) {
			filterDriver = driver === '' ? DRIVER_FILTER_UNASSIGNED : driver;
		}

		const type = params.get('type');
		if (type !== null) {
			filterType = type === '' ? TYPE_FILTER_UNSPECIFIED : type;
		}

		const period = params.get('period');
		if (period && isValidListPeriod(period)) {
			filterDateRange = period;
		}

		const drill = params.get('drill');
		drillSource = drill && drill.trim() ? drill.trim() : null;
	}

	// Deep-link filters from dashboard (and any future sources)
	$effect(() => {
		applyUrlFiltersFromSearch(page.url.search);
	});

	function drillDriverLabel(): string {
		if (filterDriver === DRIVER_FILTER_UNASSIGNED || !filterDriver) return 'Unassigned';
		return filterDriver;
	}

	function drillTypeLabel(): string {
		if (filterType === TYPE_FILTER_UNSPECIFIED || !filterType) return 'Unspecified';
		return filterType;
	}

	function drillPeriodLabel(): string {
		const relative = TIME_RANGE_OPTIONS.find((o) => o.value === filterDateRange);
		if (relative) return relative.label;
		if (isMonthTimeRange(filterDateRange)) {
			return formatMonthYearLabel(filterDateRange.slice(2));
		}
		return filterDateRange;
	}

	/** Reset list to unfiltered full view after leaving a dashboard drill-down. */
	function resetListAfterDrillDown() {
		// Mark the current drill URL as already handled so it cannot re-apply mid-nav
		appliedDrillKey = page.url.search;
		drillSource = null;
		filterDriver = '';
		filterType = '';
		filterDateRange = 'all';
		// Open every month group so records are not hidden under collapsed accordions
		expandedMonths = new Set(allMonthKeys);
	}

	function clearDrillDown() {
		resetListAfterDrillDown();
		void goto('/', { replaceState: true, keepFocus: true, noScroll: true });
	}

	function clearDrillDownAndGoDashboard() {
		resetListAfterDrillDown();
		void goto('/dashboard');
	}

	function toggleDateReceivedSort() {
		dateReceivedSort = dateReceivedSort === 'desc' ? 'asc' : 'desc';
	}
	/**
	 * Date received period — same shape as dashboard Period picker
	 * (relative ranges + months that have data). Independent of dashboard store.
	 */
	let filterDateRange = $state<TimeRangeKey>('all');

	// Admin/CRUD state (moved from admin page)
	let mode = $state<'list' | 'add' | 'edit'>('list');
	/** Incident editor: modal overlay vs inline full-width (not month table accordion below). */
	let isFormExpanded = $state(false);
	let editingIncident = $state<Incident | undefined>(undefined);
	let deleteConfirmId = $state<string | null>(null);
	let showDiscardModal = $state(false);
	let addIncidentBtn = $state<HTMLButtonElement | undefined>(undefined);
	let backToListBtn = $state<HTMLButtonElement | undefined>(undefined);
	let modalCloseBtn = $state<HTMLButtonElement | undefined>(undefined);
	/** Toast after copying a duplicate ref for search */
	let copyToast = $state<string | null>(null);
	let copyToastTimer: ReturnType<typeof setTimeout> | null = null;
	/** Busy id while saving duplicate_exempt override */
	let dupeToggleBusyId = $state<string | null>(null);

	async function copyDupeRef(ref: string, event: MouseEvent) {
		event.stopPropagation();
		event.preventDefault();
		const text = ref.trim();
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Fallback when clipboard API is blocked
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand('copy');
			} finally {
				document.body.removeChild(ta);
			}
		}
		if (copyToastTimer) clearTimeout(copyToastTimer);
		copyToast = `Copied ${text} to clipboard`;
		copyToastTimer = setTimeout(() => {
			copyToast = null;
			copyToastTimer = null;
		}, 2000);
	}

	const isModalOpen = $derived(mode !== 'list' && !isFormExpanded);

	/** Months that have at least one incident (newest first) — period picker optgroup. */
	const listAvailableMonths = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const i of incidents) {
			const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(i.dateReceived?.trim() ?? '');
			if (!m) continue;
			const ym = `${m[1]}-${m[2]}`;
			counts.set(ym, (counts.get(ym) ?? 0) + 1);
		}
		return [...counts.entries()]
			.sort(([a], [b]) => b.localeCompare(a))
			.map(([ym, count]) => ({
				ym,
				count,
				value: `m:${ym}` as MonthTimeRangeKey
			}));
	});

	function onDateRangeChange(event: Event) {
		const el = event.currentTarget;
		if (!(el instanceof HTMLSelectElement)) return;
		const next = el.value;
		if (
			next === 'all' ||
			next === 'today' ||
			next === 'week' ||
			next === '7' ||
			next === '30' ||
			next === '90' ||
			isMonthTimeRange(next)
		) {
			filterDateRange = next as TimeRangeKey;
		}
	}

	// If selected month no longer has data, fall back to all time
	$effect(() => {
		if (!isMonthTimeRange(filterDateRange)) return;
		const ym = filterDateRange.slice(2);
		if (listAvailableMonths.length === 0) return;
		if (!listAvailableMonths.some((m) => m.ym === ym)) {
			filterDateRange = 'all';
		}
	});

	const filtered = $derived.by(() => {
		let result = incidents.filter((i) => {
			const q = search.toLowerCase();
			if (
				q &&
				!i.referenceNo.toLowerCase().includes(q) &&
				!i.referenceText.toLowerCase().includes(q) &&
				!(i.driver ?? '').toLowerCase().includes(q) &&
				!(i.type ?? '').toLowerCase().includes(q) &&
				!i.response.toLowerCase().includes(q) &&
				!(i.emailSubject ?? '').toLowerCase().includes(q) &&
				!(i.emailSender ?? '').toLowerCase().includes(q)
			)
				return false;
			if (filterType === TYPE_FILTER_UNSPECIFIED) {
				if ((i.type ?? '').trim()) return false;
			} else if (filterType && i.type !== filterType) {
				return false;
			}
			if (filterDriver === DRIVER_FILTER_UNASSIGNED) {
				// Null/blank driver only (not a username literally named "Unassigned")
				if ((i.driver ?? '').trim()) return false;
			} else if (filterDriver && i.driver !== filterDriver) {
				return false;
			}
			if (filterTeamLeader && i.teamLeader !== filterTeamLeader) return false;
			if (filterAction && i.action !== filterAction) return false;
			if (filterRespondedBy === RESPONDED_BY_FILTER_UNASSIGNED) {
				if ((i.response ?? '').trim()) return false;
			} else if (filterRespondedBy && (i.response ?? '') !== filterRespondedBy) {
				return false;
			}
			// Missing map: has a ref but no usable suburb/street (no-ref rows excluded)
			if (
				filterMissingMapLocation &&
				(!i.referenceNo?.trim() || resolveIncidentLocation(i))
			)
				return false;

			if (!isDateReceivedInTimeRange(i.dateReceived, filterDateRange)) return false;

			return true;
		});

		// Date Received + time; direction from column header toggle
		result.sort((a, b) => {
			const aKey = `${a.dateReceived}T${a.time}`;
			const bKey = `${b.dateReceived}T${b.time}`;
			return dateReceivedSort === 'desc'
				? bKey.localeCompare(aKey)
				: aKey.localeCompare(bKey);
		});

		return result;
	});

	/** Has ref but no usable map location (no-ref rows excluded). */
	const missingMapLocationCount = $derived(
		incidents.filter((i) => i.referenceNo?.trim() && !resolveIncidentLocation(i)).length
	);

	/**
	 * Ids that are true duplicates only:
	 * same reference as an earlier row, and not marked “Not a duplicate” (duplicate_exempt).
	 * Badge must not show for unique refs, the earliest original, or exempted rows.
	 */
	const duplicateRefIds = $derived(getDuplicateIncidentIds(incidents));
	const isDuplicateRow = $derived.by(() => {
		const map: Record<string, true> = Object.create(null);
		for (const id of duplicateRefIds) map[id] = true;
		return map;
	});

	function clearFilters() {
		search = '';
		filterType = '';
		filterDriver = '';
		filterTeamLeader = '';
		filterAction = '';
		filterRespondedBy = '';
		filterMissingMapLocation = false;
		filterDateRange = 'all';
		if (drillSource || page.url.search) {
			drillSource = null;
			appliedDrillKey = '';
			void goto('/', { replaceState: true, keepFocus: true, noScroll: true });
		}
	}

	const hasFilters = $derived(
		Boolean(
			search ||
				filterType ||
				filterDriver ||
				filterTeamLeader ||
				filterAction ||
				filterRespondedBy ||
				filterMissingMapLocation ||
				filterDateRange !== 'all' ||
				drillSource
		)
	);

	type MonthGroup = {
		key: string;
		label: string;
		incidents: Incident[];
	};

	const groupedByMonth = $derived.by((): MonthGroup[] => {
		const groups = new Map<string, Incident[]>();

		for (const incident of filtered) {
			const key = getMonthKey(incident.dateReceived);
			const list = groups.get(key);
			if (list) {
				list.push(incident);
			} else {
				groups.set(key, [incident]);
			}
		}

		const sortedKeys = [...groups.keys()].sort((a, b) => {
			if (a === 'unknown') return 1;
			if (b === 'unknown') return -1;
			// Month groups follow Date Received sort (desc = newest month first)
			return dateReceivedSort === 'desc' ? b.localeCompare(a) : a.localeCompare(b);
		});

		return sortedKeys.map((key) => ({
			key,
			label: formatMonthYear(key),
			incidents: groups.get(key)!
		}));
	});

	const mostRecentMonthKey = $derived.by(() => {
		const keys = groupedByMonth.map((g) => g.key).filter((k) => k !== 'unknown');
		if (keys.length === 0) {
			return groupedByMonth.some((g) => g.key === 'unknown') ? 'unknown' : null;
		}
		return keys.reduce((a, b) => (a > b ? a : b));
	});

	/** All month keys from unfiltered data — used for persistence pruning, not search/filter UI. */
	const allMonthKeys = $derived.by(() => {
		const keys = new Set<string>();
		for (const incident of incidents) {
			keys.add(getMonthKey(incident.dateReceived));
		}
		return keys;
	});

	/**
	 * Month-group accordion (unrelated to isFormExpanded).
	 * - `null` = no user override yet → default expand most recent month
	 * - `Set` (incl. empty) = explicit override; empty means all months collapsed
	 */
	let expandedMonths = $state<Set<string> | null>(null);
	let prevMonthKeysStr = '';
	let expandedMonthsHydrated = false;

	$effect(() => {
		if (typeof window === 'undefined') return;

		const currentKeys = allMonthKeys;
		const keysStr = [...currentKeys].sort().join('|');

		if (!expandedMonthsHydrated) {
			expandedMonthsHydrated = true;
			prevMonthKeysStr = keysStr;
			const filtered = filterExpandedMonths(loadExpandedMonths(), currentKeys);
			// null = no stored preference; empty/non-empty Set = explicit preference
			if (filtered !== null) expandedMonths = filtered;
			return;
		}

		if (keysStr === prevMonthKeysStr) return;
		prevMonthKeysStr = keysStr;

		if (expandedMonths !== null) {
			// Keep explicit preference (including all-collapsed empty Set)
			const filtered = [...expandedMonths].filter((k) => currentKeys.has(k));
			expandedMonths = new Set(filtered);
			saveExpandedMonths(filtered);
		} else {
			const filtered = filterExpandedMonths(loadExpandedMonths(), currentKeys);
			if (filtered !== null) expandedMonths = filtered;
		}
	});

	function isMonthExpanded(key: string): boolean {
		// Drill-down from dashboard: expand every month group so all matching rows are visible
		if (drillSource) return true;
		if (expandedMonths !== null) {
			return expandedMonths.has(key);
		}
		// Default before any user toggle: most recent month open
		return key === mostRecentMonthKey;
	}

	function toggleMonth(key: string) {
		// Materialize defaults on first interaction so collapsing the last open
		// month can yield an empty Set (all collapsed) instead of resetting to null.
		const current =
			expandedMonths ?? new Set(mostRecentMonthKey ? [mostRecentMonthKey] : []);
		const next = new Set(current);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		expandedMonths = next;
		saveExpandedMonths(next);
	}

	const TABLE_COLUMN_COUNT = 11;

	function resetModalState() {
		showDiscardModal = false;
		isFormExpanded = false;
	}

	async function focusIncidentDialog() {
		await tick();
		if (!isFormExpanded) {
			modalCloseBtn?.focus();
		}
	}

	async function openAdd() {
		resetModalState();
		incidentStore.clearError();
		editingIncident = undefined;
		mode = 'add';
		await focusIncidentDialog();
	}

	// CRUD handlers (moved from admin page)
	async function startEdit(incident: Incident) {
		resetModalState();
		incidentStore.clearError();
		editingIncident = incident;
		mode = 'edit';
		await focusIncidentDialog();
	}

	async function handleSubmit(incident: Incident): Promise<boolean> {
		const audit = {
			userId: data.user?.id ?? null,
			userName: userDisplayName(data.user ?? data.session?.user)
		};
		if (mode === 'edit' && editingIncident) {
			const id = editingIncident.id;
			const success = await incidentStore.update(id, incident, audit);
			if (success) {
				// Keep the modal open; refresh props so Last updated / list stay in sync.
				const refreshed = incidentStore.list.find((i) => i.id === id);
				if (refreshed) editingIncident = refreshed;
			}
			return success;
		}
		const success = await incidentStore.add(incident, data.user?.id, audit);
		if (success) {
			closeModal();
		}
		return success;
	}

	async function handleDelete(id: string) {
		await incidentStore.delete(id);
		deleteConfirmId = null;
	}

	/**
	 * Mark / unmark a later same-reference row as a user-confirmed non-duplicate.
	 * Persists `duplicate_exempt` and refreshes list + open editor.
	 * `exempt: true` → Not a duplicate (untag). `exempt: false` → Tag as duplicate again.
	 */
	async function setDuplicateExempt(incident: Incident, exempt: boolean) {
		if (dupeToggleBusyId) return;
		dupeToggleBusyId = incident.id;
		incidentStore.clearError();
		try {
			const audit = {
				userId: data.user?.id ?? null,
				userName: userDisplayName(data.user ?? data.session?.user)
			};
			const next: Incident = { ...incident, duplicateExempt: exempt };
			const success = await incidentStore.update(incident.id, next, audit);
			if (success && editingIncident?.id === incident.id) {
				const refreshed = incidentStore.list.find((i) => i.id === incident.id);
				// Prefer store row; always keep the flag so Tag as duplicate stays available
				editingIncident = refreshed
					? { ...refreshed, duplicateExempt: Boolean(refreshed.duplicateExempt ?? exempt) }
					: next;
			}
		} finally {
			dupeToggleBusyId = null;
		}
	}

	function closeModal() {
		mode = 'list';
		editingIncident = undefined;
		showDiscardModal = false;
		isFormExpanded = false;
		tick().then(() => addIncidentBtn?.focus());
	}

	async function handleExpand() {
		isFormExpanded = true;
		await tick();
		backToListBtn?.focus();
	}

	function handleCancel(hasChanges: boolean) {
		if (hasChanges) {
			showDiscardModal = true;
		} else {
			closeModal();
		}
	}

	type IncidentFormHandle = {
		getHasUnsavedChanges: () => boolean;
		requestClose: () => void;
	};

	let incidentFormRef = $state<IncidentFormHandle | undefined>(undefined);

	function requestModalClose() {
		// When discard confirmation is open, dismiss it first instead of closing the editor.
		if (showDiscardModal) {
			showDiscardModal = false;
			return;
		}
		if (mode === 'list') return;
		incidentFormRef?.requestClose();
	}

	function handleDiscardBackdrop(e: MouseEvent) {
		if (e.target !== e.currentTarget) return;
		showDiscardModal = false;
	}

	function handleDiscardKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			showDiscardModal = false;
		}
	}

	function confirmDiscard() {
		closeModal();
	}

	function handleModalKeydownCapture(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		// Nested date/time pickers own Escape while open (portal mounted on body),
		// regardless of focus target (field, icon, or panel). Host must not requestClose.
		if (
			typeof document !== 'undefined' &&
			(document.querySelector('[data-time-picker-portal]') ||
				document.querySelector('[data-date-picker-portal]'))
		) {
			return;
		}
		const target = e.target;
		if (
			target instanceof HTMLInputElement &&
			(target.type === 'datetime-local' || target.type === 'date' || target.type === 'time')
		) {
			return;
		}
		if (showDiscardModal) {
			e.preventDefault();
			e.stopPropagation();
			showDiscardModal = false;
			return;
		}
		if (mode !== 'list') {
			e.preventDefault();
			e.stopPropagation();
			// requestClose also clears any open date/time popover state.
			incidentFormRef?.requestClose();
		}
	}
</script>

<svelte:head>
	<title>JCH Pham AusPost Incident Tracker | Australia Post</title>
</svelte:head>

<svelte:window onkeydowncapture={handleModalKeydownCapture} />

<div class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-warm-50 text-warm-900">
	{#if copyToast}
		<div
			class="pointer-events-none fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-warm-200 bg-warm-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg dark:border-warm-600 dark:bg-warm-100 dark:text-warm-900"
			role="status"
			aria-live="polite"
		>
			{copyToast}
		</div>
	{/if}
	<!-- List shell: inert under modal; visually hidden when form is expanded to full main pane -->
	<div
		class="flex min-h-0 flex-1 flex-col overflow-hidden {isFormExpanded ? 'invisible pointer-events-none' : ''}"
		inert={isModalOpen || isFormExpanded || undefined}
		aria-hidden={isFormExpanded || undefined}
	>
	<header
		class="incidents-list-header flex-shrink-0 border-b border-warm-200 bg-white/80 px-4 py-3 backdrop-blur sm:px-6 sm:py-4"
	>
		<div class="flex w-full min-w-0 items-start gap-3">
			<CourierTruckIcon />
			<div class="min-w-0">
				<h1 class="text-xl font-bold text-warm-800 sm:text-2xl">
					JCH Pham AusPost Incident Tracker
				</h1>
				{#if data.loadError}
					<p class="mt-1 text-sm text-red-600 font-medium">Unable to load incidents</p>
				{:else if incidentStore.error}
					<p class="mt-1 text-sm text-red-600 font-medium">{incidentStore.error}</p>
				{:else}
					<p class="mt-1 text-sm text-warm-500">
						{incidents.length} incidents recorded
					</p>
				{/if}
			</div>
		</div>
	</header>

	<!-- Filters -->
	{#if mode === 'list' && data.loadError}
		<div class="rounded-lg border border-red-200 bg-red-50 p-8 text-center m-6">
			<p class="text-red-600 mb-2 font-medium">⚠️ Unable to load incidents</p>
			<p class="text-red-600 mb-4 text-sm">{data.loadError}</p>
			{#if data.loadError.includes('migration')}
				<p class="text-sm text-warm-600 mb-4">
					Apply the listed SQL migration file in your Supabase project's SQL editor, then retry.
				</p>
			{/if}
			{#if refreshError}
				<p class="text-sm text-red-600 mb-4">{refreshError}</p>
			{/if}
			<button
				type="button"
				onclick={handleRefresh}
				disabled={isRefreshing}
				aria-label="Retry loading incidents"
				class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
			>
				{isRefreshing ? 'Retrying...' : 'Try Again'}
			</button>
		</div>
	{:else if mode === 'list' && incidentStore.isLoading}
		<div class="flex items-center justify-center py-12">
			<div class="flex flex-col items-center">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-warm-600"></div>
				<p class="mt-3 text-sm text-warm-500">Loading incidents from database...</p>
			</div>
		</div>
	{:else if mode === 'list' && incidentStore.error}
		<div class="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
			<p class="text-red-600 mb-4">⚠️ {incidentStore.error}</p>
			{#if refreshError}
				<p class="text-sm text-red-600 mb-4">{refreshError}</p>
			{/if}
			<button
				type="button"
				onclick={handleRefresh}
				disabled={isRefreshing}
				aria-label="Retry loading incidents"
				class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
			>
				{isRefreshing ? 'Retrying...' : 'Try Again'}
			</button>
		</div>
	{:else if mode === 'list'}
		{#if drillSource}
			<!-- Analytics pattern: contextual drill-down banner (deep-linked filters) -->
			<div
				class="mb-3 rounded-lg border border-accent-200 bg-accent-50 px-3 py-3 shadow-sm dark:border-accent-200/40 dark:bg-accent-100/25 sm:px-4"
				role="status"
				aria-live="polite"
			>
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0 flex-1">
						<p class="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-600">
							Drill-down from dashboard
						</p>
						<p class="mt-1 text-sm text-warm-800">
							{#if drillSource === 'driver-chart'}
								<span class="font-medium">Incidents by Driver</span>
								<span class="text-warm-500"> · </span>
							{/if}
							<span class="inline-flex flex-wrap items-center gap-1.5">
								<span
									class="inline-flex items-center rounded-md border border-accent-200 bg-white px-2 py-0.5 text-xs font-medium text-warm-800 dark:bg-warm-100"
								>
									Driver: {drillDriverLabel()}
								</span>
								<span
									class="inline-flex items-center rounded-md border border-accent-200 bg-white px-2 py-0.5 text-xs font-medium text-warm-800 dark:bg-warm-100"
								>
									Type: {drillTypeLabel()}
								</span>
								<span
									class="inline-flex items-center rounded-md border border-accent-200 bg-white px-2 py-0.5 text-xs font-medium text-warm-800 dark:bg-warm-100"
								>
									Period: {drillPeriodLabel()}
								</span>
							</span>
						</p>
						<p class="mt-1 text-xs text-warm-500">
							Filters below match this chart segment. Change them anytime, or clear the
							drill-down.
						</p>
					</div>
					<div class="flex shrink-0 flex-wrap items-center gap-2">
						<button
							type="button"
							onclick={clearDrillDownAndGoDashboard}
							class="touch-target-inline rounded-lg border border-warm-200 bg-white px-3 py-2 text-sm font-medium text-warm-700 transition hover:bg-warm-100 dark:bg-warm-100"
						>
							Back to dashboard
						</button>
						<button
							type="button"
							onclick={clearDrillDown}
							class="touch-target-inline rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
						>
							Clear drill-down
						</button>
					</div>
				</div>
			</div>
		{/if}
		<div
			class="incidents-filters shrink-0 rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4 {drillSource
				? 'ring-2 ring-accent-400/60 ring-offset-2 ring-offset-warm-50 dark:ring-offset-warm-100'
				: ''}"
		>
			<div class="incidents-filters-row flex flex-wrap items-stretch gap-2 sm:gap-2.5">
				<input
					type="text"
					placeholder="Search ref, driver, type..."
					bind:value={search}
					class="incidents-filter-ctrl touch-target-inline w-full min-w-[10rem] max-w-full flex-1 rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus sm:max-w-xs"
				/>
				<select
					bind:value={filterType}
					class="incidents-filter-ctrl touch-target-inline min-w-[7.5rem] flex-1 rounded-lg border border-warm-200 bg-warm-50 px-2.5 py-2 text-sm text-warm-700 input-focus uppercase sm:flex-none"
				>
					<option value="" class="normal-case">All Types</option>
					<option value={TYPE_FILTER_UNSPECIFIED} class="normal-case">Unspecified</option>
					{#if filterType && filterType !== TYPE_FILTER_UNSPECIFIED && !(data.incidentTypes ?? []).some((t) => t.name === filterType)}
						<option value={filterType} class="uppercase">{filterType}</option>
					{/if}
					{#each data.incidentTypes ?? [] as t}<option value={t.name} class="uppercase">{t.name}</option>{/each}
				</select>
				<select
					bind:value={filterDriver}
					class="incidents-filter-ctrl touch-target-inline min-w-[7.5rem] flex-1 rounded-lg border border-warm-200 bg-warm-50 px-2.5 py-2 text-sm text-warm-700 input-focus uppercase sm:flex-none"
				>
					<option value="" class="normal-case">All Drivers</option>
					<option value={DRIVER_FILTER_UNASSIGNED} class="normal-case">Unassigned</option>
					{#if filterDriver && filterDriver !== DRIVER_FILTER_UNASSIGNED && !(data.drivers ?? []).some((d) => d.username === filterDriver)}
						<option value={filterDriver} class="uppercase">{filterDriver}</option>
					{/if}
					{#each data.drivers ?? [] as d}<option value={d.username} class="uppercase">{d.username}</option>{/each}
				</select>
				<select
					bind:value={filterTeamLeader}
					class="incidents-filter-ctrl touch-target-inline min-w-[7.5rem] flex-1 rounded-lg border border-warm-200 bg-warm-50 px-2.5 py-2 text-sm text-warm-700 input-focus uppercase sm:flex-none"
				>
					<option value="" class="normal-case">All Team Leaders</option>
					{#each data.teamLeaders ?? [] as tl}<option value={tl.name} class="uppercase">{tl.name}</option>{/each}
				</select>
				<select
					bind:value={filterAction}
					class="incidents-filter-ctrl touch-target-inline min-w-[8rem] flex-1 rounded-lg border border-warm-200 bg-warm-50 px-2.5 py-2 text-sm text-warm-700 input-focus uppercase sm:flex-none"
				>
					<option value="" class="normal-case">All Resolution Statuses</option>
					{#each data.incidentActions ?? [] as a}<option value={a.name} class="uppercase">{a.name}</option>{/each}
				</select>
				<select
					bind:value={filterRespondedBy}
					class="incidents-filter-ctrl touch-target-inline min-w-[8rem] flex-1 rounded-lg border border-warm-200 bg-warm-50 px-2.5 py-2 text-sm text-warm-700 input-focus sm:flex-none"
					aria-label="Filter by Responded By"
					title="Filter by who responded (Responded By field)"
				>
					<option value="">All Responded By</option>
					<option value={RESPONDED_BY_FILTER_UNASSIGNED}>Unassigned</option>
					{#if filterRespondedBy && filterRespondedBy !== RESPONDED_BY_FILTER_UNASSIGNED && !(data.respondedByOptions ?? []).some((o) => o.name === filterRespondedBy)}
						<option value={filterRespondedBy}>{filterRespondedBy}</option>
					{/if}
					{#each data.respondedByOptions ?? [] as o (o.id)}
						<option value={o.name}>{o.name}</option>
					{/each}
				</select>
				<button
					type="button"
					onclick={() => (filterMissingMapLocation = !filterMissingMapLocation)}
					aria-pressed={filterMissingMapLocation}
					title="Incidents with a reference number but no suburb/street for the NSW map (blank ref excluded)"
					class="incidents-filter-ctrl touch-target-inline inline-flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm font-medium transition input-focus {filterMissingMapLocation
						? 'border-accent-500 bg-accent-50 text-accent-800 ring-1 ring-accent-400'
						: 'border-warm-200 bg-warm-50 text-warm-700 hover:bg-warm-100'}"
				>
					<span
						class="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-accent-500"
						aria-hidden="true"
					></span>
					Missing map location
					{#if missingMapLocationCount > 0}
						<span
							class="rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums {filterMissingMapLocation
								? 'bg-accent-600 text-white'
								: 'bg-warm-200 text-warm-700'}"
						>
							{missingMapLocationCount}
						</span>
					{/if}
				</button>
				<!-- Date received: same relative + months-with-data pattern as dashboard Period -->
				<label
					class="incidents-filter-date flex min-w-[9rem] flex-1 items-center gap-1.5 text-sm text-warm-600 sm:flex-none"
				>
					<span class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-warm-500"
						>Date received</span
					>
					<select
						value={filterDateRange}
						onchange={onDateRangeChange}
						class="incidents-filter-ctrl touch-target-inline max-w-[15rem] flex-1 rounded-lg border border-warm-200 bg-white px-2.5 py-2 text-sm text-warm-700 input-focus dark:bg-warm-200"
						aria-label="Filter by date received period"
						title="Relative period or a calendar month with incident data"
					>
						<optgroup label="Relative">
							{#each TIME_RANGE_OPTIONS as opt (opt.value)}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</optgroup>
						{#if listAvailableMonths.length > 0}
							<optgroup label="Months with data">
								{#each listAvailableMonths as m (m.value)}
									<option value={m.value}
										>{formatMonthYearLabel(m.ym)} ({m.count})</option
									>
								{/each}
							</optgroup>
						{/if}
					</select>
				</label>
				<button
					type="button"
					onclick={clearFilters}
					disabled={!hasFilters}
					aria-label="Clear all filters"
					class="incidents-filter-ctrl touch-target-inline rounded-lg border border-warm-200 bg-white px-3 py-2 text-sm font-medium text-warm-700 transition hover:bg-warm-100 input-focus disabled:cursor-not-allowed disabled:opacity-40 dark:bg-warm-100"
				>
					Clear filters
				</button>
			</div>
			<p class="incidents-filters-meta mt-2 text-xs text-warm-500 sm:text-sm">
				{filtered.length} {filtered.length === 1 ? 'incident' : 'incidents'} found
			</p>
		</div>
		<!-- Actions under filters: Add, Refresh (also runs parse subjects → DB) -->
		<div class="incidents-list-actions mt-2 flex flex-wrap items-center justify-start gap-2 px-1 sm:mt-3 sm:pl-[2ch]">
			<button
				type="button"
				bind:this={addIncidentBtn}
				onclick={openAdd}
				class="incidents-filter-ctrl touch-target-inline rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
			>
				+ Add Incident
			</button>
			<button
				type="button"
				onclick={handleRefresh}
				title="Refresh data, then parse subjects → DB in the background"
				aria-label="Refresh incidents data and parse email subjects"
				class="incidents-filter-ctrl inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-warm-200 bg-white p-2 text-warm-500 transition hover:border-warm-300 hover:text-warm-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-40"
				disabled={isRefreshing}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4 {isRefreshing ? 'animate-spin' : ''}"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
			</button>
		</div>
		{#if parseSubjectsResult}
			<div
				class="mx-6 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700/40 dark:bg-emerald-950/30 dark:text-emerald-100"
				role="status"
			>
				<p class="font-semibold">Subject parse complete</p>
				<p class="mt-1 text-xs leading-relaxed opacity-90">
					Scanned {parseSubjectsResult.scanned} · with subject {parseSubjectsResult.withSubject} ·
					parsed {parseSubjectsResult.parsed} ·
					<strong>updated {parseSubjectsResult.updated}</strong>
					· no change {parseSubjectsResult.skippedNoChanges}
					· no subject {parseSubjectsResult.skippedNoSubject}
					· unparseable {parseSubjectsResult.skippedNoParse}
				</p>
				{#if parseSubjectsResult.typesCreated.length}
					<p class="mt-1 text-xs">
						Types created: {parseSubjectsResult.typesCreated.join(', ')}
					</p>
				{/if}
				{#if parseSubjectsResult.driversCreated.length}
					<p class="mt-1 text-xs">
						Drivers created: {parseSubjectsResult.driversCreated.join(', ')}
					</p>
				{/if}
				{#if parseSubjectsResult.errors.length}
					<p class="mt-1 text-xs text-red-700 dark:text-red-300">
						Errors ({parseSubjectsResult.errors.length}): {parseSubjectsResult.errors
							.slice(0, 5)
							.join('; ')}{parseSubjectsResult.errors.length > 5 ? '…' : ''}
					</p>
				{/if}
				<button
					type="button"
					class="mt-2 text-xs font-medium text-emerald-800 underline hover:no-underline dark:text-emerald-200"
					onclick={() => (parseSubjectsResult = null)}
				>
					Dismiss
				</button>
			</div>
		{/if}
		{#if parseSubjectsError}
			<div class="mx-6 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
				{parseSubjectsError}
				<button
					type="button"
					class="ml-2 text-xs underline"
					onclick={() => (parseSubjectsError = null)}
				>
					Dismiss
				</button>
			</div>
		{/if}
	{/if}

	<!-- Table Container - flex-fill remaining height (filters stay compact on tablet) -->
	{#if mode === 'list' && !data.loadError && !incidentStore.isLoading && !incidentStore.error}
	<div class="incidents-table-pane mt-2 flex min-h-0 flex-1 flex-col overflow-hidden px-1 sm:mt-3 sm:px-0">
		<div
			class="incidents-table-scroll scroll-touch min-h-0 flex-1 overflow-auto rounded-lg border border-warm-200 bg-white shadow-sm"
		>
			<table class="incidents-table w-full table-fixed text-left text-sm min-w-[1480px]">
				<colgroup>
					<!-- Ref fits article no. + DUPLICATE pill; date compact; space → email cols -->
					<col style="width: 7.25rem" />
					<col style="width: 5.44rem" />
					<col style="width: 5.5%" />
					<col style="width: 5%" />
					<col style="width: 7.5%" />
					<col style="width: 11.8%" />
					<col style="width: 21.8%" />
					<col style="width: 6.5%" />
					<col style="width: 9%" />
					<col style="width: 7.5%" />
					<col style="width: 7.5%" />
				</colgroup>
				<thead class="border-b border-warm-200 bg-warm-50 sticky top-0 z-10">
					<tr>
						<th class="px-2 py-3 font-medium text-warm-500 whitespace-nowrap">Ref No.</th>
						<th class="px-2 py-3 font-medium text-warm-500 whitespace-nowrap">
							<button
								type="button"
								onclick={toggleDateReceivedSort}
								class="inline-flex items-center gap-1 rounded-sm font-medium text-warm-500 hover:text-warm-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
								aria-label="Sort by date received, currently {dateReceivedSort === 'desc' ? 'newest first' : 'oldest first'}. Click to reverse."
								title={dateReceivedSort === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'}
							>
								Date Received
								<span class="inline-flex flex-col leading-none text-[0.65rem] text-warm-400" aria-hidden="true">
									<span class={dateReceivedSort === 'asc' ? 'text-accent-600' : ''}>▲</span>
									<span class={dateReceivedSort === 'desc' ? 'text-accent-600' : ''}>▼</span>
								</span>
							</button>
						</th>
						<th class="px-2 py-3 text-center font-medium text-warm-500 whitespace-nowrap">
							Resolution Status
						</th>
						<th class="px-2 py-3 text-center font-medium text-warm-500 whitespace-nowrap">
							Priority
						</th>
						<th class="px-3 py-3 text-center font-medium text-warm-500 whitespace-nowrap">Type</th>
						<th class="px-3 py-3 font-medium text-warm-500 whitespace-nowrap">Email Sender</th>
						<th class="px-3 py-3 font-medium text-warm-500">Email Subject</th>
						<th class="px-3 py-3 font-medium text-warm-500 whitespace-nowrap">Driver</th>
						<th class="px-3 py-3 font-medium text-warm-500 whitespace-nowrap">Responded By</th>
						<th class="px-3 py-3 font-medium text-warm-500 whitespace-nowrap">Date Responded</th>
						<th class="px-3 py-3 font-medium text-warm-500 whitespace-nowrap text-right">Record Actions</th>
					</tr>
				</thead>
				<tbody class="[&_td]:align-top">
					{#each groupedByMonth as group (group.key)}
						<tr class="border-b border-warm-200 bg-accent-100">
							<td colspan={TABLE_COLUMN_COUNT} class="p-0">
								<button
									type="button"
									onclick={() => toggleMonth(group.key)}
									aria-expanded={isMonthExpanded(group.key)}
									aria-controls="month-group-{group.key}"
									aria-label="{isMonthExpanded(group.key) ? 'Collapse' : 'Expand'} {group.label}, {group.incidents.length} {group.incidents.length === 1 ? 'incident' : 'incidents'}"
									class="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-warm-800 transition-colors hover:bg-accent-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4 shrink-0 text-accent-700 transition-transform {isMonthExpanded(group.key) ? 'rotate-90' : ''}"
										viewBox="0 0 20 20"
										fill="currentColor"
										aria-hidden="true"
									>
										<path
											fill-rule="evenodd"
											d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
											clip-rule="evenodd"
										/>
									</svg>
									<span>
										{group.label}
										<span class="font-normal text-warm-600">
											({group.incidents.length} {group.incidents.length === 1 ? 'incident' : 'incidents'})
										</span>
									</span>
								</button>
							</td>
						</tr>
						{#if isMonthExpanded(group.key)}
							{#each group.incidents as incident, index (incident.id)}
								<tr
									id={index === 0 ? `month-group-${group.key}` : undefined}
									class="border-b border-warm-100 last:border-0 {index % 2 === 1 ? 'bg-warm-100/60 dark:bg-warm-200' : 'bg-white'} hover:bg-warm-200/50 dark:hover:bg-warm-300/50"
								>
									<td class="px-2 py-3 font-mono text-xs align-top" style="overflow: visible">
										{#if incident.referenceNo?.trim()}
											<div class="flex flex-col items-start gap-1" style="overflow: visible">
												<button
													type="button"
													onclick={() => startEdit(incident)}
													title="Edit incident {incident.referenceNo}"
													aria-label="Edit incident {incident.referenceNo}"
													class="max-w-full cursor-pointer break-all text-left text-accent-600 hover:text-accent-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-50 dark:focus-visible:ring-offset-warm-200"
												>
													{incident.referenceNo}
												</button>
												{#if isDuplicateRow[incident.id]}
													<button
														type="button"
														onclick={(e) => copyDupeRef(incident.referenceNo, e)}
														class="inline-flex shrink-0 cursor-pointer items-center rounded border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-amber-950 shadow-sm transition hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-500 dark:bg-amber-900/70 dark:text-amber-50 dark:hover:bg-amber-800"
														title="Copy reference number to clipboard for search"
														aria-label="Copy duplicate reference {incident.referenceNo} to clipboard"
													>
														DUPLICATE
													</button>
												{/if}
											</div>
										{:else}
											<button
												type="button"
												onclick={() => startEdit(incident)}
												title="Edit incident (NO REF)"
												aria-label="Edit incident with no reference number"
												class="block w-full max-w-full cursor-pointer truncate whitespace-nowrap text-left text-amber-600 hover:underline dark:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-50 dark:focus-visible:ring-offset-warm-200"
											>
												NO REF
											</button>
										{/if}
									</td>
									<td
										class="px-2 py-3 text-xs whitespace-nowrap overflow-hidden text-ellipsis {!incident.referenceNo?.trim()
											? 'text-amber-600 dark:text-amber-400'
											: 'text-warm-700'}"
										title={formatDateTimeFields(incident.dateReceived, incident.time) ||
											formatDate(incident.dateReceived)}
									>
										{formatDateTimeFields(incident.dateReceived, incident.time) ||
											formatDate(incident.dateReceived)}
									</td>
									<td class="px-2 py-3 text-center max-w-0 overflow-hidden">
										{#if incident.referenceNo?.trim() && incident.action?.trim()}
											<span
												class="inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase {getActionPillClass(
													incident.action
												)}"
												title={incident.action}
											>
												{incident.action}
											</span>
										{:else}
											<span class="text-warm-300">—</span>
										{/if}
									</td>
									<td class="px-2 py-3 text-center whitespace-nowrap overflow-hidden">
										{#if incident.referenceNo?.trim() && incident.marked?.trim()}
											<span
												class="inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase {getPriorityPillClass(
													incident.marked
												)}"
												title={normalizePriority(incident.marked)}
											>
												{normalizePriority(incident.marked)}
											</span>
										{:else}
											<span class="text-warm-300">—</span>
										{/if}
									</td>
									<td class="px-3 py-3 text-center max-w-0 overflow-hidden">
										{#if incident.type?.trim()}
											<span
												class="inline-block max-w-full break-words whitespace-normal rounded-full px-2.5 py-0.5 text-xs font-medium border uppercase {getTypePillClass(
													incident.type
												)}"
												title={incident.type}
											>
												{incident.type}
											</span>
										{:else}
											<span class="text-warm-300">—</span>
										{/if}
									</td>
									<td
										class="px-3 py-3 whitespace-normal break-all text-xs {!incident.referenceNo?.trim()
											? 'text-amber-600 dark:text-amber-400'
											: 'text-warm-600'}"
									>
										{incident.emailSender || ''}
									</td>
									<td
										class="px-3 py-3 whitespace-normal break-words text-xs {!incident.referenceNo?.trim()
											? 'text-amber-600 dark:text-amber-400'
											: 'text-warm-600'}"
									>
										<span class="inline-flex max-w-full items-start gap-1.5">
											<span class="min-w-0 flex-1 break-words">{incident.emailSubject || ''}</span>
											{#if incident.referenceNo?.trim() && !resolveIncidentLocation(incident)}
												<span
													class="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border border-accent-300 bg-accent-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-700"
													title="No map location — open the incident and set suburb (street optional) under Map location"
													aria-label="Map location could not be detected"
												>
													<span
														class="inline-block h-2 w-2 rounded-full bg-accent-500"
														aria-hidden="true"
													></span>
													No map
												</span>
											{/if}
										</span>
									</td>
									<td class="px-4 py-3 whitespace-nowrap font-mono text-xs text-warm-700">{incident.driver}</td>
									<td class="px-4 py-3 whitespace-normal break-words text-warm-600 min-w-[8rem] max-w-xs">{incident.response}</td>
									<td class="px-4 py-3 whitespace-nowrap text-warm-500">
										{#if incident.dateResponse}
											{formatDate(incident.dateResponse)} {incident.timeResponse}
										{/if}
									</td>
									<td class="px-4 py-3 text-right whitespace-nowrap">
										{#if deleteConfirmId === incident.id}
											<span class="mr-2 text-xs text-red-600">Delete?</span>
											<button onclick={() => handleDelete(incident.id)}
												class="mr-1 px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded font-medium">Yes</button>
											<button onclick={() => (deleteConfirmId = null)}
												class="px-3 py-1 text-xs bg-warm-100 hover:bg-warm-200 text-warm-700 rounded">No</button>
										{:else}
											<span class="inline-flex flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap">
												{#if isDuplicateRow[incident.id]}
													<button
														type="button"
														disabled={dupeToggleBusyId === incident.id}
														onclick={() => setDuplicateExempt(incident, true)}
														title="Stop treating this row as a duplicate of the same reference"
														aria-label="Not a duplicate"
														class="shrink-0 px-2.5 py-1 text-sm font-medium rounded border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-600/50 dark:bg-amber-950/40 dark:text-amber-100"
													>
														{dupeToggleBusyId === incident.id ? '…' : 'Not Dupe'}
													</button>
												{:else if incident.duplicateExempt && sharesReferenceWithOther(incident, incidents)}
													<button
														type="button"
														disabled={dupeToggleBusyId === incident.id}
														onclick={() => setDuplicateExempt(incident, false)}
														title="Tag this row as a duplicate of the same reference again"
														aria-label="Tag as duplicate"
														class="shrink-0 px-2.5 py-1 text-sm font-medium rounded border border-amber-400 bg-white text-amber-900 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-600 dark:bg-warm-100 dark:text-amber-100"
													>
														{dupeToggleBusyId === incident.id ? '…' : 'Tag Dupe'}
													</button>
												{/if}
												<button
													type="button"
													onclick={() => (deleteConfirmId = incident.id)}
													class="shrink-0 px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded"
													>Delete</button
												>
											</span>
										{/if}
									</td>
								</tr>
							{/each}
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	{#if filtered.length === 0}
		<div class="mt-12 text-center">
			<p class="text-lg text-warm-400">No incidents match your filters.</p>
			<button onclick={clearFilters} class="mt-3 text-accent-600 hover:text-accent-700">Clear all filters</button>
		</div>
	{/if}
	{/if}
	</div>

	<!-- Add/Edit: single form instance — modal overlay or expanded inline (preserves form state) -->
	{#if mode !== 'list'}
		{#if !isFormExpanded}
			<button
				type="button"
				tabindex="-1"
				class="fixed inset-0 z-40 cursor-default border-0 bg-black/50 p-0"
				aria-label="Dismiss incident editor (click outside)"
				onclick={requestModalClose}
			></button>
		{/if}

		<div
			class={isFormExpanded
				? 'absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden bg-white'
				: 'pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4'}
		>
			<div
				class={isFormExpanded
					? 'flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-white'
					: 'pointer-events-auto flex h-[min(92dvh,75.5rem)] max-h-[92dvh] w-full min-h-0 max-w-4xl flex-col overflow-hidden rounded-lg border border-warm-200 bg-white shadow-2xl md:max-w-5xl'}
				onclick={(e) => {
					if (!isFormExpanded) e.stopPropagation();
				}}
				role={isFormExpanded ? 'region' : 'dialog'}
				aria-modal={isFormExpanded ? undefined : 'true'}
				aria-labelledby="incident-form-title"
			>
				<header
					class="flex shrink-0 items-center justify-between gap-4 border-b border-warm-200 bg-warm-50 px-4 py-3 sm:px-5 sm:py-2.5"
				>
					<div class="min-w-0">
						<h2 id="incident-form-title" class="truncate text-lg font-semibold text-warm-800">
							{mode === 'edit' ? 'Incident' : 'New Incident'}
							{#if editingIncident?.referenceNo?.trim()}
								<span class="ml-2 font-mono text-base font-normal text-accent-600">
									{editingIncident.referenceNo}
								</span>
							{/if}
						</h2>
						{#if mode !== 'edit'}
							<p class="mt-0.5 text-xs text-warm-500">Create a new incident record</p>
						{/if}
						{#if mode === 'edit' && editingIncident}
							{@const lastUpdated = formatTimestampLocal(editingIncident.updatedAt)}
							{@const lastBy = editingIncident.updatedByName?.trim()}
							{#if lastUpdated || lastBy}
								<p class="mt-1 text-xs text-warm-600" title="Last update recorded on this incident">
									<span class="font-medium text-warm-700">Last updated</span>
									{#if lastUpdated}
										<span class="tabular-nums"> {lastUpdated}</span>
									{/if}
									{#if lastBy}
										<span> · by {lastBy}</span>
									{:else if lastUpdated}
										<span class="text-warm-500"> · editor unknown</span>
									{/if}
								</p>
							{/if}
						{/if}
					</div>
					<div class="flex shrink-0 items-center gap-2">
						{#if isFormExpanded}
							<button
								bind:this={backToListBtn}
								type="button"
								onclick={requestModalClose}
								aria-label="Dismiss and return to incidents list"
								class="rounded-md border border-warm-200 bg-white px-3 py-1.5 text-sm text-warm-700 hover:bg-warm-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-200"
							>
								Back to list
							</button>
						{:else}
							<button
								type="button"
								onclick={handleExpand}
								aria-label="Expand incident details to main window"
								title="Expand to full screen"
								class="rounded-md border border-warm-200 bg-white p-2 text-warm-600 hover:bg-warm-100 hover:text-warm-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-200"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"
									/>
								</svg>
							</button>
							<button
								bind:this={modalCloseBtn}
								type="button"
								onclick={requestModalClose}
								aria-label="Close incident editor"
								title="Close"
								class="rounded-md border border-warm-200 bg-white p-2 text-warm-600 hover:bg-warm-100 hover:text-warm-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-200"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
							</button>
						{/if}
					</div>
				</header>

				{#if mode === 'edit' && editingIncident}
					{@const isTaggedDupe = duplicateRefIds.has(editingIncident.id)}
					{@const canSetDupeStatus = isLaterSameReferenceRow(editingIncident, incidents)}
					{@const dupeBusy = dupeToggleBusyId === editingIncident.id}
					{@const isDuplicate = isTaggedDupe}
					<div
						class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-warm-200 bg-warm-50/90 px-5 py-2.5 dark:bg-warm-100/40"
					>
						<span class="text-xs font-medium uppercase tracking-wide text-warm-600">
							Duplicate status
						</span>
						<fieldset
							class="m-0 min-w-0 border-0 p-0 disabled:opacity-60"
							disabled={dupeBusy || !canSetDupeStatus}
							title={canSetDupeStatus
								? 'Mark whether this later same-reference row is a duplicate'
								: 'Only later incidents that share a reference number can be marked as duplicates'}
						>
							<legend class="sr-only">Duplicate status</legend>
							<div
								class="inline-flex flex-wrap items-center gap-1 rounded-md border border-amber-300 bg-white p-1 dark:border-amber-600/50 dark:bg-warm-200"
								role="radiogroup"
								aria-label="Duplicate status"
								aria-disabled={!canSetDupeStatus || dupeBusy}
							>
								<label
									class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition {isDuplicate
										? 'bg-amber-200 text-amber-950 shadow-sm dark:bg-amber-800/70 dark:text-amber-50'
										: 'text-warm-700 hover:bg-amber-50 dark:text-warm-800 dark:hover:bg-amber-950/20'} {canSetDupeStatus &&
									!dupeBusy
										? 'cursor-pointer'
										: 'cursor-not-allowed'}"
								>
									<input
										type="radio"
										name="incident-duplicate-{editingIncident.id}"
										class="h-4 w-4 shrink-0 accent-amber-600"
										checked={isDuplicate}
										disabled={dupeBusy || !canSetDupeStatus}
										onchange={() => {
											if (!isDuplicate) void setDuplicateExempt(editingIncident!, false);
										}}
									/>
									<span>Duplicate</span>
								</label>
								<label
									class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition {!isDuplicate
										? 'bg-amber-200 text-amber-950 shadow-sm dark:bg-amber-800/70 dark:text-amber-50'
										: 'text-warm-700 hover:bg-amber-50 dark:text-warm-800 dark:hover:bg-amber-950/20'} {canSetDupeStatus &&
									!dupeBusy
										? 'cursor-pointer'
										: 'cursor-not-allowed'}"
								>
									<input
										type="radio"
										name="incident-duplicate-{editingIncident.id}"
										class="h-4 w-4 shrink-0 accent-amber-600"
										checked={!isDuplicate}
										disabled={dupeBusy || !canSetDupeStatus}
										onchange={() => {
											if (isDuplicate) void setDuplicateExempt(editingIncident!, true);
										}}
									/>
									<span>Not a duplicate</span>
								</label>
							</div>
						</fieldset>
						{#if dupeBusy}
							<span class="text-xs text-warm-500">Saving…</span>
						{:else if !canSetDupeStatus}
							<span class="text-xs text-warm-500">
								{#if !editingIncident.referenceNo?.trim()}
									Add a reference number shared with another incident to enable this.
								{:else if !sharesReferenceWithOther(editingIncident, incidents)}
									No other incident shares this reference.
								{:else}
									Earliest record for this reference (not a later duplicate).
								{/if}
							</span>
						{/if}
					</div>
				{/if}

				{#if incidentStore.error}
					<div class="shrink-0 border-b border-red-200 bg-red-50 px-5 py-3" role="alert">
						<p class="text-sm text-red-700">{incidentStore.error}</p>
					</div>
				{/if}

				<IncidentForm
					bind:this={incidentFormRef}
					incident={editingIncident}
					incidentTypes={data.incidentTypes ?? []}
					incidentActions={data.incidentActions ?? []}
					drivers={data.drivers ?? []}
					teamLeaders={data.teamLeaders ?? []}
					respondedByOptions={data.respondedByOptions ?? []}
					onSubmit={handleSubmit}
					onCancel={handleCancel}
					showTitle={false}
				/>
			</div>
		</div>
	{/if}

	<!-- Unsaved Changes Warning (outside main modal so it always stacks above) -->
	{#if showDiscardModal}
		<div
			class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
			onclick={handleDiscardBackdrop}
			role="button"
			tabindex="0"
			onkeydown={handleDiscardKeydown}
		>
			<div
				class="rounded-lg bg-white p-6 shadow-xl"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="discard-dialog-title"
			>
				<h3 id="discard-dialog-title" class="mb-2 text-lg font-semibold text-warm-800">Unsaved Changes</h3>
				<p class="mb-6 text-sm text-warm-600">You have unsaved changes. Are you sure you want to discard them?</p>
				<div class="flex justify-end gap-3">
					<button type="button" onclick={() => { showDiscardModal = false; }}
						class="rounded-lg border border-warm-200 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50">
						Keep Editing
					</button>
					<button type="button" onclick={confirmDiscard}
						class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
						Discard Changes
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/*
	 * Column separators on header only — short vertical ticks that do not
	 * touch the top/bottom horizontal header edges.
	 */
	:global(table.incidents-table) {
		border-collapse: separate;
		border-spacing: 0;
	}
	:global(table.incidents-table thead th) {
		position: relative;
	}
	:global(table.incidents-table thead th:not(:last-child)::after) {
		content: '';
		position: absolute;
		/* Inset from top/bottom so the rule doesn’t meet horizontal borders */
		top: 22%;
		bottom: 22%;
		right: 0;
		width: 1px;
		background-color: #bbbfc0; /* Vichy warm-300 */
		pointer-events: none;
	}
	:global(.dark table.incidents-table thead th:not(:last-child)::after) {
		background-color: #5a5c5e;
	}
</style>
