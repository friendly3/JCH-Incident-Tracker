<script lang="ts">
	import { incidentStore } from '$lib/data/store.svelte';
	import type { Incident } from '$lib/data/incidents';
	import IncidentForm from '$lib/components/IncidentForm.svelte';
	import { getActionPillClass, getTypePillClass } from '$lib/pillClasses';
	import { formatDate, formatMonthYear, getMonthKey } from '$lib/formatDate';
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


	let { data } = $props();

	const incidents = $derived(incidentsFromPageData(incidentStore.list, data.incidents));

	// Sync before paint so browser refresh doesn't stick on the loading state
	$effect.pre(() => {
		syncIncidentStoreFromPageData(data.supabase, data.incidents);
	});

	let isRefreshing = $state(false);
	let refreshError = $state<string | null>(null);

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

	let search = $state('');
	let filterType = $state('');
	let filterDriver = $state('');
	let filterTeamLeader = $state('');
	let filterAction = $state('');
	let sortBy = $state<'date-desc' | 'date-asc'>('date-desc');

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

	const filtered = $derived.by(() => {
		let result = incidents.filter((i) => {
			const q = search.toLowerCase();
			if (q && !i.referenceNo.toLowerCase().includes(q) && !i.referenceText.toLowerCase().includes(q) && !(i.driver ?? '').toLowerCase().includes(q) && !(i.type ?? '').toLowerCase().includes(q) && !i.response.toLowerCase().includes(q)) return false;
			if (filterType && i.type !== filterType) return false;
			if (filterDriver && i.driver !== filterDriver) return false;
			if (filterTeamLeader && i.teamLeader !== filterTeamLeader) return false;
			if (filterAction && i.action !== filterAction) return false;
			return true;
		});

		result.sort((a, b) => {
			switch (sortBy) {
				case 'date-desc': return `${b.dateReceived}T${b.time}`.localeCompare(`${a.dateReceived}T${a.time}`);
				case 'date-asc': return `${a.dateReceived}T${a.time}`.localeCompare(`${b.dateReceived}T${b.time}`);
				default: return 0;
			}
		});

		return result;
	});

	function clearFilters() {
		search = '';
		filterType = '';
		filterDriver = '';
		filterTeamLeader = '';
		filterAction = '';
		sortBy = 'date-desc';
	}

	const hasFilters = $derived(search || filterType || filterDriver || filterTeamLeader || filterAction);

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
			return sortBy === 'date-desc' ? b.localeCompare(a) : a.localeCompare(b);
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

	/** Month-group accordion in incidents table (unrelated to isFormExpanded). null = defaults; Set = overrides. */
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
			if (filtered) expandedMonths = filtered;
			return;
		}

		if (keysStr === prevMonthKeysStr) return;
		prevMonthKeysStr = keysStr;

		if (expandedMonths !== null) {
			const filtered = [...expandedMonths].filter((k) => currentKeys.has(k));
			if (filtered.length > 0) {
				expandedMonths = new Set(filtered);
				saveExpandedMonths(filtered);
			} else {
				expandedMonths = null;
				saveExpandedMonths([]);
			}
		} else {
			const filtered = filterExpandedMonths(loadExpandedMonths(), currentKeys);
			if (filtered) expandedMonths = filtered;
		}
	});

	function isMonthExpanded(key: string): boolean {
		if (expandedMonths !== null) {
			return expandedMonths.has(key);
		}
		return key === mostRecentMonthKey;
	}

	function toggleMonth(key: string) {
		const current =
			expandedMonths ?? new Set(mostRecentMonthKey ? [mostRecentMonthKey] : []);
		const next = new Set(current);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		if (next.size === 0) {
			expandedMonths = null;
			saveExpandedMonths([]);
		} else {
			expandedMonths = next;
			saveExpandedMonths(next);
		}
	}

	const TABLE_COLUMN_COUNT = 10;

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
		let success = false;
		if (mode === 'edit' && editingIncident) {
			success = await incidentStore.update(editingIncident.id, incident);
		} else {
			success = await incidentStore.add(incident, data.user?.id);
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
			incidentFormRef?.requestClose();
		}
	}
</script>

<svelte:head>
	<title>JCH Pham AusPost Incident Tracker | Australia Post</title>
</svelte:head>

<svelte:window onkeydowncapture={handleModalKeydownCapture} />

