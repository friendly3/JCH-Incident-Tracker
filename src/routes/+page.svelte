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


	let { data } = $props();

	// Sync store whenever server data changes (initial load + after invalidateAll)
	$effect(() => {
		if (data.supabase) {
			incidentStore.syncFromServer(data.supabase, data.incidents ?? []);
		}
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

	const filtered = $derived.by(() => {
		let result = incidentStore.list.filter((i) => {
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
		for (const incident of incidentStore.list) {
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

	function openAdd() {
		resetModalState();
		editingIncident = undefined;
		mode = 'add';
	}

	// CRUD handlers (moved from admin page)
	function startEdit(incident: Incident) {
		resetModalState();
		editingIncident = incident;
		mode = 'edit';
	}

	async function handleSubmit(incident: Incident) {
		if (mode === 'edit' && editingIncident) {
			await incidentStore.update(editingIncident.id, incident);
		} else {
			await incidentStore.add(incident, data.user?.id);
		}
		closeModal();
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

	function handleBackdropClick(e: MouseEvent) {
		if (e.target !== e.currentTarget) return;
		requestModalClose();
	}

	function handleBackdropKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			requestModalClose();
		}
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
		if (target instanceof HTMLInputElement && target.type === 'datetime-local') {
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
	<header class="border-b border-warm-200 bg-white/80 px-6 py-5 backdrop-blur flex-shrink-0">
		<div class="mx-auto max-w-[1600px]">
			<div class="flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 class="text-2xl font-bold text-warm-800">JCH Pham AusPost Incident Tracker</h1>
					<p class="mt-1 text-sm text-warm-500">Australia Post incident management</p>
				</div>
				<div class="flex items-center gap-3">
					<button
						type="button"
						onclick={handleRefresh}
						disabled={isRefreshing}
						class="rounded-lg border border-warm-200 bg-white px-4 py-2 text-sm font-medium text-warm-700 hover:bg-warm-50 disabled:opacity-50"
					>
						{isRefreshing ? 'Refreshing…' : 'Refresh'}
					</button>
					{#if mode === 'list'}
						<button
							bind:this={addIncidentBtn}
							type="button"
							onclick={openAdd}
							class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
						>
							+ Add Incident
						</button>
					{/if}
				</div>
			</div>
			{#if refreshError}
				<p class="mt-2 text-sm text-red-600">{refreshError}</p>
			{/if}
		</div>
	</header>

	{#if mode !== 'list'}
		<div
			class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 {isFormExpanded ? '' : 'items-center'}"
			onclick={handleBackdropClick}
			role="button"
			tabindex="0"
			onkeydown={handleBackdropKeydown}
		>
			<div
				class="my-8 w-full rounded-lg bg-white shadow-xl {isFormExpanded ? 'max-w-[1600px]' : 'max-w-4xl'}"
				onclick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="incident-form-title"
				tabindex="-1"
			>
				<div class="flex items-center justify-between border-b border-warm-200 px-6 py-4">
					<h2 class="text-lg font-semibold text-warm-800">
						{mode === 'edit' ? 'Edit Incident' : 'Add Incident'}
					</h2>
					<div class="flex items-center gap-2">
						{#if !isFormExpanded}
							<button type="button" onclick={handleExpand}
								class="rounded-lg border border-warm-200 px-3 py-1.5 text-sm text-warm-600 hover:bg-warm-50">
								Expand
							</button>
						{:else}
							<button bind:this={backToListBtn} type="button" onclick={() => { isFormExpanded = false; }}
								class="rounded-lg border border-warm-200 px-3 py-1.5 text-sm text-warm-600 hover:bg-warm-50">
								Collapse
							</button>
						{/if}
					</div>
				</div>
				<div class="p-6">
					<IncidentForm
						bind:this={incidentFormRef}
						incident={editingIncident}
						incidentTypes={data.incidentTypes ?? []}
						incidentActions={data.incidentActions ?? []}
						drivers={data.drivers ?? []}
						teamLeaders={data.teamLeaders ?? []}
						onSubmit={handleSubmit}
						onCancel={handleCancel}
					/>
				</div>
			</div>
		</div>
	{:else}
	<div class="flex-1 overflow-auto">
		<div class="mx-auto max-w-[1600px] px-6 py-6">
		<!-- filters section continues - TRUNCATED FOR MCP TEST