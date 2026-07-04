<script lang="ts">
	import type { Facility } from '$lib/data/facilities';
	import { allServices } from '$lib/data/facilities';

	interface Props {
		facility?: Facility;
		onSubmit: (facility: Facility) => void;
		onCancel: () => void;
	}

	let { facility, onSubmit, onCancel }: Props = $props();

	const isEdit = !!facility;

	let form = $state<Facility>({
		id: facility?.id ?? '',
		name: facility?.name ?? '',
		provider: facility?.provider ?? '',
		type: facility?.type ?? 'Residential',
		address: facility?.address ?? '',
		suburb: facility?.suburb ?? '',
		selectedState: facility?.state ?? 'NSW',
		postcode: facility?.postcode ?? '',
		phone: facility?.phone ?? '',
		starRating: facility?.starRating ?? 3,
		qualityMeasures: facility?.qualityMeasures ?? { residents: 3, compliance: 3, staffing: 3, quality: 3 },
		services: facility?.services ?? [],
		totalBeds: facility?.totalBeds ?? 0,
		availableBeds: facility?.availableBeds ?? 0,
		dailyPrice: facility?.dailyPrice ?? { from: 0, to: 0 },
		refundableDeposit: facility?.refundableDeposit ?? { from: 0, to: 0 },
		description: facility?.description ?? '',
		lastAuditDate: facility?.lastAuditDate ?? new Date().toISOString().split('T')[0],
		complianceStatus: facility?.complianceStatus ?? 'Met'
	} as Facility & { selectedState: string });

	function generateId(name: string): string {
		return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
	}

	function toggleService(service: string) {
		if (form.services.includes(service)) {
			form.services = form.services.filter((s) => s !== service);
		} else {
			form.services = [...form.services, service];
		}
	}

	function handleSubmit() {
		const output: Facility = {
			...form,
			id: form.id || generateId(form.name),
			state: (form as any).selectedState || form.state
		};
		delete (output as any).selectedState;
		onSubmit(output);
	}

	const states = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
	const types: Facility['type'][] = ['Residential', 'Home Care', 'Respite', 'Mixed'];
	const complianceOptions: Facility['complianceStatus'][] = ['Met', 'Not Met', 'Under Review'];
</script>

