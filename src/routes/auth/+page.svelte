<script lang="ts">
	import type { ActionData } from './$types'
	import type { SubmitFunction } from '@sveltejs/kit'
	import { enhance } from '$app/forms'

	let { data, form } = $props()

	let loading = $state(false)
	let email = $state('')
	let password = $state('')

	// Reset loading state when form updates (success or error)
	$effect(() => {
		if (form) {
			loading = false
		}
	})

	const handleSubmit: SubmitFunction = () => {
		loading = true
		return async ({ result, update }) => {
			if (result.type === 'success' || result.type === 'failure') {
				loading = false
			}
			return update()
		}
	}
</script>

<div class="flex items-center justify-center min-h-screen bg-gradient-to-br from-warm-50 to-accent-50 px-4">
	<div class="w-full max-w-md">
		<!-- Logo/Title -->
		<div class="text-center mb-8">
			<h1 class="text-4xl font-bold text-warm-800 mb-2">Incident Tracker</h1>
			<p class="text-warm-600">Manage your incidents efficiently</p>
		</div>

<!-- Login Form -->
<form method="POST" class="bg-white rounded-xl shadow-lg p-8 space-y-6">
    <input type="hidden" name="action" value="default" />
    <div>
        <label for="email" class="block text-sm font-medium text-warm-700 mb-2">Email</label>
        <input
            type="email"
            id="email"
            name="email"
            bind:value={email}
            class="w-full px-4 py-2 border border-warm-200 rounded-lg input-focus"
            placeholder="your@email.com"
            required
        />
    </div>

    <div>
        <label for="password" class="block text-sm font-medium text-warm-700 mb-2">Password</label>
        <input
            type="password"
            id="password"
            name="password"
            bind:value={password}
            class="w-full px-4 py-2 border border-warm-200 rounded-lg input-focus"
            placeholder="••••••••"
            required
        />
    </div>

    {#if form?.error}
        <div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {form.error}
        </div>
    {/if}

    <button
        type="submit"
        class="w-full bg-accent-600 hover:bg-accent-700 text-white font-medium py-2 px-4 rounded-lg transition"
    >
        Sign In
    </button>
</form>

		<!-- Help Text -->
		<div class="mt-6 text-center text-sm text-warm-600">
			<p>Demo credentials: Use your Supabase auth account</p>
		</div>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
	}
</style>
