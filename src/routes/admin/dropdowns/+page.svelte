<script lang="ts">
	import { supabase } from '$lib/supabase/client';
	import { createDb } from '$lib/supabase/queries';
	import type { IncidentType, IncidentAction, RespondedByOption } from '$lib/data/incidents';
	import { page } from '$app/state';

	type Tab = 'types' | 'actions' | 'respondedBy';

	let { data } = $props();

	const db = createDb(supabase);

	let currentTab = $state<Tab>(initialTab());
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let confirmDeleteId = $state<string | null>(null);
	let showAdd = $state(false);
	let newName = $state('');
	let busy = $state(false);
	let formError = $state<string | null>(null);

	let incidentTypes = $state<IncidentType[]>(data.incidentTypes ?? []);
	let incidentActions = $state<IncidentAction[]>(data.incidentActions ?? []);
	let respondedByOptions = $state<RespondedByOption[]>(data.respondedByOptions ?? []);

	$effect(() => {
		incidentTypes = data.incidentTypes ?? [];
		incidentActions = data.incidentActions ?? [];
		respondedByOptions = data.respondedByOptions ?? [];
	});

	function initialTab(): Tab {
		const q = page.url.searchParams.get('tab');
		if (q === 'actions' || q === 'respondedBy' || q === 'types') return q;
		return 'types';
	}

	function switchTab(tab: Tab) {
		currentTab = tab;
		editingId = null;
		editName = '';
		confirmDeleteId = null;
		showAdd = false;
		newName = '';
		formError = null;
	}

	function tabLabel(tab: Tab): string {
		if (tab === 'types') return 'Type';
		if (tab === 'actions') return 'Action Status';
		return 'Responded By';
	}

	function currentList(): { id: string; name: string }[] {
		if (currentTab === 'types') return incidentTypes;
		if (currentTab === 'actions') return incidentActions;
		return respondedByOptions;
	}

	function displayName(name: string): string {
		// Types & actions are stored uppercase; Responded By keeps natural casing
		return currentTab === 'respondedBy' ? name : name;
	}

	function nameClass(): string {
		return currentTab === 'respondedBy'
			? 'text-base text-warm-800'
			: 'font-mono text-lg uppercase text-warm-800';
	}

	async function refreshLists() {
		const [types, actions, responded] = await Promise.all([
			db.getIncidentTypes(),
			db.getIncidentActions(),
			db.getRespondedByOptions()
		]);
		incidentTypes = types;
		incidentActions = actions;
		respondedByOptions = responded;
	}

	async function add() {
		formError = null;
		const name = newName.trim();
		if (!name) {
			formError = 'Name is required.';
			return;
		}
		busy = true;
		try {
			if (currentTab === 'types') {
				const created = await db.addIncidentType(name);
				if (!created) {
					formError = 'Could not add type (it may already exist).';
					return;
				}
			} else if (currentTab === 'actions') {
				const created = await db.addIncidentAction(name);
				if (!created) {
					formError = 'Could not add action status (it may already exist).';
					return;
				}
			} else {
				const result = await db.addRespondedBy(name);
				if (!result.option) {
					formError = result.errorMessage || 'Could not add Responded By value.';
					return;
				}
			}
			newName = '';
			showAdd = false;
			await refreshLists();
		} finally {
			busy = false;
		}
	}

	async function updateItem() {
		if (!editingId) return;
		formError = null;
		const name = editName.trim();
		if (!name) {
			formError = 'Name is required.';
			return;
		}
		busy = true;
		try {
			if (currentTab === 'types') {
				const ok = await db.updateIncidentType(editingId, name);
				if (!ok) {
					formError = 'Could not update type.';
					return;
				}
			} else if (currentTab === 'actions') {
				const ok = await db.updateIncidentAction(editingId, name);
				if (!ok) {
					formError = 'Could not update action status.';
					return;
				}
			} else {
				const result = await db.updateRespondedBy(editingId, name);
				if (!result.ok) {
					formError = result.errorMessage || 'Could not update.';
					return;
				}
			}
			editingId = null;
			editName = '';
			await refreshLists();
		} finally {
			busy = false;
		}
	}

	async function deleteItem(id: string) {
		formError = null;
		busy = true;
		try {
			if (currentTab === 'types') {
				const ok = await db.deleteIncidentType(id);
				if (!ok) {
					formError = 'Could not delete type.';
					return;
				}
			} else if (currentTab === 'actions') {
				const ok = await db.deleteIncidentAction(id);
				if (!ok) {
					formError = 'Could not delete action status.';
					return;
				}
			} else {
				const result = await db.deleteRespondedBy(id);
				if (!result.ok) {
					formError = result.errorMessage || 'Could not delete this option.';
					return;
				}
			}
			confirmDeleteId = null;
			await refreshLists();
		} finally {
			busy = false;
		}
	}

	async function reseedFromTeamLeaders() {
		formError = null;
		busy = true;
		try {
			await db.seedRespondedByFromTeamLeaders();
			await refreshLists();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Dropdowns | JCH Incident Tracker</title>
</svelte:head>

<div class="min-h-screen bg-warm-50 p-8">
	<div class="mx-auto max-w-4xl">
		<div class="mb-6">
			<p class="text-sm text-warm-500">Configuration</p>
			<h1 class="text-3xl font-bold text-warm-800">Manage Dropdown Values</h1>
			<p class="mt-1 text-sm text-warm-500">
				Incident Types, Action Statuses, and Responded By options used on the incident form.
			</p>
		</div>

		{#if data.loadError}
			<div class="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
				<p class="font-medium">Could not load some dropdown data</p>
				<p class="mt-1">{data.loadError}</p>
			</div>
		{/if}

		{#if formError}
			<div
				class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
				role="alert"
			>
				{formError}
			</div>
		{/if}

		<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
			<div class="tabs tabs-boxed flex flex-wrap">
				<button
					type="button"
					class="tab {currentTab === 'types' ? 'active' : ''}"
					onclick={() => switchTab('types')}
				>
					Incident Types
				</button>
				<button
					type="button"
					class="tab {currentTab === 'actions' ? 'active' : ''}"
					onclick={() => switchTab('actions')}
				>
					Action Statuses
				</button>
				<button
					type="button"
					class="tab {currentTab === 'respondedBy' ? 'active' : ''}"
					onclick={() => switchTab('respondedBy')}
				>
					Responded By
				</button>
			</div>
			<div class="flex flex-wrap gap-2">
				{#if currentTab === 'respondedBy'}
					<button
						type="button"
						class="rounded-lg border border-warm-300 bg-white px-4 py-2 text-sm font-medium text-warm-700 hover:bg-warm-50 disabled:opacity-50"
						disabled={busy}
						onclick={reseedFromTeamLeaders}
						title="Add any missing team leader names to this list"
					>
						Sync from team leaders
					</button>
				{/if}
				<button
					type="button"
					class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-50"
					disabled={busy}
					onclick={() => {
						showAdd = true;
						formError = null;
					}}
				>
					+ Add {tabLabel(currentTab)}
				</button>
			</div>
		</div>

		{#if currentTab === 'respondedBy'}
			<p class="mb-4 text-sm text-warm-500">
				Values for the <strong>Responded By</strong> dropdown on the incident form. Initial list is
				seeded from team leaders.
			</p>
		{/if}

		{#if showAdd}
			<div class="mb-6 rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
				<h2 class="mb-4 text-lg font-semibold text-warm-800">Add {tabLabel(currentTab)}</h2>
				<div class="flex flex-wrap gap-3">
					<input
						bind:value={newName}
						class="min-w-[12rem] flex-1 rounded-lg border border-warm-200 px-4 py-2 text-sm input-focus"
						placeholder={currentTab === 'respondedBy'
							? 'Name (e.g. Jake Pham)'
							: 'Enter name (e.g. NEW TYPE)'}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								add();
							}
						}}
					/>
					<button
						type="button"
						class="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
						disabled={busy}
						onclick={add}
					>
						Add
					</button>
					<button
						type="button"
						class="rounded-lg border border-warm-300 px-6 py-2 text-sm text-warm-700 hover:bg-warm-50"
						onclick={() => {
							showAdd = false;
							newName = '';
							formError = null;
						}}
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}

		<div class="rounded-lg border border-warm-200 bg-white shadow-sm">
			{#if currentList().length}
				<table class="w-full divide-y divide-warm-200 text-sm">
					<thead class="bg-warm-50">
						<tr>
							<th class="px-6 py-4 text-left font-medium text-warm-500">Name</th>
							<th class="px-6 py-4 text-right font-medium text-warm-500">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-warm-100">
						{#each currentList() as item (item.id)}
							<tr>
								<td class="px-6 py-4">
									{#if editingId === item.id}
										<input
											bind:value={editName}
											class="w-full rounded border border-warm-300 px-3 py-1.5 text-sm input-focus"
											onkeydown={(e) => {
												if (e.key === 'Enter') {
													e.preventDefault();
													updateItem();
												}
											}}
										/>
									{:else}
										<div class={nameClass()}>{displayName(item.name)}</div>
									{/if}
								</td>
								<td class="px-6 py-4 text-right whitespace-nowrap">
									{#if editingId === item.id}
										<button
											type="button"
											class="mr-3 rounded px-3 py-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"
											disabled={busy}
											onclick={updateItem}
										>
											Save
										</button>
										<button
											type="button"
											class="rounded px-3 py-1 text-xs font-medium text-gray-500 hover:text-gray-700"
											onclick={() => {
												editingId = null;
												editName = '';
											}}
										>
											Cancel
										</button>
									{:else}
										<button
											type="button"
											class="mr-3 rounded-lg border border-warm-300 px-3 py-1 text-sm font-medium text-accent-600 hover:bg-warm-50 hover:text-accent-700"
											onclick={() => {
												editingId = item.id;
												editName = item.name;
												formError = null;
											}}
										>
											Edit
										</button>
										{#if confirmDeleteId === item.id}
											<span class="mr-2 text-xs text-red-600">Confirm delete?</span>
											<button
												type="button"
												class="mr-1 rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
												disabled={busy}
												onclick={() => deleteItem(item.id)}
											>
												Yes
											</button>
											<button
												type="button"
												class="px-2 py-0.5 text-xs text-warm-600 hover:text-warm-800"
												onclick={() => (confirmDeleteId = null)}
											>
												No
											</button>
										{:else}
											<button
												type="button"
												class="rounded-lg border border-red-200 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
												onclick={() => (confirmDeleteId = item.id)}
											>
												Delete
											</button>
										{/if}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="p-8 text-center text-warm-500">
					{#if currentTab === 'types'}
						No incident types found.
					{:else if currentTab === 'actions'}
						No action statuses found.
					{:else}
						No Responded By values yet. Add one, or use <strong>Sync from team leaders</strong>.
					{/if}
				</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.tabs {
		border-bottom: 1px solid rgb(252 245 243 / 0.5);
	}
	.tab {
		position: relative;
		bottom: -1px;
		padding: 0.75rem 1.25rem;
		background: transparent;
		border: 1px solid rgb(252 245 243 / 0.5);
		border-bottom: none;
		font-weight: 500;
		color: rgb(120 113 108);
		cursor: pointer;
		transition: all 0.2s;
	}
	.tab:hover {
		color: rgb(68 64 60);
	}
	.tab.active {
		color: var(--color-accent-600, #038676);
		background: white;
		border-color: rgb(252 245 243 / 0.5);
		box-shadow: 0 -2px 4px rgb(0 0 0 / 0.05);
	}
</style>
