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
	let incidentDialogRef = $state<HTMLDivElement | undefined>(undefined);

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
			incidentDialogRef?.focus();
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

	function handleBackdropClick(e: MouseEvent) {
		if (e.target !== e.currentTarget) return;
		requestModalClose();
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

PLACEHOLDER_REST_OF_FILE