<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { navigating } from '$app/stores';
	import favicon from '$lib/assets/favicon.svg';
	import { APP_BUILT_AT, APP_COMMIT, APP_VERSION_FULL, APP_VERSION_LABEL } from '$lib/appVersion';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { isAuthPath, theme } from '$lib/theme.svelte';
	import '../app.css';

	let { children, data } = $props();

	let isNavOpen = $state(true);
	let showUserMenu = $state(false);

	function isConfigPath(path: string): boolean {
		return path === '/team' || path.startsWith('/admin/dropdowns');
	}

	let isConfigExpanded = $state(isConfigPath(page.url.pathname));

	const currentPath = $derived(page.url.pathname);
	const isConfigRoute = $derived(isConfigPath(currentPath));

	$effect(() => {
		const path = currentPath;
		if (isConfigPath(path)) {
			isConfigExpanded = true;
		}
	});

	function toggleConfigSection() {
		isConfigExpanded = !isConfigExpanded;
	}

	const isAuthRoute = $derived(isAuthPath(currentPath));

	$effect(() => {
		if (isAuthRoute) {
			theme.applyTransient('light');
			return;
		}
		return theme.init();
	});

	// Client-side auth guard - use session for reliability (data.session comes from server load)
	$effect(() => {
		if (typeof window !== 'undefined' && !data.session && !window.location.pathname.startsWith('/auth')) {
			goto('/auth', { replaceState: true });
		}
	});

	async function handleLogout() {
		try {
			const response = await fetch('/auth/logout', { method: 'POST', body: new FormData() })
			if (response.ok) {
				window.location.href = '/auth'
			} else {
				console.error('Logout failed')
				window.location.href = '/auth'
			}
		} catch (err) {
			console.error('Logout error:', err)
			window.location.href = '/auth'
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex h-screen overflow-hidden bg-warm-50">
	{#if data.user}
	<!-- Collapsible Left Navigation -->
	<div class="flex flex-col border-r border-warm-200 bg-warm-100 dark:bg-warm-50 transition-all duration-300 {isNavOpen ? 'w-64' : 'w-24'}">
		<!-- Header with Hamburger -->
		<div class="flex items-center justify-between border-b border-warm-200 px-4 py-4">
			{#if isNavOpen}
				<div class="font-semibold text-warm-800">Menu</div>
			{/if}
			<div class="flex items-center gap-1">
				<ThemeToggle class="hover:!bg-warm-200 dark:hover:!bg-warm-300" />
				<button onclick={() => (isNavOpen = !isNavOpen)}
					class="rounded-lg p-2 text-warm-500 hover:bg-warm-200 hover:text-warm-700"
					aria-label="Toggle navigation"
					title="Toggle navigation">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Nav Content -->
		<div class="flex-1 overflow-auto p-3 text-sm">
			{#if isNavOpen}
				<nav class="space-y-1 text-warm-600">
					<a
						href="/dashboard"
						class="block rounded-lg px-3 py-2 transition {currentPath === '/dashboard'
							? 'bg-accent-100 text-accent-700 font-medium'
							: 'hover:bg-warm-200'}"
					>
						Dashboard
					</a>
					<a
						href="/"
						class="block rounded-lg px-3 py-2 transition {currentPath === '/'
							? 'bg-accent-100 text-accent-700 font-medium'
							: 'hover:bg-warm-200'}"
					>
						Incidents
					</a>
					<div>
						<button
							type="button"
							onclick={toggleConfigSection}
							aria-expanded={isConfigExpanded}
							aria-controls="nav-configuration"
							aria-label="{isConfigExpanded ? 'Collapse' : 'Expand'} Configuration section"
							class="flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left transition hover:bg-warm-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 {isConfigRoute
								? 'text-warm-800 font-medium'
								: ''}"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4 shrink-0 text-warm-500 transition-transform {isConfigExpanded ? 'rotate-90' : ''}"
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
							Configuration
						</button>
						<div
							id="nav-configuration"
							class="ml-3 mt-1 space-y-1 border-l border-warm-200 pl-2"
							class:hidden={!isConfigExpanded}
						>
							<a
								href="/team"
								class="block rounded-lg px-3 py-2 transition {currentPath === '/team' || currentPath.startsWith('/team/')
									? 'bg-accent-100 text-accent-700 font-medium'
									: 'hover:bg-warm-200'}"
							>
								Team
							</a>
							<a
								href="/admin/dropdowns"
								class="block rounded-lg px-3 py-2 transition {currentPath.startsWith('/admin/dropdowns')
									? 'bg-accent-100 text-accent-700 font-medium'
									: 'hover:bg-warm-200'}"
							>
								Dropdowns
							</a>
						</div>
					</div>
				</nav>
			{:else}
				<nav class="flex flex-col items-center gap-3 pt-4 text-xs text-warm-600 text-center">
					<a href="/dashboard" title="Dashboard" class="rounded-lg px-1 py-1 hover:bg-warm-200 hover:text-warm-800 transition">Dashboard</a>
					<a href="/" title="Incidents" class="rounded-lg px-1 py-1 hover:bg-warm-200 hover:text-warm-800 transition">Incidents</a>
					<span class="text-[10px] uppercase tracking-wider text-warm-400 font-medium" title="Configuration">Config</span>
					<a
						href="/team"
						title="Team"
						class="rounded-lg px-1 py-1 transition {currentPath === '/team' || currentPath.startsWith('/team/')
							? 'bg-accent-100 text-accent-700 font-medium'
							: 'hover:bg-warm-200 hover:text-warm-800'}"
					>
						Team
					</a>
					<a
						href="/admin/dropdowns"
						title="Dropdowns"
						class="rounded-lg px-1 py-1 transition {currentPath.startsWith('/admin/dropdowns')
							? 'bg-accent-100 text-accent-700 font-medium'
							: 'hover:bg-warm-200 hover:text-warm-800'}"
					>
						Dropdowns
					</a>
				</nav>
			{/if}
		</div>

		<!-- User Profile, Logout & build version -->
		{#if data.session?.user}
			<div class="border-t border-warm-200 p-3 space-y-2">
				{#if isNavOpen}
					<div class="px-3 py-2 text-xs text-warm-500 truncate" title={data.session.user.email}>
						{data.session.user.email}
					</div>
					<button
						type="button"
						onclick={handleLogout}
						class="w-full rounded-lg px-3 py-2 text-left text-warm-600 hover:bg-warm-200 transition text-sm"
					>
						Logout
					</button>
					<p
						class="px-3 pt-1 text-[11px] leading-snug text-warm-400 tabular-nums"
						title={APP_BUILT_AT ? `${APP_VERSION_FULL} · built ${APP_BUILT_AT}` : APP_VERSION_FULL}
						aria-label={`Application version ${APP_VERSION_FULL}`}
					>
						<span class="font-medium text-warm-500">{APP_VERSION_LABEL}</span>
						<span class="block truncate">build {APP_COMMIT}</span>
					</p>
				{:else}
					<button
						type="button"
						onclick={handleLogout}
						title="Logout"
						class="w-full rounded-lg px-1 py-2 text-center text-xs text-warm-600 hover:bg-warm-200 hover:text-warm-800 transition"
					>
						Logout
					</button>
					<p
						class="px-0.5 text-center text-[10px] leading-tight text-warm-400 tabular-nums"
						title={APP_BUILT_AT ? `${APP_VERSION_FULL} · built ${APP_BUILT_AT}` : APP_VERSION_FULL}
						aria-label={`Application version ${APP_VERSION_FULL}`}
					>
						{APP_VERSION_LABEL}
					</p>
				{/if}
			</div>
		{/if}
	</div>
	{/if}

	<!-- Main Content Area -->
	<div class="flex-1 flex flex-col overflow-hidden">
		<!-- Loading Bar -->
		{#if $navigating}
			<div class="h-1 bg-gradient-to-r from-accent-500 via-accent-600 to-accent-500 animate-loading-bar"></div>
		{/if}
		{@render children()}
	</div>
</div>
