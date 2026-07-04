<script lang="ts">
	import { allServices, allStates, allTypes } from '$lib/data/facilities';

	interface Props {
		search: string;
		selectedState: string;
		type: string;
		minRating: number;
		services: string[];
		sortBy: string;
		onUpdate: (filters: {
			search: string;
			selectedState: string;
			type: string;
			minRating: number;
			services: string[];
			sortBy: string;
		}) => void;
	}

	let { search, selectedState, type, minRating, services, sortBy, onUpdate }: Props = $props();

	let showServices = $state(false);

	function update(partial: Record<string, unknown>) {
		onUpdate({
			search,
			selectedState,
			type,
			minRating,
			services,
			sortBy,
			...partial
		});
	}

	function toggleService(service: string) {
		const next = services.includes(service)
			? services.filter((s) => s !== service)
			: [...services, service];
		update({ services: next });
	}
</script>

<div class="space-y-4 rounded-lg border border-warm-200 bg-white p-5 shadow-sm">
	<!-- Search -->
	<div>
		<input
			type="text"
			placeholder="Search by name, suburb, or provider..."
			value={search}
			oninput={(e) => update({ search: e.currentTarget.value })}
			class="w-full rounded-lg border border-warm-200 bg-warm-50 px-4 py-2.5 text-sm text-warm-800 placeholder-warm-400 input-focus"
		/>
	</div>

	<!-- Dropdowns row -->
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<select
			value={selectedState}
			onchange={(e) => update({ selectedState: e.currentTarget.value })}
			class="rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus"
		>
			<option value="">All States</option>
			{#each allStates as s}
				<option value={s}>{s}</option>
			{/each}
		</select>

		<select
			value={type}
			onchange={(e) => update({ type: e.currentTarget.value })}
			class="rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus"
		>
			<option value="">All Types</option>
			{#each allTypes as t}
				<option value={t}>{t}</option>
			{/each}
		</select>

		<select
			value={minRating}
			onchange={(e) => update({ minRating: Number(e.currentTarget.value) })}
			class="rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus"
		>
			<option value={0}>Any Rating</option>
			<option value={2}>2+ Stars</option>
			<option value={3}>3+ Stars</option>
			<option value={4}>4+ Stars</option>
			<option value={5}>5 Stars Only</option>
		</select>

		<select
			value={sortBy}
			onchange={(e) => update({ sortBy: e.currentTarget.value })}
			class="rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus"
		>
			<option value="rating">Highest Rated</option>
			<option value="price-low">Price: Low to High</option>
			<option value="price-high">Price: High to Low</option>
			<option value="beds">Most Beds Available</option>
			<option value="name">Name A-Z</option>
		</select>
	</div>

	<!-- Services filter -->
	<div>
		<button
			onclick={() => (showServices = !showServices)}
			class="text-sm text-accent-600 hover:text-accent-700"
		>
			{showServices ? 'Hide' : 'Filter by'} services ({services.length} selected)
		</button>

		{#if showServices}
			<div class="mt-2 flex flex-wrap gap-2">
				{#each allServices as service}
					<button
						onclick={() => toggleService(service)}
						class="rounded-full px-3 py-1 text-xs transition {services.includes(service)
							? 'bg-accent-600 text-white'
							: 'bg-warm-100 text-warm-500 hover:text-warm-700'}"
					>
						{service}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
