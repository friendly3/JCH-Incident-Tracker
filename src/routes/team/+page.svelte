<script lang="ts">
	import { teamStore } from '$lib/data/teamStore.svelte';
	import type { TeamLeader, Driver } from '$lib/data/team';
	import { v4 as uuidv4 } from 'uuid';

	let { data } = $props();

	// Initialize store with server-loaded data
	$effect(() => {
		if (data.supabase && data.teamLeaders && data.drivers) {
			teamStore.initFromServer(data.supabase, data.teamLeaders, data.drivers);
		}
	});

	// UI state
	type Tab = 'leaders' | 'drivers';
	let activeTab = $state<Tab>(initialTab());
	let showLeaderForm = $state(false); // inline add form
	let showDriverForm = $state(false); // inline add form
	let showLeaderModal = $state(false); // overlay edit modal
	let showDriverModal = $state(false); // overlay edit modal
	let showLeaderDiscardModal = $state(false);
	let showDriverDiscardModal = $state(false);
	let editingLeader = $state<TeamLeader | undefined>(undefined);
	let editingDriver = $state<Driver | undefined>(undefined);
	let deleteConfirmId = $state<string | null>(null);
	let deleteConfirmType = $state<'leader' | 'driver'>('leader');
	let formError = $state<string | null>(null);

	function initialTab(): Tab {
		if (typeof window === 'undefined') return 'leaders';
		const q = new URLSearchParams(window.location.search).get('tab');
		return q === 'drivers' ? 'drivers' : 'leaders';
	}

	function switchTab(tab: Tab) {
		activeTab = tab;
		deleteConfirmId = null;
		formError = null;
		// Close open add forms when switching tabs
		if (tab === 'leaders') {
			if (showDriverForm) resetDriverForm();
		} else if (showLeaderForm) {
			resetLeaderForm();
		}
	}

	// Form data
	let leaderForm = $state({
		name: '',
		email: '',
		phone: ''
	});
	let leaderFormOriginal = $state({ name: '', email: '', phone: '' });

	let driverForm = $state({
		name: '',
		username: '',
		email: '',
		phone: '',
		teamLeaderId: ''
	});
	let driverFormOriginal = $state({ name: '', username: '', email: '', phone: '', teamLeaderId: '' });

	// Unsaved change detection
	const leaderHasChanges = $derived(
		leaderForm.name !== leaderFormOriginal.name ||
		leaderForm.email !== leaderFormOriginal.email ||
		leaderForm.phone !== leaderFormOriginal.phone
	);
	const driverHasChanges = $derived(
		driverForm.name !== driverFormOriginal.name ||
		driverForm.username !== driverFormOriginal.username ||
		driverForm.email !== driverFormOriginal.email ||
		driverForm.phone !== driverFormOriginal.phone ||
		driverForm.teamLeaderId !== driverFormOriginal.teamLeaderId
	);

	// Reset leader form (inline add)
	function resetLeaderForm() {
		leaderForm = { name: '', email: '', phone: '' };
		leaderFormOriginal = { name: '', email: '', phone: '' };
		editingLeader = undefined;
		showLeaderForm = false;
	}

	// Close leader edit modal
	function closeLeaderModal() {
		showLeaderModal = false;
		showLeaderDiscardModal = false;
		editingLeader = undefined;
		leaderForm = { name: '', email: '', phone: '' };
		leaderFormOriginal = { name: '', email: '', phone: '' };
	}

	function handleLeaderBackdrop() {
		if (leaderHasChanges) {
			showLeaderDiscardModal = true;
		} else {
			closeLeaderModal();
		}
	}

	// Reset driver form (inline add)
	function resetDriverForm() {
		driverForm = { name: '', username: '', email: '', phone: '', teamLeaderId: '' };
		driverFormOriginal = { name: '', username: '', email: '', phone: '', teamLeaderId: '' };
		editingDriver = undefined;
		showDriverForm = false;
	}

	// Close driver edit modal
	function closeDriverModal() {
		showDriverModal = false;
		showDriverDiscardModal = false;
		editingDriver = undefined;
		driverForm = { name: '', username: '', email: '', phone: '', teamLeaderId: '' };
		driverFormOriginal = { name: '', username: '', email: '', phone: '', teamLeaderId: '' };
	}

	function handleDriverBackdrop() {
		if (driverHasChanges) {
			showDriverDiscardModal = true;
		} else {
			closeDriverModal();
		}
	}

	// Open leader modal for editing
	function startEditLeader(leader: TeamLeader) {
		editingLeader = leader;
		const initial = { name: leader.name, email: leader.email || '', phone: leader.phone || '' };
		leaderForm = { ...initial };
		leaderFormOriginal = { ...initial };
		showLeaderModal = true;
	}

	// Open driver modal for editing
	function startEditDriver(driver: Driver) {
		editingDriver = driver;
		const initial = {
			name: driver.name,
			username: driver.username,
			email: driver.email || '',
			phone: driver.phone || '',
			teamLeaderId: driver.teamLeaderId || ''
		};
		driverForm = { ...initial };
		driverFormOriginal = { ...initial };
		showDriverModal = true;
	}

	// Save team leader (handles both inline-add and modal-edit)
	async function saveTeamLeader() {
		formError = null;
		if (!leaderForm.name.trim()) {
			formError = 'Please enter a team leader name.';
			return;
		}

		const leader: TeamLeader = {
			id: editingLeader?.id || uuidv4(),
			name: leaderForm.name.trim(),
			email: leaderForm.email.trim() || undefined,
			phone: leaderForm.phone.trim() || undefined
		};

		const success = editingLeader
			? await teamStore.updateTeamLeader(editingLeader.id, leader)
			: await teamStore.addTeamLeader(leader, data.user?.id);

		if (success) {
			if (showLeaderModal) {
				closeLeaderModal();
			} else {
				resetLeaderForm();
			}
		} else {
			formError = 'Failed to save team leader.';
		}
	}

	// Save driver (handles both inline-add and modal-edit)
	async function saveDriver() {
		formError = null;
		if (!driverForm.name.trim() || !driverForm.username.trim()) {
			formError = 'Please enter driver name and username.';
			return;
		}

		const driver: Driver = {
			id: editingDriver?.id || uuidv4(),
			name: driverForm.name.trim(),
			username: driverForm.username.trim(),
			email: driverForm.email.trim() || undefined,
			phone: driverForm.phone.trim() || undefined,
			teamLeaderId: driverForm.teamLeaderId || undefined
		};

		const success = editingDriver
			? await teamStore.updateDriver(editingDriver.id, driver)
			: await teamStore.addDriver(driver, data.user?.id);

		if (success) {
			if (showDriverModal) {
				closeDriverModal();
			} else {
				resetDriverForm();
			}
		} else {
			formError = 'Failed to save driver.';
		}
	}

	// Delete team leader
	async function deleteLeader(id: string) {
		formError = null;
		const success = await teamStore.deleteTeamLeader(id);
		if (success) {
			deleteConfirmId = null;
		} else {
			formError = 'Failed to delete team leader.';
		}
	}

	// Delete driver
	async function deleteDriver(id: string) {
		formError = null;
		const success = await teamStore.deleteDriver(id);
		if (success) {
			deleteConfirmId = null;
		} else {
			formError = 'Failed to delete driver.';
		}
	}

	const inputClass =
		'w-full rounded-lg border border-warm-200 bg-white px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus';
