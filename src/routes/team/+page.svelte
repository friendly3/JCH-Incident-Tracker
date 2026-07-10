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
	let activeTab = $state<'leaders' | 'drivers'>('leaders');
	let showLeaderForm = $state(false);   // inline add form
	let showDriverForm = $state(false);   // inline add form
	let showLeaderModal = $state(false);  // overlay edit modal
	let showDriverModal = $state(false);  // overlay edit modal
	let showLeaderDiscardModal = $state(false);
	let showDriverDiscardModal = $state(false);
	let editingLeader = $state<TeamLeader | undefined>(undefined);
	let editingDriver = $state<Driver | undefined>(undefined);
	let deleteConfirmId = $state<string | null>(null);
	let deleteConfirmType = $state<'leader' | 'driver'>('leader');

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
		if (!leaderForm.name.trim()) {
			alert('Please enter a team leader name');
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
			alert('Failed to save team leader');
		}
	}

	// Save driver (handles both inline-add and modal-edit)
	async function saveDriver() {
		if (!driverForm.name.trim() || !driverForm.username.trim()) {
			alert('Please enter driver name and username');
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
			alert('Failed to save driver');
		}
	}

	// Delete team leader
	async function deleteLeader(id: string) {
		const success = await teamStore.deleteTeamLeader(id);
		if (success) {
			deleteConfirmId = null;
		} else {
			alert('Failed to delete team leader');
		}
	}

	// Delete driver
	async function deleteDriver(id: string) {
		const success = await teamStore.deleteDriver(id);
		if (success) {
			deleteConfirmId = null;
		} else {
			alert('Failed to delete driver');
		}
	}
</script>

<svelte:head>
	<title>Team Management | Incident Tracker</title>
</svelte:head>

