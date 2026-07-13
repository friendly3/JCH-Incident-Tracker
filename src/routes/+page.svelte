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
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import {
		incidentsFromPageData,
		syncIncidentStoreFromPageData
	} from '$lib/syncIncidentStore';
	import {
		backfillIncidentsFromSubjects,
		type SubjectBackfillResult
	} from '$lib/parseSubjectsBackfill';

	let { data } = $props();

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
	let showParseConfirm = $state(false);

	async function handleRefresh() {
		isRefreshing = true;
		refreshError = null;
		try {
			await invalidateAll();
		} catch (err) {
			refreshError = err instanceof Error ? err.message : 'Refresh failed';
		} finally {
			isRefreshing = false;
		}
	}

	function openParseSubjectsConfirm() {
		parseSubjectsError = null;
		parseSubjectsResult = null;
		showParseConfirm = true;
	}

	function closeParseSubjectsConfirm() {
		if (isParsingSubjects) return;
		showParseConfirm = false;
	}

	/**
	 * Parse all email subjects, create missing types/drivers, write blank fields
	 * (ref / type / driver / map location) back to Supabase, then refresh.
	 */
	async function runParseSubjectsBackfill() {
		if (!data.supabase || isParsingSubjects) return;
		isParsingSubjects = true;
		parseSubjectsError = null;
		parseSubjectsResult = null;
		try {
			const result = await backfillIncidentsFromSubjects({
				supabase: data.supabase,
				incidents,
				incidentTypes: data.incidentTypes ?? [],
				drivers: data.drivers ?? [],
				userId: data.user?.id,
				fillOnlyEmpty: true
			});
			parseSubjectsResult = result;
			// Reload list + lookup tables so new types/drivers appear in filters
			await invalidateAll();
			await incidentStore.reload();
			showParseConfirm = false;
		} catch (err) {
			parseSubjectsError = err instanceof Error ? err.message : 'Subject parse failed';
		} finally {
			isParsingSubjects = false;
		}
	}

	let search = $state('');
	let filterType = $state('');
	let filterDriver = $state('');
	let filterTeamLeader = $state('');
	let filterAction = $state('');
	/** Date received hierarchy: Year → Month → Day (filter, not sort). */
	let filterDateYear = $state('');
	let filterDateMonth = $state(''); // '01'..'12'
	let filterDateDay = $state(''); // '01'..'31'

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

	const isModalOpen = $derived(mode !== 'list' && !isFormExpanded);

	const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

	/** Unique years / months / days present in data for cascading selects. */
	const dateHierarchy = $derived.by(() => {
		const years = new Set<string>();
		const monthsByYear = new Map<string, Set<string>>();
		const daysByYearMonth = new Map<string, Set<string>>();

		for (const i of incidents) {
			const m = DATE_ONLY_RE.exec(i.dateReceived?.trim() ?? '');
			if (!m) continue;
			const [, y, mo, d] = m;
			years.add(y);
			let months = monthsByYear.get(y);
			if (!months) {
				months = new Set();
				monthsByYear.set(y, months);
			}
			months.add(mo);
			const ym = `${y}-${mo}`;
			let days = daysByYearMonth.get(ym);
			if (!days) {
				days = new Set();
				daysByYearMonth.set(ym, days);
			}
			days.add(d);
		}

		const yearOptions = [...years].sort((a, b) => b.localeCompare(a));
		const monthOptions = filterDateYear
			? [...(monthsByYear.get(filterDateYear) ?? [])].sort((a, b) => b.localeCompare(a))
			: [];
		const dayOptions =
			filterDateYear && filterDateMonth
				? [
						...(daysByYearMonth.get(`${filterDateYear}-${filterDateMonth}`) ?? [])
					].sort((a, b) => b.localeCompare(a))
				: [];

		return { yearOptions, monthOptions, dayOptions };
	});

	function monthLabel(mm: string): string {
		const n = parseInt(mm, 10);
		if (n < 1 || n > 12) return mm;
		return new Date(2000, n - 1, 1).toLocaleDateString('en-AU', { month: 'long' });
	}

	function onDateYearChange(event: Event) {
		const el = event.currentTarget;
		if (!(el instanceof HTMLSelectElement)) return;
		filterDateYear = el.value;
		// Cascade: clear more-specific levels when parent changes
		filterDateMonth = '';
		filterDateDay = '';
	}

	function onDateMonthChange(event: Event) {
		const el = event.currentTarget;
		if (!(el instanceof HTMLSelectElement)) return;
		filterDateMonth = el.value;
		filterDateDay = '';
	}

	function onDateDayChange(event: Event) {
		const el = event.currentTarget;
		if (!(el instanceof HTMLSelectElement)) return;
		filterDateDay = el.value;
	}

	const filtered = $derived.by(() => {
		let result = incidents.filter((i) => {
			const q = search.toLowerCase();
			if (
				q &&
				!i.referenceNo.toLowerCase().includes(q) &&
				!i.referenceText.toLowerCase().includes(q) &&
				!(i.driver ?? '').toLowerCase().includes(q) &&
				!(i.type ?? '').toLowerCase().includes(q) &&
				!i.response.toLowerCase().includes(q)
			)
				return false;
			if (filterType && i.type !== filterType) return false;
			if (filterDriver && i.driver !== filterDriver) return false;
			if (filterTeamLeader && i.teamLeader !== filterTeamLeader) return false;
			if (filterAction && i.action !== filterAction) return false;

			// Date received hierarchy (filter, not sort)
			if (filterDateYear || filterDateMonth || filterDateDay) {
				const m = DATE_ONLY_RE.exec(i.dateReceived?.trim() ?? '');
				if (!m) return false;
				const [, y, mo, d] = m;
				if (filterDateYear && y !== filterDateYear) return false;
				if (filterDateMonth && mo !== filterDateMonth) return false;
				if (filterDateDay && d !== filterDateDay) return false;
			}

			return true;
		});

		// Always newest-first within filtered set (list groups handle month order)
		result.sort((a, b) =>
			`${b.dateReceived}T${b.time}`.localeCompare(`${a.dateReceived}T${a.time}`)
		);

		return result;
	});

	function clearFilters() {
		search = '';
		filterType = '';
		filterDriver = '';
		filterTeamLeader = '';
		filterAction = '';
		filterDateYear = '';
		filterDateMonth = '';
		filterDateDay = '';
	}

	const hasFilters = $derived(
		Boolean(
			search ||
				filterType ||
				filterDriver ||
				filterTeamLeader ||
				filterAction ||
				filterDateYear ||
				filterDateMonth ||
				filterDateDay
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
			// Newest month groups first
			return b.localeCompare(a);
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

	async function handleSubmit(incident: Incident) {
		const audit = {
			userId: data.user?.id ?? null,
			userName: userDisplayName(data.user ?? data.session?.user)
		};
		let success = false;
		if (mode === 'edit' && editingIncident) {
			success = await incidentStore.update(editingIncident.id, incident, audit);
		} else {
			success = await incidentStore.add(incident, data.user?.id, audit);
		}
		if (success) {
			closeModal();
		}
	}

	async function handleDelete(id: string) {
		await incidentStore.delete(id);
		deleteConfirmId = null;
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
	<!-- List shell: inert under modal; visually hidden when form is expanded to full main pane -->
	<div
		class="flex min-h-0 flex-1 flex-col overflow-hidden {isFormExpanded ? 'invisible pointer-events-none' : ''}"
		inert={isModalOpen || isFormExpanded || undefined}
		aria-hidden={isFormExpanded || undefined}
	>
	<header class="border-b border-warm-200 bg-white/80 px-6 py-5 backdrop-blur flex-shrink-0">
		<div class="flex w-full min-w-0 items-start gap-3">
			<CourierTruckIcon />
			<div class="min-w-0">
				<h1 class="text-2xl font-bold text-warm-800">JCH Pham AusPost Incident Tracker</h1>
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
		<div class="rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
			<div class="flex flex-wrap gap-3">
				<input
					type="text"
					placeholder="Search ref, driver, type..."
					bind:value={search}
					class="w-full max-w-xs rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus"
				/>
				<select bind:value={filterType} class="rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus uppercase">
					<option value="" class="normal-case">All Types</option>
					{#each data.incidentTypes ?? [] as t}<option value={t.name} class="uppercase">{t.name}</option>{/each}
				</select>
				<select bind:value={filterDriver} class="rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus uppercase">
					<option value="" class="normal-case">All Drivers</option>
					{#each data.drivers ?? [] as d}<option value={d.username} class="uppercase">{d.username}</option>{/each}
				</select>
				<select bind:value={filterTeamLeader} class="rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus uppercase">
					<option value="" class="normal-case">All Team Leaders</option>
					{#each data.teamLeaders ?? [] as tl}<option value={tl.name} class="uppercase">{tl.name}</option>{/each}
				</select>
				<select bind:value={filterAction} class="rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus uppercase">
					<option value="" class="normal-case">All Action Statuses</option>
					{#each data.incidentActions ?? [] as a}<option value={a.name} class="uppercase">{a.name}</option>{/each}
				</select>
				<!-- Date Received hierarchy: Year → Month → Day (filters results) -->
				<div
					class="flex flex-wrap items-center gap-2 rounded-lg border border-warm-200 bg-warm-50 px-2 py-1.5"
					role="group"
					aria-label="Date received filter"
				>
					<span class="pl-1 text-xs font-medium uppercase tracking-wide text-warm-500">Date received</span>
					<select
						value={filterDateYear}
						onchange={onDateYearChange}
						class="rounded-md border border-warm-200 bg-white px-2 py-1.5 text-sm text-warm-700 input-focus dark:bg-warm-200"
						aria-label="Filter by year"
					>
						<option value="">All years</option>
						{#each dateHierarchy.yearOptions as y (y)}
							<option value={y}>{y}</option>
						{/each}
					</select>
					<select
						value={filterDateMonth}
						onchange={onDateMonthChange}
						disabled={!filterDateYear}
						class="rounded-md border border-warm-200 bg-white px-2 py-1.5 text-sm text-warm-700 input-focus disabled:cursor-not-allowed disabled:opacity-40 dark:bg-warm-200"
						aria-label="Filter by month"
					>
						<option value="">All months</option>
						{#each dateHierarchy.monthOptions as mo (mo)}
							<option value={mo}>{monthLabel(mo)}</option>
						{/each}
					</select>
					<select
						value={filterDateDay}
						onchange={onDateDayChange}
						disabled={!filterDateYear || !filterDateMonth}
						class="rounded-md border border-warm-200 bg-white px-2 py-1.5 text-sm text-warm-700 input-focus disabled:cursor-not-allowed disabled:opacity-40 dark:bg-warm-200"
						aria-label="Filter by day"
					>
						<option value="">All days</option>
						{#each dateHierarchy.dayOptions as d (d)}
							<option value={d}>{d}</option>
						{/each}
					</select>
				</div>
				<button
					type="button"
					onclick={clearFilters}
					disabled={!hasFilters}
					aria-label="Clear all filters"
					class="rounded-lg border border-warm-200 bg-white px-4 py-2 text-sm font-medium text-warm-700 transition hover:bg-warm-100 input-focus disabled:cursor-not-allowed disabled:opacity-40 dark:bg-warm-100"
				>
					Clear filters
				</button>
			</div>
			<p class="mt-3 text-sm text-warm-500">{filtered.length} {filtered.length === 1 ? 'incident' : 'incidents'} found</p>
		</div>
		<!-- Actions under filters: Add, Parse subjects, Refresh -->
		<div class="mt-3 flex flex-wrap items-center justify-start gap-2 pl-[2ch]">
			<button
				type="button"
				bind:this={addIncidentBtn}
				onclick={openAdd}
				class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
			>
				+ Add Incident
			</button>
			<div class="group relative inline-flex">
				<button
					type="button"
					onclick={openParseSubjectsConfirm}
					disabled={isParsingSubjects || incidents.length === 0}
					aria-label="Parse email subjects into incident fields"
					aria-describedby="parse-subjects-tooltip"
					class="rounded-lg border border-warm-200 bg-white px-3 py-2 text-sm font-medium text-warm-700 transition hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{isParsingSubjects ? 'Parsing subjects…' : 'Parse subjects → DB'}
				</button>
				<div
					id="parse-subjects-tooltip"
					role="tooltip"
					class="pointer-events-none absolute left-1/2 top-full z-40 mt-2 w-72 -translate-x-1/2 rounded-lg border border-warm-200 bg-warm-900 px-3 py-2 text-left text-xs leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-warm-600 dark:bg-warm-200 dark:text-warm-900"
				>
					<p class="font-semibold">Parse email subjects → database</p>
					<p class="mt-1 opacity-95">
						Reads each incident’s email subject and fills blank
						<strong class="font-semibold"> reference</strong>,
						<strong class="font-semibold"> type</strong>,
						<strong class="font-semibold"> driver</strong>, and
						<strong class="font-semibold"> map location</strong> fields.
						Creates missing types and drivers. Existing values are not overwritten.
					</p>
					<span
						class="absolute bottom-full left-1/2 -mb-px h-0 w-0 -translate-x-1/2 border-x-[6px] border-b-[6px] border-x-transparent border-b-warm-900 dark:border-b-warm-200"
						aria-hidden="true"
					></span>
				</div>
			</div>
			<button
				type="button"
				onclick={handleRefresh}
				title="Refresh data"
				aria-label="Refresh incidents data"
				class="rounded-lg border border-warm-200 bg-white p-2 text-warm-500 transition hover:border-warm-300 hover:text-warm-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-40"
				disabled={isRefreshing || isParsingSubjects}
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

	<!-- Table Container - scrollable body -->
	{#if mode === 'list' && !data.loadError && !incidentStore.isLoading && !incidentStore.error}
	<div class="flex-1 min-h-0 mt-4 overflow-hidden flex flex-col">
		<div
			class="incidents-table-scroll flex-1 overflow-auto rounded-lg border border-warm-200 bg-white shadow-sm"
			style="max-height: calc(100vh - 280px);"
		>
			<table class="w-full table-fixed text-left text-sm min-w-[1480px]">
				<colgroup>
					<col style="width: 10rem" />
					<col style="width: 8rem" />
					<col style="width: 7%" />
					<col style="width: 6.5%" />
					<col style="width: 8%" />
					<col style="width: 12%" />
					<col style="width: 13%" />
					<col style="width: 7%" />
					<col style="width: 10%" />
					<col style="width: 8%" />
					<col style="width: 8%" />
				</colgroup>
				<thead class="border-b border-warm-200 bg-warm-50 sticky top-0 z-10">
					<tr>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap w-[10rem]">Ref No.</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap w-[8rem]">
							Date Received
						</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap">Action Status</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap">Priority</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap">Type</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap">Email Sender</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap">Email Subject</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap">Driver</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap">Response</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap">Responded</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap text-right">Record Actions</th>
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
									<td class="px-4 py-3 font-mono text-xs max-w-0 overflow-hidden">
										{#if incident.referenceNo?.trim()}
											<button
												type="button"
												onclick={() => startEdit(incident)}
												title="Edit incident {incident.referenceNo}"
												aria-label="Edit incident {incident.referenceNo}"
												class="block w-full max-w-full cursor-pointer truncate text-left text-accent-600 hover:text-accent-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-50 dark:focus-visible:ring-offset-warm-200"
											>
												{incident.referenceNo}
											</button>
										{:else}
											<button
												type="button"
												onclick={() => startEdit(incident)}
												title="Edit incident (NO REF)"
												aria-label="Edit incident with no reference number"
												class="block w-full max-w-full cursor-pointer truncate text-left text-amber-600 hover:underline dark:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-50 dark:focus-visible:ring-offset-warm-200"
											>
												NO REF
											</button>
										{/if}
									</td>
									<td
										class="px-4 py-3 whitespace-nowrap overflow-hidden {!incident.referenceNo?.trim()
											? 'text-amber-600 dark:text-amber-400'
											: 'text-warm-700'}"
									>
										{formatDateTimeFields(incident.dateReceived, incident.time) ||
											formatDate(incident.dateReceived)}
									</td>
									<td class="px-4 py-3 max-w-[10rem]">
										{#if incident.action}
											<span class="inline-block max-w-full break-words whitespace-normal rounded-full px-3 py-0.5 text-xs font-medium border uppercase {getActionPillClass(incident.action)}">
												{incident.action}
											</span>
										{:else}
											<span class="text-warm-300">-</span>
										{/if}
									</td>
									<td class="px-4 py-3 whitespace-nowrap">
										<span
											class="inline-block rounded-full border px-3 py-0.5 text-xs font-medium uppercase {getPriorityPillClass(
												incident.marked
											)}"
										>
											{normalizePriority(incident.marked)}
										</span>
									</td>
									<td class="px-4 py-3 max-w-[12rem]">
										<span class="inline-block max-w-full break-words whitespace-normal rounded-full px-3 py-0.5 text-xs font-medium border uppercase {getTypePillClass(incident.type ?? '')}">
											{incident.type ?? ''}
										</span>
									</td>
									<td
										class="px-4 py-3 whitespace-normal break-all text-xs min-w-[10rem] max-w-[14rem] {!incident.referenceNo?.trim()
											? 'text-amber-600 dark:text-amber-400'
											: 'text-warm-600'}"
									>
										{incident.emailSender || ''}
									</td>
									<td
										class="px-4 py-3 whitespace-normal break-words text-xs min-w-[12rem] max-w-sm {!incident.referenceNo?.trim()
											? 'text-amber-600 dark:text-amber-400'
											: 'text-warm-600'}"
									>
										{incident.emailSubject || ''}
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
											<button type="button" onclick={() => startEdit(incident)}
												class="mr-2 px-3 py-1 text-sm bg-accent-100 hover:bg-accent-600 hover:text-white text-accent-700 rounded border border-accent-200">Edit</button>
											<button type="button" onclick={() => (deleteConfirmId = incident.id)}
												class="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded">Delete</button>
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
				: 'fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none'}
		>
			<div
				class={isFormExpanded
					? 'flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-white'
					: 'pointer-events-auto flex max-h-[92vh] w-full max-w-4xl min-h-0 flex-col overflow-hidden rounded-lg border border-warm-200 bg-white shadow-2xl'}
				onclick={(e) => {
					if (!isFormExpanded) e.stopPropagation();
				}}
				role={isFormExpanded ? 'region' : 'dialog'}
				aria-modal={isFormExpanded ? undefined : 'true'}
				aria-labelledby="incident-form-title"
			>
				<header
					class="flex shrink-0 items-center justify-between gap-4 border-b border-warm-200 bg-warm-50 px-5 py-2.5"
				>
					<div class="min-w-0">
						<h2 id="incident-form-title" class="truncate text-lg font-semibold text-warm-800">
							{mode === 'edit' ? 'Edit Incident' : 'New Incident'}
							{#if editingIncident?.referenceNo?.trim()}
								<span class="ml-2 font-mono text-base font-normal text-accent-600">
									{editingIncident.referenceNo}
								</span>
							{/if}
						</h2>
						<p class="mt-0.5 text-xs text-warm-500">
							{mode === 'edit' ? 'Update incident record' : 'Create a new incident record'}
						</p>
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

	<!-- Confirm bulk parse of email subjects → database -->
	{#if showParseConfirm}
		<div
			class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
			onclick={(e) => {
				if (e.target === e.currentTarget) closeParseSubjectsConfirm();
			}}
			role="presentation"
		>
			<div
				class="max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-warm-100"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="parse-subjects-title"
			>
				<h3 id="parse-subjects-title" class="mb-2 text-lg font-semibold text-warm-800">
					Parse email subjects → database
				</h3>
				<p class="mb-3 text-sm text-warm-600">
					For each incident with an email subject, this will:
				</p>
				<ul class="mb-4 list-disc space-y-1 pl-5 text-sm text-warm-600">
					<li>Extract <strong>reference number</strong>, <strong>type</strong>, <strong>driver</strong>, and <strong>map location</strong></li>
					<li>Fill only fields that are currently <strong>blank</strong> (existing values are kept)</li>
					<li><strong>Create</strong> any missing type or driver rows automatically</li>
				</ul>
				<p class="mb-6 text-xs text-warm-500">
					{incidents.length} incident{incidents.length === 1 ? '' : 's'} will be scanned. You can run this
					again safely.
				</p>
				{#if parseSubjectsError}
					<p class="mb-3 text-sm text-red-600">{parseSubjectsError}</p>
				{/if}
				<div class="flex justify-end gap-3">
					<button
						type="button"
						onclick={closeParseSubjectsConfirm}
						disabled={isParsingSubjects}
						class="rounded-lg border border-warm-200 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={runParseSubjectsBackfill}
						disabled={isParsingSubjects}
						class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-50"
					>
						{isParsingSubjects ? 'Running…' : 'Run parse'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