</script>

<svelte:head>
	<title>Team | JCH Incident Tracker</title>
</svelte:head>

<div class="min-h-screen bg-warm-50 p-8">
	<div class="mx-auto max-w-5xl">
		<div class="mb-6">
			<p class="text-sm text-warm-500">Configuration</p>
			<h1 class="text-3xl font-bold text-warm-800">Team</h1>
			<p class="mt-1 text-sm text-warm-500">Manage team leaders and drivers used on incidents.</p>
		</div>

		{#if teamStore.isLoading}
			<div class="flex flex-col items-center justify-center py-16">
				<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-accent-600"></div>
				<p class="mt-3 text-sm text-warm-500">Loading team data…</p>
			</div>
		{:else if teamStore.error}
			<div class="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
				<p class="font-medium">{teamStore.error}</p>
				<button
					type="button"
					onclick={() => teamStore.reload(data.user?.id)}
					class="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
				>
					Try again
				</button>
			</div>
		{:else}
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
						class="tab {activeTab === 'leaders' ? 'active' : ''}"
						onclick={() => switchTab('leaders')}
					>
						Team Leaders ({teamStore.teamLeaders.length})
					</button>
					<button
						type="button"
						class="tab {activeTab === 'drivers' ? 'active' : ''}"
						onclick={() => switchTab('drivers')}
					>
						Drivers ({teamStore.drivers.length})
					</button>
				</div>
				<div class="flex flex-wrap gap-2">
					{#if activeTab === 'leaders'}
						<button
							type="button"
							class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
							onclick={() => {
								formError = null;
								showLeaderForm = true;
							}}
						>
							+ Add Team Leader
						</button>
					{:else}
						<button
							type="button"
							class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
							onclick={() => {
								formError = null;
								showDriverForm = true;
							}}
						>
							+ Add Driver
						</button>
					{/if}
				</div>
			</div>

			<!-- Team Leaders -->
			{#if activeTab === 'leaders'}
				{#if showLeaderForm}
					<div class="mb-6 rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 text-lg font-semibold text-warm-800">Add Team Leader</h2>
						<div class="space-y-4">
							<div>
								<label for="leader-name" class="mb-1 block text-sm font-medium text-warm-700">Name *</label>
								<input
									id="leader-name"
									type="text"
									bind:value={leaderForm.name}
									placeholder="e.g., John Smith"
									class={inputClass}
								/>
							</div>
							<div>
								<label for="leader-email" class="mb-1 block text-sm font-medium text-warm-700">Email</label>
								<input
									id="leader-email"
									type="email"
									bind:value={leaderForm.email}
									placeholder="john@example.com"
									class={inputClass}
								/>
							</div>
							<div>
								<label for="leader-phone" class="mb-1 block text-sm font-medium text-warm-700">Phone</label>
								<input
									id="leader-phone"
									type="tel"
									bind:value={leaderForm.phone}
									placeholder="0412 345 678"
									class={inputClass}
								/>
							</div>
							<div class="flex justify-end gap-3 pt-2">
								<button
									type="button"
									onclick={resetLeaderForm}
									class="rounded-lg border border-warm-300 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50"
								>
									Cancel
								</button>
								<button
									type="button"
									onclick={saveTeamLeader}
									class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
								>
									Add Team Leader
								</button>
							</div>
						</div>
					</div>
				{/if}

				<div class="rounded-lg border border-warm-200 bg-white shadow-sm">
					{#if teamStore.teamLeaders.length === 0}
						<p class="p-8 text-center text-warm-500">No team leaders yet. Add one to get started.</p>
					{:else}
						<table class="w-full divide-y divide-warm-200 text-sm">
							<thead class="bg-warm-50">
								<tr>
									<th class="px-6 py-4 text-left font-medium text-warm-500">Name</th>
									<th class="px-6 py-4 text-left font-medium text-warm-500">Email</th>
									<th class="px-6 py-4 text-left font-medium text-warm-500">Phone</th>
									<th class="px-6 py-4 text-right font-medium text-warm-500">Actions</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-warm-100">
								{#each teamStore.teamLeaders as leader (leader.id)}
									<tr>
										<td class="px-6 py-4 font-medium text-warm-800">{leader.name}</td>
										<td class="px-6 py-4 text-warm-600">{leader.email || '—'}</td>
										<td class="px-6 py-4 text-warm-600">{leader.phone || '—'}</td>
										<td class="px-6 py-4 text-right whitespace-nowrap">
											{#if deleteConfirmId === leader.id && deleteConfirmType === 'leader'}
												<span class="mr-2 text-xs text-red-600">Confirm delete?</span>
												<button
													type="button"
													onclick={() => deleteLeader(leader.id)}
													class="mr-1 rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
												>
													Yes
												</button>
												<button
													type="button"
													onclick={() => (deleteConfirmId = null)}
													class="px-2 py-0.5 text-xs text-warm-600 hover:text-warm-800"
												>
													No
												</button>
											{:else}
												<button
													type="button"
													onclick={() => startEditLeader(leader)}
													class="mr-3 rounded-lg border border-warm-300 px-3 py-1 text-sm font-medium text-accent-600 hover:bg-warm-50 hover:text-accent-700"
												>
													Edit
												</button>
												<button
													type="button"
													onclick={() => {
														deleteConfirmId = leader.id;
														deleteConfirmType = 'leader';
													}}
													class="rounded-lg border border-red-200 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
												>
													Delete
												</button>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>

				<!-- Drivers -->
			{:else}
				{#if showDriverForm}
					<div class="mb-6 rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
						<h2 class="mb-4 text-lg font-semibold text-warm-800">Add Driver</h2>
						<div class="space-y-4">
							<div class="grid gap-4 sm:grid-cols-2">
								<div>
									<label for="driver-name" class="mb-1 block text-sm font-medium text-warm-700">Name *</label>
									<input
										id="driver-name"
										type="text"
										bind:value={driverForm.name}
										placeholder="e.g., Jane Smith"
										class={inputClass}
									/>
								</div>
								<div>
									<label for="driver-username" class="mb-1 block text-sm font-medium text-warm-700"
										>Username *</label
									>
									<input
										id="driver-username"
										type="text"
										bind:value={driverForm.username}
										placeholder="e.g., SMITHJ1"
										class={inputClass}
									/>
								</div>
							</div>
							<div class="grid gap-4 sm:grid-cols-2">
								<div>
									<label for="driver-email" class="mb-1 block text-sm font-medium text-warm-700">Email</label>
									<input
										id="driver-email"
										type="email"
										bind:value={driverForm.email}
										placeholder="jane@example.com"
										class={inputClass}
									/>
								</div>
								<div>
									<label for="driver-phone" class="mb-1 block text-sm font-medium text-warm-700">Phone</label>
									<input
										id="driver-phone"
										type="tel"
										bind:value={driverForm.phone}
										placeholder="0412 345 678"
										class={inputClass}
									/>
								</div>
							</div>
							<div>
								<label for="driver-leader" class="mb-1 block text-sm font-medium text-warm-700"
									>Team Leader</label
								>
								<select id="driver-leader" bind:value={driverForm.teamLeaderId} class={inputClass}>
									<option value="">— Unassigned —</option>
									{#each teamStore.teamLeaders as leader}
										<option value={leader.id}>{leader.name}</option>
									{/each}
								</select>
							</div>
							<div class="flex justify-end gap-3 pt-2">
								<button
									type="button"
									onclick={resetDriverForm}
									class="rounded-lg border border-warm-300 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50"
								>
									Cancel
								</button>
								<button
									type="button"
									onclick={saveDriver}
									class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
								>
									Add Driver
								</button>
							</div>
						</div>
					</div>
				{/if}

				<div class="rounded-lg border border-warm-200 bg-white shadow-sm">
					{#if teamStore.drivers.length === 0}
						<p class="p-8 text-center text-warm-500">No drivers yet. Add one to get started.</p>
					{:else}
						<table class="w-full divide-y divide-warm-200 text-sm">
							<thead class="bg-warm-50">
								<tr>
									<th class="px-6 py-4 text-left font-medium text-warm-500">Name</th>
									<th class="px-6 py-4 text-left font-medium text-warm-500">Username</th>
									<th class="px-6 py-4 text-left font-medium text-warm-500">Email</th>
									<th class="px-6 py-4 text-left font-medium text-warm-500">Team Leader</th>
									<th class="px-6 py-4 text-right font-medium text-warm-500">Actions</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-warm-100">
								{#each teamStore.drivers as driver (driver.id)}
									{@const leader = teamStore.teamLeaders.find((l) => l.id === driver.teamLeaderId)}
									<tr>
										<td class="px-6 py-4 font-medium text-warm-800">{driver.name}</td>
										<td class="px-6 py-4 font-mono text-xs text-warm-600">{driver.username}</td>
										<td class="px-6 py-4 text-warm-600">{driver.email || '—'}</td>
										<td class="px-6 py-4 text-warm-600">{leader?.name || '—'}</td>
										<td class="px-6 py-4 text-right whitespace-nowrap">
											{#if deleteConfirmId === driver.id && deleteConfirmType === 'driver'}
												<span class="mr-2 text-xs text-red-600">Confirm delete?</span>
												<button
													type="button"
													onclick={() => deleteDriver(driver.id)}
													class="mr-1 rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
												>
													Yes
												</button>
												<button
													type="button"
													onclick={() => (deleteConfirmId = null)}
													class="px-2 py-0.5 text-xs text-warm-600 hover:text-warm-800"
												>
													No
												</button>
											{:else}
												<button
													type="button"
													onclick={() => startEditDriver(driver)}
													class="mr-3 rounded-lg border border-warm-300 px-3 py-1 text-sm font-medium text-accent-600 hover:bg-warm-50 hover:text-accent-700"
												>
													Edit
												</button>
												<button
													type="button"
													onclick={() => {
														deleteConfirmId = driver.id;
														deleteConfirmType = 'driver';
													}}
													class="rounded-lg border border-red-200 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700"
												>
													Delete
												</button>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			{/if}
		{/if}
	</div>

	<!-- Edit Team Leader Modal -->
	{#if showLeaderModal}
		<div
			class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
			onclick={handleLeaderBackdrop}
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Escape' && handleLeaderBackdrop()}
		>
			<div
				class="relative w-full max-w-md bg-white rounded-xl shadow-2xl p-6"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				tabindex="-1"
			>
				<div class="flex items-center justify-between mb-5">
					<h2 class="text-lg font-semibold text-warm-800">Edit Team Leader</h2>
					{#if leaderHasChanges}
						<span class="text-xs text-amber-600 font-medium">Unsaved changes</span>
					{/if}
				</div>
				<div class="space-y-4">
					<div>
						<label for="modal-leader-name" class="block text-sm font-medium text-warm-700 mb-1">Name *</label>
						<input id="modal-leader-name" type="text" bind:value={leaderForm.name}
							class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus" />
					</div>
					<div>
						<label for="modal-leader-email" class="block text-sm font-medium text-warm-700 mb-1">Email</label>
						<input id="modal-leader-email" type="email" bind:value={leaderForm.email}
							class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus" />
					</div>
					<div>
						<label for="modal-leader-phone" class="block text-sm font-medium text-warm-700 mb-1">Phone</label>
						<input id="modal-leader-phone" type="tel" bind:value={leaderForm.phone}
							class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus" />
					</div>
					<div class="flex gap-3 justify-end pt-2">
						<button type="button" onclick={handleLeaderBackdrop}
						class="rounded-lg border-2 border-warm-400 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition">Cancel</button>
						<button type="button" onclick={saveTeamLeader}
							class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 transition">Update Team Leader</button>
					</div>
				</div>
			</div>
		</div>
		{#if showLeaderDiscardModal}
			<div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
				<div class="rounded-lg bg-white p-6 shadow-xl">
					<h3 class="mb-2 text-lg font-semibold text-warm-800">Unsaved Changes</h3>
					<p class="mb-6 text-sm text-warm-600">You have unsaved changes. Are you sure you want to discard them?</p>
					<div class="flex gap-3 justify-end">
						<button type="button" onclick={() => { showLeaderDiscardModal = false; }}
							class="rounded-lg border border-warm-200 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50">Keep Editing</button>
						<button type="button" onclick={closeLeaderModal}
							class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Discard Changes</button>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- Edit Driver Modal -->
	{#if showDriverModal}
		<div
			class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
			onclick={handleDriverBackdrop}
			role="button"
			tabindex="0"
			onkeydown={(e) => e.key === 'Escape' && handleDriverBackdrop()}
		>
			<div
				class="relative w-full max-w-lg bg-white rounded-xl shadow-2xl p-6"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				tabindex="-1"
			>
				<div class="flex items-center justify-between mb-5">
					<h2 class="text-lg font-semibold text-warm-800">Edit Driver</h2>
					{#if driverHasChanges}
						<span class="text-xs text-amber-600 font-medium">Unsaved changes</span>
					{/if}
				</div>
				<div class="space-y-4">
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label for="modal-driver-name" class="block text-sm font-medium text-warm-700 mb-1">Name *</label>
							<input id="modal-driver-name" type="text" bind:value={driverForm.name}
								class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus" />
						</div>
						<div>
							<label for="modal-driver-username" class="block text-sm font-medium text-warm-700 mb-1">Username *</label>
							<input id="modal-driver-username" type="text" bind:value={driverForm.username}
								class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus" />
						</div>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div>
							<label for="modal-driver-email" class="block text-sm font-medium text-warm-700 mb-1">Email</label>
							<input id="modal-driver-email" type="email" bind:value={driverForm.email}
								class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus" />
						</div>
						<div>
							<label for="modal-driver-phone" class="block text-sm font-medium text-warm-700 mb-1">Phone</label>
							<input id="modal-driver-phone" type="tel" bind:value={driverForm.phone}
								class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus" />
						</div>
					</div>
					<div>
						<label for="modal-driver-leader" class="block text-sm font-medium text-warm-700 mb-1">Team Leader</label>
						<select id="modal-driver-leader" bind:value={driverForm.teamLeaderId}
							class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-700 input-focus uppercase">
							<option value="">-- Unassigned --</option>
							{#each teamStore.teamLeaders as leader}
								<option value={leader.id} class="uppercase">{leader.name}</option>
							{/each}
						</select>
					</div>
					<div class="flex gap-3 justify-end pt-2">
						<button type="button" onclick={handleDriverBackdrop}
						class="rounded-lg border-2 border-warm-400 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition">Cancel</button>
						<button type="button" onclick={saveDriver}
							class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 transition">Update Driver</button>
					</div>
				</div>
			</div>
		</div>
		{#if showDriverDiscardModal}
			<div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
				<div class="rounded-lg bg-white p-6 shadow-xl">
					<h3 class="mb-2 text-lg font-semibold text-warm-800">Unsaved Changes</h3>
					<p class="mb-6 text-sm text-warm-600">You have unsaved changes. Are you sure you want to discard them?</p>
					<div class="flex gap-3 justify-end">
						<button type="button" onclick={() => { showDriverDiscardModal = false; }}
							class="rounded-lg border border-warm-200 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50">Keep Editing</button>
						<button type="button" onclick={closeDriverModal}
							class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Discard Changes</button>
					</div>
				</div>
			</div>
		{/if}
	{/if}
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