<div class="flex-1 flex flex-col bg-warm-50 text-warm-900 overflow-hidden">
	<header class="border-b border-warm-200 bg-white/80 px-6 py-5 backdrop-blur flex-shrink-0">
		<div class="w-full">
			<h1 class="text-2xl font-bold text-warm-800">Team Management</h1>
			<p class="mt-1 text-sm text-warm-500">Manage team leaders and drivers</p>
		</div>
	</header>

	{#if teamStore.isLoading}
		<div class="flex items-center justify-center py-12">
			<div class="flex flex-col items-center">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-warm-600"></div>
				<p class="mt-3 text-sm text-warm-500">Loading team data...</p>
			</div>
		</div>
	{:else if teamStore.error}
		<div class="rounded-lg border border-red-200 bg-red-50 p-8 text-center m-6">
			<p class="text-red-600 mb-4">⚠️ {teamStore.error}</p>
			<button
				onclick={() => teamStore.reload(data.user?.id)}
				class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition"
			>
				Try Again
			</button>
		</div>
	{:else}
		<div class="flex-1 overflow-auto">
			<div class="w-full px-6 py-6">
				<!-- Tabs -->
				<div class="flex gap-4 mb-6 border-b border-warm-200">
					<button
						onclick={() => activeTab = 'leaders'}
						class="px-4 py-3 font-medium transition {activeTab === 'leaders'
							? 'text-accent-600 border-b-2 border-accent-600'
							: 'text-warm-600 hover:text-warm-800'}"
					>
						👥 Team Leaders ({teamStore.teamLeaders.length})
					</button>
					<button
						onclick={() => activeTab = 'drivers'}
						class="px-4 py-3 font-medium transition {activeTab === 'drivers'
							? 'text-accent-600 border-b-2 border-accent-600'
							: 'text-warm-600 hover:text-warm-800'}"
					>
						🚗 Drivers ({teamStore.drivers.length})
					</button>
				</div>

				<!-- Team Leaders Tab -->
				{#if activeTab === 'leaders'}
					<div class="space-y-6">
						{#if !showLeaderForm}
							<button
								onclick={() => showLeaderForm = true}
								class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 transition"
							>
								+ Add Team Leader
							</button>
						{:else}
							<div class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
								<h2 class="mb-4 text-lg font-semibold text-warm-800">
									{editingLeader ? 'Edit Team Leader' : 'Add Team Leader'}
								</h2>
								<div class="space-y-4">
									<div>
										<label for="leader-name" class="block text-sm font-medium text-warm-700 mb-1">Name *</label>
										<input
											id="leader-name"
											type="text"
											bind:value={leaderForm.name}
											placeholder="e.g., John Smith"
											class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus"
										/>
									</div>
									<div>
										<label for="leader-email" class="block text-sm font-medium text-warm-700 mb-1">Email</label>
										<input
											id="leader-email"
											type="email"
											bind:value={leaderForm.email}
											placeholder="john@example.com"
											class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus"
										/>
									</div>
									<div>
										<label for="leader-phone" class="block text-sm font-medium text-warm-700 mb-1">Phone</label>
										<input
											id="leader-phone"
											type="tel"
											bind:value={leaderForm.phone}
											placeholder="0412 345 678"
											class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus"
										/>
									</div>
									<div class="flex gap-3 justify-end pt-4">
										<button
											type="button"
											onclick={resetLeaderForm}
											class="rounded-lg border border-warm-200 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition"
										>
											Cancel
										</button>
										<button
											type="button"
											onclick={saveTeamLeader}
											class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 transition"
										>
											{editingLeader ? 'Update' : 'Add'} Team Leader
										</button>
									</div>
								</div>
							</div>
						{/if}

						<!-- Team Leaders List -->
						<div class="rounded-lg border border-warm-200 bg-white shadow-sm overflow-hidden">
							{#if teamStore.teamLeaders.length === 0}
								<div class="p-8 text-center">
									<p class="text-warm-500">No team leaders yet. Add one to get started.</p>
								</div>
							{:else}
								<table class="w-full text-left text-sm">
									<thead class="border-b border-warm-200 bg-warm-50">
										<tr>
											<th class="px-6 py-3 font-medium text-warm-600">Name</th>
											<th class="px-6 py-3 font-medium text-warm-600">Email</th>
											<th class="px-6 py-3 font-medium text-warm-600">Phone</th>
											<th class="px-6 py-3 font-medium text-warm-600 text-right">Actions</th>
										</tr>
									</thead>
									<tbody>
										{#each teamStore.teamLeaders as leader (leader.id)}
											<tr class="border-b border-warm-100 last:border-0 hover:bg-warm-50/50">
												<td class="px-6 py-3 font-medium text-warm-800 uppercase">{leader.name}</td>
												<td class="px-6 py-3 text-warm-600">{leader.email || '-'}</td>
												<td class="px-6 py-3 text-warm-600">{leader.phone || '-'}</td>
												<td class="px-6 py-3 text-right whitespace-nowrap">
													{#if deleteConfirmId === leader.id && deleteConfirmType === 'leader'}
														<span class="mr-2 text-xs text-red-600">Delete?</span>
														<button
															onclick={() => deleteLeader(leader.id)}
															class="mr-2 px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded font-medium"
														>
															Yes
														</button>
														<button
															onclick={() => (deleteConfirmId = null)}
															class="px-3 py-1 text-xs bg-warm-100 hover:bg-warm-200 text-warm-700 rounded"
														>
															No
														</button>
													{:else}
														<button
															onclick={() => startEditLeader(leader)}
															class="mr-2 px-3 py-1 text-sm bg-accent-100 hover:bg-accent-600 hover:text-white text-accent-700 rounded border border-accent-200"
														>
															Edit
														</button>
														<button
															onclick={() => {
																deleteConfirmId = leader.id;
																deleteConfirmType = 'leader';
															}}
															class="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded"
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
					</div>

				<!-- Drivers Tab -->
				{:else if activeTab === 'drivers'}
					<div class="space-y-6">
						{#if !showDriverForm}
							<button
								onclick={() => showDriverForm = true}
								class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 transition"
							>
								+ Add Driver
							</button>
						{:else}
							<div class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
								<h2 class="mb-4 text-lg font-semibold text-warm-800">
									{editingDriver ? 'Edit Driver' : 'Add Driver'}
								</h2>
								<div class="space-y-4">
									<div class="grid grid-cols-2 gap-4">
										<div>
											<label for="driver-name" class="block text-sm font-medium text-warm-700 mb-1">Name *</label>
											<input
												id="driver-name"
												type="text"
												bind:value={driverForm.name}
												placeholder="e.g., Jane Smith"
												class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus"
											/>
										</div>
										<div>
											<label for="driver-username" class="block text-sm font-medium text-warm-700 mb-1">Username *</label>
											<input
												id="driver-username"
												type="text"
												bind:value={driverForm.username}
												placeholder="e.g., SMITHJ1"
												class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus"
											/>
										</div>
									</div>
									<div class="grid grid-cols-2 gap-4">
										<div>
											<label for="driver-email" class="block text-sm font-medium text-warm-700 mb-1">Email</label>
											<input
												id="driver-email"
												type="email"
												bind:value={driverForm.email}
												placeholder="jane@example.com"
												class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus"
											/>
										</div>
										<div>
											<label for="driver-phone" class="block text-sm font-medium text-warm-700 mb-1">Phone</label>
											<input
												id="driver-phone"
												type="tel"
												bind:value={driverForm.phone}
												placeholder="0412 345 678"
												class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-800 placeholder-warm-400 input-focus"
											/>
										</div>
									</div>
									<div>
										<label for="driver-leader" class="block text-sm font-medium text-warm-700 mb-1">Team Leader</label>
										<select
											id="driver-leader"
											bind:value={driverForm.teamLeaderId}
										class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2 text-sm text-warm-700 input-focus uppercase"
									>
										<option value="">-- Unassigned --</option>
										{#each teamStore.teamLeaders as leader}
											<option value={leader.id} class="uppercase">{leader.name}</option>
											{/each}
										</select>
									</div>
									<div class="flex gap-3 justify-end pt-4">
										<button
											type="button"
											onclick={resetDriverForm}
											class="rounded-lg border border-warm-200 px-4 py-2 text-sm text-warm-700 hover:bg-warm-50 transition"
										>
											Cancel
										</button>
										<button
											type="button"
											onclick={saveDriver}
											class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500 transition"
										>
											{editingDriver ? 'Update' : 'Add'} Driver
										</button>
									</div>
								</div>
							</div>
						{/if}

						<!-- Drivers List -->
						<div class="rounded-lg border border-warm-200 bg-white shadow-sm overflow-hidden">
							{#if teamStore.drivers.length === 0}
								<div class="p-8 text-center">
									<p class="text-warm-500">No drivers yet. Add one to get started.</p>
								</div>
							{:else}
								<table class="w-full text-left text-sm">
									<thead class="border-b border-warm-200 bg-warm-50">
										<tr>
											<th class="px-6 py-3 font-medium text-warm-600">Name</th>
											<th class="px-6 py-3 font-medium text-warm-600">Username</th>
											<th class="px-6 py-3 font-medium text-warm-600">Email</th>
											<th class="px-6 py-3 font-medium text-warm-600">Team Leader</th>
											<th class="px-6 py-3 font-medium text-warm-600 text-right">Actions</th>
										</tr>
									</thead>
									<tbody>
										{#each teamStore.drivers as driver (driver.id)}
											{@const leader = teamStore.teamLeaders.find(l => l.id === driver.teamLeaderId)}
											<tr class="border-b border-warm-100 last:border-0 hover:bg-warm-50/50">
												<td class="px-6 py-3 font-medium text-warm-800">{driver.name}</td>
												<td class="px-6 py-3 font-mono text-xs text-warm-600">{driver.username}</td>
												<td class="px-6 py-3 text-warm-600">{driver.email || '-'}</td>
												<td class="px-6 py-3 text-warm-600">{leader?.name || '-'}</td>
												<td class="px-6 py-3 text-right whitespace-nowrap">
													{#if deleteConfirmId === driver.id && deleteConfirmType === 'driver'}
														<span class="mr-2 text-xs text-red-600">Delete?</span>
														<button
															onclick={() => deleteDriver(driver.id)}
															class="mr-2 px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded font-medium"
														>
															Yes
														</button>
														<button
															onclick={() => (deleteConfirmId = null)}
															class="px-3 py-1 text-xs bg-warm-100 hover:bg-warm-200 text-warm-700 rounded"
														>
															No
														</button>
													{:else}
														<button
															onclick={() => startEditDriver(driver)}
															class="mr-2 px-3 py-1 text-sm bg-accent-100 hover:bg-accent-600 hover:text-white text-accent-700 rounded border border-accent-200"
														>
															Edit
														</button>
														<button
															onclick={() => {
																deleteConfirmId = driver.id;
																deleteConfirmType = 'driver';
															}}
															class="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded"
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
					</div>
				{/if}
			</div>
		</div>
	{/if}

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
	{/if}</div>