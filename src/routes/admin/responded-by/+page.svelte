<script lang="ts">
	import { supabase } from '$lib/supabase/client';
	import { createDb } from '$lib/supabase/queries';
	import type { RespondedByOption } from '$lib/data/incidents';

	let { data } = $props();

	let options = $state<RespondedByOption[]>(data.respondedByOptions ?? []);
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let confirmDeleteId = $state<string | null>(null);
	let showAdd = $state(false);
	let newName = $state('');
	let busy = $state(false);
	let formError = $state<string | null>(null);

	const db = createDb(supabase);

	$effect(() => {
		options = data.respondedByOptions ?? [];
	});

	async function refreshFromDb() {
		options = await db.getRespondedByOptions();
	}

	async function add() {
		formError = null;
		const name = newName.trim();
		if (!name) {
			formError = 'Name is required.';
			return;
		}
		busy = true;
		const created = await db.addRespondedBy(name);
		busy = false;
		if (!created) {
			formError = 'Could not add — name may already exist.';
			return;
		}
		newName = '';
		showAdd = false;
		await refreshFromDb();
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
		const ok = await db.updateRespondedBy(editingId, name);
		busy = false;
		if (!ok) {
			formError = 'Could not update — name may already exist.';
			return;
		}
		editingId = null;
		editName = '';
		await refreshFromDb();
	}

	async function deleteItem(id: string) {
		formError = null;
		busy = true;
		const ok = await db.deleteRespondedBy(id);
		busy = false;
		if (!ok) {
			formError = 'Could not delete this option.';
			return;
		}
		confirmDeleteId = null;
		await refreshFromDb();
	}

	async function reseedFromTeamLeaders() {
		formError = null;
		busy = true;
		await db.seedRespondedByFromTeamLeaders();
		busy = false;
		await refreshFromDb();
	}
</script>

<svelte:head>
	<title>Responded By | JCH Incident Tracker</title>
</svelte:head>

<div class="min-h-screen bg-warm-50 p-8">
	<div class="mx-auto max-w-4xl">
		<div class="mb-8 flex flex-wrap items-center gap-4">
			<div class="min-w-0 flex-1">
				<p class="text-sm text-warm-500">Configuration</p>
				<h1 class="text-3xl font-bold text-warm-800">Responded By</h1>
				<p class="mt-1 text-sm text-warm-500">
					Values for the Responded By dropdown on the incident form. Initial list is seeded from team
					leaders.
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="rounded-lg border border-warm-300 bg-white px-4 py-2 text-sm font-medium text-warm-700 hover:bg-warm-50 disabled:opacity-50"
					disabled={busy}
					onclick={reseedFromTeamLeaders}
					title="Add any missing team leader names to this list"
				>
					Sync from team leaders
				</button>
				<button
					type="button"
					class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-50"
					disabled={busy}
					onclick={() => {
						showAdd = true;
						formError = null;
					}}
				>
					+ Add
				</button>
			</div>
		</div>

		{#if data.loadError}
			<div class="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
				<p class="font-medium">Could not load Responded By options</p>
				<p class="mt-1">{data.loadError}</p>
				<p class="mt-2 text-xs">
					If the table is missing, run the SQL migration
					<code class="rounded bg-red-100 px-1">add_responded_by_lookup.sql</code> in Supabase.
				</p>
			</div>
		{/if}

		{#if formError}
			<div class="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
				{formError}
			</div>
		{/if}

		{#if showAdd}
			<div class="mb-6 rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
				<h2 class="mb-4 text-lg font-semibold text-warm-800">Add Responded By</h2>
				<div class="flex flex-wrap gap-3">
					<input
						bind:value={newName}
						class="min-w-[12rem] flex-1 rounded-lg border border-warm-200 px-4 py-2 text-sm input-focus"
						placeholder="Name (e.g. Jake Pham)"
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
			{#if options.length}
				<table class="w-full divide-y divide-warm-200 text-sm">
					<thead class="bg-warm-50">
						<tr>
							<th class="px-6 py-4 text-left font-medium text-warm-500">Name</th>
							<th class="px-6 py-4 text-right font-medium text-warm-500">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-warm-100">
						{#each options as item (item.id)}
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
										<div class="text-base text-warm-800">{item.name}</div>
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
					No Responded By values yet. Add one, or use <strong>Sync from team leaders</strong>.
				</p>
			{/if}
		</div>
	</div>
</div>
