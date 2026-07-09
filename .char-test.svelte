<script lang="ts">
	import type { Foo } from '$lib/foo';
	const x = `template ${1}`;
	const y = "quotes";
	const z = 'single';
</script>

<div class="test">
	{#if true}
		<button type="button" onclick={() => {}}>Click</button>
	{/if}
</div>
