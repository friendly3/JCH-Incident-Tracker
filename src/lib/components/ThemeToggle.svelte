<script lang="ts">
	import { onMount } from 'svelte';
	import { theme } from '$lib/theme.svelte';

	let { class: className = '' } = $props();

	// Defer theme-dependent markup until after mount so SSR HTML matches hydration.
	let mounted = $state(false);

	onMount(() => {
		// Sync state only — layout $effect owns init() listener lifecycle.
		theme.sync();
		mounted = true;
	});
</script>

<button
	type="button"
	onclick={() => theme.toggle()}
	class="rounded-lg p-2 text-warm-500 transition hover:bg-warm-100 hover:text-warm-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-50 dark:hover:bg-warm-200 dark:hover:text-warm-800 dark:focus-visible:ring-offset-warm-100 {className}"
	aria-label={mounted ? (theme.isDark ? 'Switch to light mode' : 'Switch to dark mode') : 'Theme'}
	aria-pressed={mounted ? theme.isDark : undefined}
	title={mounted ? (theme.isDark ? 'Light mode' : 'Dark mode') : 'Theme'}
>
	{#if mounted}
		{#if theme.isDark}
			<!-- Sun icon -->
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
				/>
			</svg>
		{:else}
			<!-- Moon icon -->
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
				/>
			</svg>
		{/if}
	{:else}
		<!-- Placeholder icon: same dimensions, invisible until client init -->
		<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 invisible" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
			/>
		</svg>
	{/if}
</button>