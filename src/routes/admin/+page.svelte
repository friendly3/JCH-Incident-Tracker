<script lang="ts">
	import { incidentStore } from '$lib/data/store.svelte';
	import type { Incident } from '$lib/data/incidents';
	import IncidentForm from '$lib/components/IncidentForm.svelte';
	import { getActionPillClass } from '$lib/pillClasses';
	import { formatDate } from '$lib/formatDate';

	// NOTE: Admin page is deprecated - functionality moved to main page (+page.svelte)
	// This page can be removed once confirmed working.
	let { data } = $props();

	// Admin page is deprecated — incidents list comes from layout data only
	// No server load, so store won't have data. Redirect users to main page.

	let mode = $state<'list' | 'add' | 'edit'>('list');
	let editingIncident = $state<Incident | undefined>(undefined);
	let searchQuery = $state('');
	let deleteConfirmId = $state<string | null>(null);

	const filtered = $derived(
		incidentStore.list.filter((i) => {
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			return i.referenceNo.toLowerCase().includes(q) || i.referenceText.toLowerCase().includes(q) || (i.driver ?? '').toLowerCase().includes(q) || (i.type ?? '').toLowerCase().includes(q);
		})
	);

	function startEdit(incident: Incident) {
		editingIncident = incident;
		mode = 'edit';
	}

	async function handleSubmit(incident: Incident) {
		let success = false;
		if (mode === 'edit' && editingIncident) {
			success = await incidentStore.update(editingIncident.id, incident);
		} else {
			success = await incidentStore.add(incident, data.user?.id);
		}
		if (success) {
			mode = 'list';
			editingIncident = undefined;
		}
	}

	async function handleDelete(id: string) {
		const success = await incidentStore.delete(id);
		if (success) await incidentStore.reload(data.user?.id);
		deleteConfirmId = null;
	}

	function handleCancel(_hasUnsavedChanges = false) {
		mode = 'list';
		editingIncident = undefined;
	}
</script>

<svelte:head>
	<title>Admin | Incident Tracker</title>
</svelte:head>

<div class="min-h-screen bg-warm-50 text-warm-900">
	<header class="border-b border-warm-200 bg-white/80 px-6 py-4 backdrop-blur">
		<div class="flex w-full items-center justify-between">
			<div>
				<a href="/" class="text-sm text-accent-600 hover:text-accent-700">&larr; Back to tracker</a>
				<h1 class="mt-1 text-2xl font-bold text-warm-800">Manage Incidents</h1>
			</div>
			{#if mode === 'list'}
				<div class="flex gap-2">
					<button onclick={() => { mode = 'add'; editingIncident = undefined; }}
						class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500">
						+ Add Incident
					</button>
				</div>
			{/if}
		</div>
	</header>

	<main class="w-full px-6 py-6">
		{#if mode === 'list'}
			<input
				type="text"
				placeholder="Search incidents..."
				bind:value={searchQuery}
				class="mb-4 w-full max-w-md rounded-lg border border-warm-200 bg-white px-4 py-2.5 text-sm text-warm-800 placeholder-warm-400 input-focus"
			/>

			<p class="mb-4 text-sm text-warm-500">{filtered.length} incidents</p>

			<div class="overflow-x-auto rounded-lg border border-warm-200 bg-white shadow-sm">
				<table class="w-full text-left text-sm">
					<thead class="border-b border-warm-200 bg-warm-50">
						<tr>
							<th class="px-4 py-3 font-medium text-warm-500">Date</th>
							<th class="px-4 py-3 font-medium text-warm-500">Type</th>
							<th class="px-4 py-3 font-medium text-warm-500">Ref No.</th>
							<th class="px-4 py-3 font-medium text-warm-500">Driver</th>
							<th class="px-4 py-3 font-medium text-warm-500">Action Status</th>
							<th class="px-4 py-3 font-medium text-warm-500 text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as incident (incident.id)}
							<tr class="border-b border-warm-100 last:border-0">
								<td class="px-4 py-3 whitespace-nowrap text-warm-700">{formatDate(incident.dateReceived)} {incident.time}</td>
								<td class="px-4 py-3">
									<span class="text-warm-800">{incident.type}</span>
									{#if incident.marked === 'High'}
										<span class="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">HIGH</span>
									{/if}
								</td>
								<td class="px-4 py-3 font-mono text-xs text-warm-600">{incident.referenceNo}</td>
								<td class="px-4 py-3 font-mono text-xs text-warm-700">{incident.driver}</td>
								<td class="px-4 py-3">
									{#if incident.action}
										<span class="inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium border uppercase {getActionPillClass(incident.action)}">
											{incident.action}
										</span>
									{:else}
										<span class="text-warm-300">-</span>
									{/if}
								</td>
								<td class="px-4 py-3 text-right">
									{#if deleteConfirmId === incident.id}
										<span class="mr-2 text-xs text-red-600">Delete?</span>
										<button onclick={() => handleDelete(incident.id)}
											class="mr-1 text-xs text-red-600 hover:text-red-800">Yes</button>
										<button onclick={() => (deleteConfirmId = null)}
											class="text-xs text-warm-400 hover:text-warm-800">No</button>
									{:else}
										<button onclick={() => startEdit(incident)}
											class="mr-3 text-sm text-accent-600 hover:text-accent-700">Edit</button>
										<button onclick={() => (deleteConfirmId = incident.id)}
											class="text-sm text-red-500 hover:text-red-700">Delete</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			{#if filtered.length === 0}
				<p class="mt-8 text-center text-warm-400">No incidents found.</p>
			{/if}
		{:else}
			<div
				class="mx-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-warm-200 bg-white shadow-sm"
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
					<button
						type="button"
						onclick={() => handleCancel()}
						aria-label="Return to incidents list"
						class="rounded-md border border-warm-200 bg-white px-3 py-1.5 text-sm text-warm-700 hover:bg-warm-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-200"
					>
						Back to list
					</button>
				</header>

				{#if incidentStore.error}
					<div class="shrink-0 border-b border-red-200 bg-red-50 px-5 py-3" role="alert">
						<p class="text-sm text-red-700">{incidentStore.error}</p>
					</div>
				{/if}

				<IncidentForm
					incident={editingIncident}
					incidentTypes={data.incidentTypes ?? []}
					incidentActions={data.incidentActions ?? []}
					drivers={data.drivers ?? []}
					teamLeaders={data.teamLeaders ?? []}
					onSubmit={handleSubmit}
					onCancel={handleCancel}
					showTitle={false}
					variant="shell"
				/>
			</div>
		{/if}
	</main>
</div>
