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

	/**
	 * Sidebar open by default on desktop; starts collapsed on tablet-sized viewports
	 * (portrait 11–13″ and narrow landscape) so content has room. User can always toggle.
	 */
	function preferredNavOpen(): boolean {
		if (typeof window === 'undefined') return true;
		try {
			// ~iPad portrait / compact tablet width — keep main pane wide
			if (window.matchMedia('(max-width: 1023px)').matches) return false;
			// Landscape tablet with limited height still benefits from more content width
			if (
				window.matchMedia('(orientation: portrait) and (max-width: 1180px)').matches
			) {
				return false;
			}
		} catch {
			/* ignore */
		}
		return true;
	}

	let isNavOpen = $state(true);
	let showUserMenu = $state(false);
	let navPreferenceApplied = $state(false);

	$effect(() => {
		if (typeof window === 'undefined' || navPreferenceApplied) return;
		// Apply preferred open state once on mount (don't fight the user after they toggle)
		navPreferenceApplied = true;
		isNavOpen = preferredNavOpen();
	});

	/** Format Supabase `last_sign_in_at` for the nav (local en-AU date + time). */
	function formatLastLoginAt(iso: string | undefined | null): string {
		if (!iso?.trim()) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleString('en-AU', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
			hour12: true
		});
	}

	const lastLoginLabel = $derived(
		formatLastLoginAt(data.session?.user?.last_sign_in_at ?? data.user?.last_sign_in_at)
	);

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
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="apple-touch-icon" href={favicon} />
</svelte:head>

