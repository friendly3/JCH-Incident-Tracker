import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { error, redirect, type Handle, type HandleServerError } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { env as privateEnv } from '$env/dynamic/private'

/**
 * Vite only inlines *static* `import.meta.env.VITE_*` access — dynamic
 * `import.meta.env[key]` is always undefined. Prefer static reads.
 */
function resolveSupabaseConfig(platformEnv?: Record<string, unknown> | null) {
	const processEnv =
		typeof process !== 'undefined' && process.env ? process.env : undefined

	const supabaseUrl =
		privateEnv.VITE_SUPABASE_URL ||
		privateEnv.PUBLIC_SUPABASE_URL ||
		privateEnv.SUPABASE_URL ||
		(typeof platformEnv?.VITE_SUPABASE_URL === 'string'
			? platformEnv.VITE_SUPABASE_URL
			: '') ||
		(typeof platformEnv?.PUBLIC_SUPABASE_URL === 'string'
			? platformEnv.PUBLIC_SUPABASE_URL
			: '') ||
		(typeof platformEnv?.SUPABASE_URL === 'string' ? platformEnv.SUPABASE_URL : '') ||
		processEnv?.VITE_SUPABASE_URL ||
		processEnv?.PUBLIC_SUPABASE_URL ||
		processEnv?.SUPABASE_URL ||
		// Static property access — required for Vite build-time inlining
		import.meta.env.VITE_SUPABASE_URL ||
		''

	const supabaseAnonKey =
		privateEnv.VITE_SUPABASE_ANON_KEY ||
		privateEnv.PUBLIC_SUPABASE_ANON_KEY ||
		privateEnv.SUPABASE_ANON_KEY ||
		(typeof platformEnv?.VITE_SUPABASE_ANON_KEY === 'string'
			? platformEnv.VITE_SUPABASE_ANON_KEY
			: '') ||
		(typeof platformEnv?.PUBLIC_SUPABASE_ANON_KEY === 'string'
			? platformEnv.PUBLIC_SUPABASE_ANON_KEY
			: '') ||
		(typeof platformEnv?.SUPABASE_ANON_KEY === 'string'
			? platformEnv.SUPABASE_ANON_KEY
			: '') ||
		processEnv?.VITE_SUPABASE_ANON_KEY ||
		processEnv?.PUBLIC_SUPABASE_ANON_KEY ||
		processEnv?.SUPABASE_ANON_KEY ||
		import.meta.env.VITE_SUPABASE_ANON_KEY ||
		''

	return {
		supabaseUrl: typeof supabaseUrl === 'string' ? supabaseUrl.trim() : '',
		supabaseAnonKey: typeof supabaseAnonKey === 'string' ? supabaseAnonKey.trim() : ''
	}
}

// Create Supabase server client for SSR
export const supabase: Handle = async ({ event, resolve }) => {
	const platformEnv = (event.platform as { env?: Record<string, unknown> } | undefined)?.env
	const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig(platformEnv)

	if (!supabaseUrl || !supabaseAnonKey) {
		error(
			500,
			'Missing Supabase configuration (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Set both in Cloudflare Pages → Settings → Environment variables for Production (and Preview), enable Build + Runtime, then redeploy.'
		)
	}

	event.locals.supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' })
				})
			}
		}
	})

	// Never let auth network / JWT errors become an unhandled 500 for every page
	try {
		const {
			data: { user },
			error: authError
		} = await event.locals.supabase.auth.getUser()

		if (authError) {
			console.error('Supabase getUser error:', authError.message)
		}

		event.locals.session = user ? { user } : null
		event.locals.user = user ?? null
	} catch (err) {
		console.error('Supabase getUser threw:', err)
		event.locals.session = null
		event.locals.user = null
	}

	return resolve(event)
}

// Protect routes that require authentication
export const authorize: Handle = async ({ event, resolve }) => {
	const protectedRoutes = ['/', '/dashboard', '/team', '/facility', '/admin']

	const isProtected = protectedRoutes.some(
		(route) => event.url.pathname === route || event.url.pathname.startsWith(route + '/')
	)

	if (isProtected && !event.locals.user) {
		redirect(303, '/auth')
	}

	// If on auth page (but not logout) and already authenticated, redirect to dashboard
	if (
		event.url.pathname.startsWith('/auth') &&
		!event.url.pathname.startsWith('/auth/logout') &&
		event.locals.user
	) {
		redirect(303, '/dashboard')
	}

	return resolve(event)
}

export const handle: Handle = sequence(supabase, authorize)

/** Prefer a real message over the default "Internal Error" shell. */
export const handleError: HandleServerError = ({ error: err, event }) => {
	const message =
		err instanceof Error
			? err.message
			: typeof err === 'string'
				? err
				: 'An unexpected error occurred'
	console.error(`[handleError] ${event.request.method} ${event.url.pathname}:`, err)
	return { message }
}
