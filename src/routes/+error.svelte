<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';

	const message = $derived(page.error?.message ?? 'An unexpected error occurred.');
	const isMigrationError = $derived(message.toLowerCase().includes('migration'));
	let isRetrying = $state(false);
	let retryError = $state<string | null>(null);

	async function handleRetry() {
		isRetrying = true;
		retryError = null;
		try {
			await invalidateAll();
		} catch (err) {
			retryError = err instanceof Error ? err.message : 'Retry failed';
		} finally {
			isRetrying = false;
		}
	}
</script>

<svelte:head>
	<title>Error | Incident Tracker</title>
</svelte:head>

<div class="flex flex-1 items-center justify-center bg-warm-50 p-6">
	<div class="max-w-lg rounded-lg border border-red-200 bg-red-50 p-8 text-center shadow-sm">
		<p class="text-sm font-medium uppercase tracking-wide text-red-500">{page.status}</p>
		<h1 class="mt-2 text-xl font-semibold text-red-700">Something went wrong</h1>
		<p class="mt-4 text-sm text-red-600">{message}</p>

		{#if isMigrationError}
			<p class="mt-4 text-sm text-warm-600">
				Open your Supabase project's SQL editor, run the migration file named in the message above,
				then retry below.
			</p>
		{/if}

		{#if retryError}
			<p class="mt-4 text-sm text-red-600">{retryError}</p>
		{/if}

		<div class="mt-6 flex flex-wrap items-center justify-center gap-3">
			<button
				type="button"
				onclick={handleRetry}
				disabled={isRetrying}
				aria-label="Retry loading this page"
				class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
			>
				{isRetrying ? 'Retrying...' : 'Try Again'}
			</button>
			<a
				href="/dashboard"
				class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
			>
				Back to Dashboard
			</a>
			<a
				href="/"
				class="rounded-lg border border-warm-200 bg-white px-4 py-2 text-sm text-warm-700 transition hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
			>
				View Incidents
			</a>
		</div>
	</div>
</div>