<div class="flex h-dvh max-h-dvh overflow-hidden bg-warm-50 safe-pad-b">
	{#if data.user}
	<!-- Collapsible Left Navigation — icon rail when collapsed -->
	<div
		class="flex shrink-0 flex-col border-r border-warm-200 bg-warm-100 transition-[width] duration-300 dark:bg-warm-50 {isNavOpen
			? 'w-64'
			: 'w-14'}"
	>
		<!-- Header with Hamburger -->
		<div
			class="flex border-b border-warm-200 {isNavOpen
				? 'items-center justify-between px-3 py-3 sm:px-4 sm:py-4'
				: 'flex-col items-center gap-1 px-1 py-2'}"
		>
			{#if isNavOpen}
				<div class="font-semibold text-warm-800">Menu</div>
			{/if}
			<div class="flex items-center gap-1 {isNavOpen ? '' : 'flex-col'}">
				<ThemeToggle
					class="min-h-10 min-w-10 hover:!bg-warm-200 dark:hover:!bg-warm-300 {isNavOpen
						? 'min-h-11 min-w-11'
						: ''}"
				/>
				<button
					type="button"
					onclick={() => (isNavOpen = !isNavOpen)}
					class="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg p-2 text-warm-500 hover:bg-warm-200 hover:text-warm-700 {isNavOpen
						? 'min-h-11 min-w-11'
						: ''}"
					aria-label="Toggle navigation"
					aria-expanded={isNavOpen}
					title={isNavOpen ? 'Collapse menu' : 'Expand menu'}
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Nav Content -->
		<div class="scroll-touch flex-1 overflow-auto {isNavOpen ? 'p-2 text-sm sm:p-3' : 'p-1'}">
			{#if isNavOpen}
				<nav class="space-y-1 text-warm-600">
					<a
						href="/dashboard"
						class="flex min-h-11 items-center rounded-lg px-3 py-2.5 transition {currentPath === '/dashboard'
							? 'bg-accent-100 text-accent-700 font-medium'
							: 'hover:bg-warm-200'}"
					>
						Dashboard
					</a>
					<a
						href="/"
						class="flex min-h-11 items-center rounded-lg px-3 py-2.5 transition {currentPath === '/'
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
							class="flex min-h-11 w-full items-center gap-1 rounded-lg px-3 py-2.5 text-left transition hover:bg-warm-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 {isConfigRoute
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
								class="flex min-h-11 items-center rounded-lg px-3 py-2.5 transition {currentPath === '/team' || currentPath.startsWith('/team/')
									? 'bg-accent-100 text-accent-700 font-medium'
									: 'hover:bg-warm-200'}"
							>
								Team
							</a>
							<a
								href="/admin/dropdowns"
								class="flex min-h-11 items-center rounded-lg px-3 py-2.5 transition {currentPath.startsWith('/admin/dropdowns')
									? 'bg-accent-100 text-accent-700 font-medium'
									: 'hover:bg-warm-200'}"
							>
								Dropdowns
							</a>
						</div>
					</div>
				</nav>
			{:else}
				<!-- Icon-only rail -->
				<nav class="flex flex-col items-center gap-1 pt-1 text-warm-600" aria-label="Main">
					<a
						href="/dashboard"
						title="Dashboard"
						aria-label="Dashboard"
						aria-current={currentPath === '/dashboard' ? 'page' : undefined}
						class="inline-flex h-10 w-10 items-center justify-center rounded-lg transition {currentPath ===
						'/dashboard'
							? 'bg-accent-100 text-accent-700'
							: 'hover:bg-warm-200 hover:text-warm-800'}"
					>
						<!-- chart-bar -->
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
						</svg>
					</a>
					<a
						href="/"
						title="Incidents"
						aria-label="Incidents"
						aria-current={currentPath === '/' ? 'page' : undefined}
						class="inline-flex h-10 w-10 items-center justify-center rounded-lg transition {currentPath === '/'
							? 'bg-accent-100 text-accent-700'
							: 'hover:bg-warm-200 hover:text-warm-800'}"
					>
						<!-- clipboard-document-list -->
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
						</svg>
					</a>
					<a
						href="/team"
						title="Team"
						aria-label="Team"
						aria-current={currentPath === '/team' || currentPath.startsWith('/team/')
							? 'page'
							: undefined}
						class="inline-flex h-10 w-10 items-center justify-center rounded-lg transition {currentPath ===
							'/team' || currentPath.startsWith('/team/')
							? 'bg-accent-100 text-accent-700'
							: 'hover:bg-warm-200 hover:text-warm-800'}"
					>
						<!-- users -->
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
						</svg>
					</a>
					<a
						href="/admin/dropdowns"
						title="Dropdowns"
						aria-label="Dropdowns"
						aria-current={currentPath.startsWith('/admin/dropdowns') ? 'page' : undefined}
						class="inline-flex h-10 w-10 items-center justify-center rounded-lg transition {currentPath.startsWith(
							'/admin/dropdowns'
						)
							? 'bg-accent-100 text-accent-700'
							: 'hover:bg-warm-200 hover:text-warm-800'}"
					>
						<!-- queue-bullet / list -->
						<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
						</svg>
					</a>
				</nav>
			{/if}
		</div>

		<!-- User Profile, Logout & build version — expanded nav only -->
		{#if data.session?.user && isNavOpen}
			<div class="safe-pad-b space-y-2 border-t border-warm-200 p-2 sm:p-3">
				<div class="px-3 py-2">
					<div class="truncate text-xs text-warm-500" title={data.session.user.email}>
						{data.session.user.email}
					</div>
					{#if lastLoginLabel}
						<p
							class="mt-1 text-[11px] leading-snug text-warm-400 tabular-nums"
							title={`Last signed in ${lastLoginLabel}`}
						>
							<span class="block text-[10px] font-medium uppercase tracking-wide text-warm-400/90">
								Last login
							</span>
							<span class="text-warm-500">{lastLoginLabel}</span>
						</p>
					{/if}
				</div>
				<button
					type="button"
					onclick={handleLogout}
					class="flex min-h-11 w-full items-center rounded-lg px-3 py-2.5 text-left text-sm text-warm-600 transition hover:bg-warm-200"
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
