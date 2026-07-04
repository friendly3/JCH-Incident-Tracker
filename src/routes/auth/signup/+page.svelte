<script lang="ts">
	import type { ActionData } from './$types'

	let { form } = $props()

	let loading = $state(false)
	let email = $state('')
	let password = $state('')
	let confirmPassword = $state('')
</script>

<div class="flex items-center justify-center min-h-screen bg-gradient-to-br from-warm-50 to-accent-50 px-4">
	<div class="w-full max-w-md">
		<!-- Logo/Title -->
		<div class="text-center mb-8">
			<h1 class="text-4xl font-bold text-warm-800 mb-2">Incident Tracker</h1>
			<p class="text-warm-600">Create your account</p>
		</div>

		<!-- Signup Form -->
		<form method="POST" class="bg-white rounded-xl shadow-lg p-8 space-y-6">
			<div>
				<label for="email" class="block text-sm font-medium text-warm-700 mb-2">Email</label>
				<input
					type="email"
					id="email"
					name="email"
					value={email}
					onchange={(e) => (email = e.currentTarget.value)}
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
					value={password}
					onchange={(e) => (password = e.currentTarget.value)}
					class="w-full px-4 py-2 border border-warm-200 rounded-lg input-focus"
					placeholder="••••••••"
					minlength="6"
					required
				/>
			</div>

			<div>
				<label for="confirmPassword" class="block text-sm font-medium text-warm-700 mb-2">Confirm Password</label>
				<input
					type="password"
					id="confirmPassword"
					name="confirmPassword"
					value={confirmPassword}
					onchange={(e) => (confirmPassword = e.currentTarget.value)}
					class="w-full px-4 py-2 border border-warm-200 rounded-lg input-focus"
					placeholder="••••••••"
					minlength="6"
					required
				/>
			</div>

			<!-- Success Message -->
			{#if form?.success}
				<div class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
					{form.message}
				</div>
			{/if}

			<!-- Error Message -->
			{#if form?.error}
				<div class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
					{form.error}
				</div>
			{/if}

			<button
				type="submit"
				disabled={loading}
				onclick={() => loading = true}
				class="w-full bg-accent-600 hover:bg-accent-700 disabled:bg-warm-400 disabled:opacity-60 text-white font-medium py-2 px-4 rounded-lg transition"
			>
				{loading ? 'Creating account...' : 'Create Account'}
			</button>
		</form>

		<!-- Links -->
		<div class="mt-6 text-center text-sm text-warm-600 space-y-2">
			<p>Already have an account? <a href="/auth" class="text-accent-600 hover:text-accent-700">Sign in</a></p>
			<p class="text-xs">Password must be at least 6 characters</p>
		</div>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
	}
</style>