<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
	<h2 class="text-xl font-semibold text-warm-800">{isEdit ? 'Edit' : 'Add'} Facility</h2>

	<!-- Basic info -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<div>
			<label for="name" class="mb-1 block text-sm text-warm-500">Facility Name *</label>
			<input id="name" type="text" bind:value={form.name} required
				class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
		</div>
		<div>
			<label for="provider" class="mb-1 block text-sm text-warm-500">Provider *</label>
			<input id="provider" type="text" bind:value={form.provider} required
				class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
		</div>
		<div>
			<label for="type" class="mb-1 block text-sm text-warm-500">Type</label>
			<select id="type" bind:value={form.type}
				class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus">
				{#each types as t}
					<option value={t}>{t}</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="phone" class="mb-1 block text-sm text-warm-500">Phone</label>
			<input id="phone" type="text" bind:value={form.phone}
				class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
		</div>
	</div>

	<!-- Address -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
		<div class="sm:col-span-2">
			<label for="address" class="mb-1 block text-sm text-warm-500">Address</label>
			<input id="address" type="text" bind:value={form.address}
				class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
		</div>
		<div>
			<label for="suburb" class="mb-1 block text-sm text-warm-500">Suburb *</label>
			<input id="suburb" type="text" bind:value={form.suburb} required
				class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
		</div>
		<div class="grid grid-cols-2 gap-2">
			<div>
				<label for="formState" class="mb-1 block text-sm text-warm-500">State</label>
				<select id="formState" bind:value={(form as any).selectedState}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus">
					{#each states as s}
						<option value={s}>{s}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="postcode" class="mb-1 block text-sm text-warm-500">Postcode</label>
				<input id="postcode" type="text" bind:value={form.postcode}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
			</div>
		</div>
	</div>

	<!-- Description -->
	<div>
		<label for="description" class="mb-1 block text-sm text-warm-500">Description</label>
		<textarea id="description" bind:value={form.description} rows={3}
			class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus"></textarea>
	</div>

	<!-- Ratings -->
	<div>
		<h3 class="mb-3 text-sm font-medium text-warm-600">Ratings & Compliance</h3>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
			<div>
				<label for="starRating" class="mb-1 block text-xs text-warm-500">Star Rating</label>
				<select id="starRating" bind:value={form.starRating}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus">
					{#each [1, 2, 3, 4, 5] as n}
						<option value={n}>{n} Star{n > 1 ? 's' : ''}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="qmResidents" class="mb-1 block text-xs text-warm-500">Residents</label>
				<select id="qmResidents" bind:value={form.qualityMeasures.residents}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus">
					{#each [1, 2, 3, 4, 5] as n}<option value={n}>{n}/5</option>{/each}
				</select>
			</div>
			<div>
				<label for="qmCompliance" class="mb-1 block text-xs text-warm-500">Compliance</label>
				<select id="qmCompliance" bind:value={form.qualityMeasures.compliance}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus">
					{#each [1, 2, 3, 4, 5] as n}<option value={n}>{n}/5</option>{/each}
				</select>
			</div>
			<div>
				<label for="qmStaffing" class="mb-1 block text-xs text-warm-500">Staffing</label>
				<select id="qmStaffing" bind:value={form.qualityMeasures.staffing}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus">
					{#each [1, 2, 3, 4, 5] as n}<option value={n}>{n}/5</option>{/each}
				</select>
			</div>
			<div>
				<label for="qmQuality" class="mb-1 block text-xs text-warm-500">Quality</label>
				<select id="qmQuality" bind:value={form.qualityMeasures.quality}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus">
					{#each [1, 2, 3, 4, 5] as n}<option value={n}>{n}/5</option>{/each}
				</select>
			</div>
			<div>
				<label for="complianceStatus" class="mb-1 block text-xs text-warm-500">Status</label>
				<select id="complianceStatus" bind:value={form.complianceStatus}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus">
					{#each complianceOptions as o}
						<option value={o}>{o}</option>
					{/each}
				</select>
			</div>
		</div>
	</div>

	<!-- Capacity & Pricing -->
	<div>
		<h3 class="mb-3 text-sm font-medium text-warm-600">Capacity & Pricing</h3>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
			<div>
				<label for="totalBeds" class="mb-1 block text-xs text-warm-500">Total Beds</label>
				<input id="totalBeds" type="number" bind:value={form.totalBeds} min={0}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
			</div>
			<div>
				<label for="availableBeds" class="mb-1 block text-xs text-warm-500">Available</label>
				<input id="availableBeds" type="number" bind:value={form.availableBeds} min={0}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
			</div>
			<div>
				<label for="priceFrom" class="mb-1 block text-xs text-warm-500">Daily $ From</label>
				<input id="priceFrom" type="number" bind:value={form.dailyPrice.from} min={0}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
			</div>
			<div>
				<label for="priceTo" class="mb-1 block text-xs text-warm-500">Daily $ To</label>
				<input id="priceTo" type="number" bind:value={form.dailyPrice.to} min={0}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
			</div>
			<div>
				<label for="depositFrom" class="mb-1 block text-xs text-warm-500">Deposit $ From</label>
				<input id="depositFrom" type="number" bind:value={form.refundableDeposit.from} min={0}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
			</div>
			<div>
				<label for="depositTo" class="mb-1 block text-xs text-warm-500">Deposit $ To</label>
				<input id="depositTo" type="number" bind:value={form.refundableDeposit.to} min={0}
					class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
			</div>
		</div>
	</div>

	<!-- Audit date -->
	<div class="max-w-xs">
		<label for="lastAuditDate" class="mb-1 block text-sm text-warm-500">Last Audit Date</label>
		<input id="lastAuditDate" type="date" bind:value={form.lastAuditDate}
			class="w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus" />
	</div>

	<!-- Services -->
	<div>
		<h3 class="mb-3 text-sm font-medium text-warm-600">Services</h3>
		<div class="flex flex-wrap gap-2">
			{#each allServices as service}
				<button type="button" onclick={() => toggleService(service)}
					class="rounded-full px-3 py-1 text-xs transition {form.services.includes(service)
						? 'bg-accent-600 text-white'
						: 'bg-warm-100 text-warm-500 hover:text-warm-700'}">
					{service}
				</button>
			{/each}
		</div>
	</div>

	<!-- Actions -->
	<div class="flex gap-3 border-t border-warm-200 pt-4">
		<button type="submit"
			class="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500">
			{isEdit ? 'Update' : 'Add'} Facility
		</button>
		<button type="button" onclick={onCancel}
			class="rounded-lg px-5 py-2 text-sm text-warm-500 hover:text-white">
			Cancel
		</button>
	</div>
</form>