<div class="flex-1 flex flex-col bg-warm-50 text-warm-900 overflow-hidden">
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden" inert={isModalOpen || undefined}>
	<header class="border-b border-warm-200 bg-white/80 px-6 py-5 backdrop-blur flex-shrink-0">
		<div class="mx-auto max-w-[1600px]">
			<div class="flex items-center justify-between">
				<div>
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
				{#if mode === 'list'}
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={handleRefresh}
							title="Refresh data"
							aria-label="Refresh incidents data"
							class="rounded-lg border border-warm-200 bg-white p-2 text-warm-500 hover:text-warm-800 hover:border-warm-300 transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
							disabled={isRefreshing}
						>
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 {isRefreshing ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
						</button>
						<button
							bind:this={addIncidentBtn}
							onclick={openAdd}
							class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 transition">
							+ Add Incident
						</button>
					</div>
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
					<option value="" class="normal-case">All Actions</option>
					{#each data.incidentActions ?? [] as a}<option value={a.name} class="uppercase">{a.name}</option>{/each}
				</select>
				<button onclick={() => { sortBy = sortBy === 'date-desc' ? 'date-asc' : 'date-desc'; }}
					class="rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-700 hover:bg-warm-100 input-focus flex items-center gap-1">
					<span>Date Received</span>
					<span class="text-xs">{sortBy === 'date-desc' ? '↓' : '↑'}</span>
				</button>
				{#if hasFilters}
					<button onclick={clearFilters} class="text-sm text-accent-600 hover:text-accent-700">Clear</button>
				{/if}
			</div>
			<p class="mt-3 text-sm text-warm-500">{filtered.length} {filtered.length === 1 ? 'incident' : 'incidents'} found</p>
		</div>
	{/if}

	<!-- Table Container - scrollable body -->
	{#if mode === 'list' && !data.loadError && !incidentStore.isLoading && !incidentStore.error}
	<div class="flex-1 min-h-0 mt-4 overflow-hidden flex flex-col">
		<div
			class="incidents-table-scroll flex-1 overflow-auto rounded-lg border border-warm-200 bg-white shadow-sm"
			style="max-height: calc(100vh - 280px);"
		>
			<table class="w-full table-fixed text-left text-sm min-w-[1400px]">
				<colgroup>
					<col style="width: 11rem" />
					<col style="width: 8.5rem" />
					<col style="width: 7%" />
					<col style="width: 9%" />
					<col style="width: 13%" />
					<col style="width: 14%" />
					<col style="width: 7%" />
					<col style="width: 11%" />
					<col style="width: 9%" />
					<col style="width: 9%" />
				</colgroup>
				<thead class="border-b border-warm-200 bg-warm-50 sticky top-0 z-10">
					<tr>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap w-[11rem]">Ref No.</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap w-[8.5rem]">
							<button onclick={() => { sortBy = sortBy === 'date-desc' ? 'date-asc' : 'date-desc'; }}
								class="inline-flex items-center gap-1 hover:text-warm-800 transition-colors">
								Date Received
								{#if sortBy === 'date-desc'}
									<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-accent-600" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
									</svg>
								{:else}
									<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-accent-600" viewBox="0 0 20 20" fill="currentColor">
										<path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" />
									</svg>
								{/if}
							</button>
						</th>
						<th class="px-4 py-3 font-medium text-warm-500 whitespace-nowrap">Action</th>
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
											<span class="text-warm-300">-</span>
										{/if}
									</td>
									<td class="px-4 py-3 whitespace-nowrap text-warm-700 overflow-hidden">{formatDate(incident.dateReceived)}</td>
									<td class="px-4 py-3 max-w-[10rem]">
										{#if incident.action}
											<span class="inline-block max-w-full break-words whitespace-normal rounded-full px-3 py-0.5 text-xs font-medium border uppercase {getActionPillClass(incident.action)}">
												{incident.action}
											</span>
										{:else}
											<span class="text-warm-300">-</span>
										{/if}
									</td>
									<td class="px-4 py-3 max-w-[12rem]">
										<span class="inline-flex flex-wrap items-center gap-1 max-w-full">
											{#if incident.marked === 'High'}
												<span class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">HIGH</span>
											{/if}
											<span class="inline-block max-w-full break-words whitespace-normal rounded-full px-3 py-0.5 text-xs font-medium border uppercase {getTypePillClass(incident.type ?? '')}">
												{incident.type ?? ''}
											</span>
										</span>
									</td>
									<td class="px-4 py-3 whitespace-normal break-all text-xs text-warm-600 min-w-[10rem] max-w-[14rem]">{incident.emailSender || ''}</td>
									<td class="px-4 py-3 whitespace-normal break-words text-xs text-warm-600 min-w-[12rem] max-w-sm">{incident.emailSubject || ''}</td>
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
				? 'flex flex-1 min-h-0 flex-col overflow-hidden bg-warm-100 px-4 py-5 sm:px-6'
				: 'fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none'}
		>
			<div
				class={isFormExpanded
					? 'mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col overflow-hidden rounded-lg border border-warm-200 bg-white shadow-sm'
					: 'pointer-events-auto flex max-h-[92vh] w-full max-w-4xl min-h-0 flex-col overflow-hidden rounded-lg border border-warm-200 bg-white shadow-2xl'}
				onclick={(e) => {
					if (!isFormExpanded) e.stopPropagation();
				}}
				role={isFormExpanded ? 'region' : 'dialog'}
				aria-modal={isFormExpanded ? undefined : 'true'}
				aria-labelledby="incident-form-title"
			>
				<header
					class="flex shrink-0 items-center justify-between gap-4 border-b border-warm-200 bg-warm-50 px-5 py-3.5"
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
