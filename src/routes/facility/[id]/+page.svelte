<script lang="ts">
	import { page } from '$app/state';
	import { incidentStore } from '$lib/data/store.svelte';
	import { formatDate } from '$lib/formatDate';
	import { getPriorityPillClass, normalizePriority } from '$lib/pillClasses';

	const incident = $derived(incidentStore.list.find((i) => i.id === page.params.id));
	const priority = $derived(normalizePriority(incident?.marked));
</script>

<svelte:head>
	<title>{incident ? `Incident ${incident.referenceNo}` : 'Not Found'} | Incident Tracker</title>
</svelte:head>

<div class="min-h-screen bg-warm-50 text-warm-900">
	{#if incident}
		<header class="border-b border-warm-200 bg-white/80 px-6 py-4 backdrop-blur">
			<div class="mx-auto max-w-3xl">
				<a href="/" class="text-sm text-accent-600 hover:text-accent-700">&larr; Back to tracker</a>
			</div>
		</header>

		<main class="mx-auto max-w-3xl px-6 py-8">
			<div class="flex items-start justify-between">
				<div>
					<h1 class="text-2xl font-bold text-warm-800">{incident.type}</h1>
					{#if incident.referenceNo}
						<p class="mt-1 font-mono text-sm text-warm-500">Ref: {incident.referenceNo}</p>
					{/if}
				</div>
				{#if priority !== 'Normal'}
					<span
						class="rounded border px-2 py-1 text-sm font-semibold uppercase {getPriorityPillClass(
							incident.marked
						)}"
					>
						{priority} priority
					</span>
				{/if}
			</div>

			<div class="mt-6 space-y-4">
				<div class="rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
					<h2 class="text-sm font-medium text-warm-500">Reference Text</h2>
					<p class="mt-1 text-warm-800">{incident.referenceText || '-'}</p>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
						<h2 class="text-sm font-medium text-warm-500">Date Received</h2>
						<p class="mt-1 text-warm-800">{formatDate(incident.dateReceived)} at {incident.time}</p>
					</div>
					<div class="rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
						<h2 class="text-sm font-medium text-warm-500">Sender</h2>
						<p class="mt-1 text-warm-800">{incident.sender}</p>
					</div>
					<div class="rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
						<h2 class="text-sm font-medium text-warm-500">Team Leader</h2>
						<p class="mt-1 text-warm-800 uppercase">{incident.teamLeader}</p>
					</div>
					<div class="rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
						<h2 class="text-sm font-medium text-warm-500">Driver</h2>
						<p class="mt-1 font-mono text-warm-800">{incident.driver || '-'}</p>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
						<h2 class="text-sm font-medium text-warm-500">Response By</h2>
						<p class="mt-1 text-warm-800">{incident.response || '-'}</p>
					</div>
					<div class="rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
						<h2 class="text-sm font-medium text-warm-500">Response Date</h2>
						<p class="mt-1 text-warm-800">
							{#if incident.dateResponse}
								{formatDate(incident.dateResponse)} at {incident.timeResponse}
							{:else}
								-
							{/if}
						</p>
					</div>
				</div>

				<div class="rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
					<h2 class="text-sm font-medium text-warm-500">Action Status</h2>
					<p class="mt-1 text-warm-800">{incident.action || 'No action status recorded'}</p>
				</div>
			</div>
		</main>
	{:else}
		<main class="mx-auto max-w-3xl px-6 py-12 text-center">
			<h1 class="text-2xl font-bold text-warm-800">Incident not found</h1>
			<a href="/" class="mt-4 inline-block text-accent-600 hover:text-accent-700">Back to tracker</a>
		</main>
	{/if}
</div>
