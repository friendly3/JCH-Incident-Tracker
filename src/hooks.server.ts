import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { error, redirect, type Handle, type HandleServerError } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { env as privateEnv } from '$env/dynamic/private'

/**
 * Resolve Supabase URL/key from every place CF Pages / Vite may put them:
 * - $env/dynamic/private (Worker runtime bindings)
 * - event.platform.env (Cloudflare platform)
 * - import.meta.env (inlined at build when VITE_* is set during `npm run build`)
 */
function resolveSupabaseConfig(platformEnv?: Record<string, unknown> | null) {
	const fromImportMeta = (key: string): string => {
		const v = (import.meta.env as Record<string, unknown>)[key]
		return typeof v === 'string' && v.length > 0 ? v : ''
	}
	const fromPlatform = (key: string): string => {
		if (!platformEnv) return ''
		const v = platformEnv[key]
		return typeof v === 'string' && v.length > 0 ? v : ''
	}
	const fromPrivate = (key: string): string => {
		const v = privateEnv[key]
		return typeof v === 'string' && v.length > 0 ? v : ''
	}
	const pick = (...keys: string[]) => {
		for (const key of keys) {
			const v = fromPrivate(key) || fromPlatform(key) || fromImportMeta(key)
			if (v) return v
		}
		return ''
	}

	return {
		supabaseUrl: pick('VITE_SUPABASE_URL', 'PUBLIC_SUPABASE_URL', 'SUPABASE_URL'),
		supabaseAnonKey: pick(
			'VITE_SUPABASE_ANON_KEY',
			'PUBLIC_SUPABASE_ANON_KEY',
			'SUPABASE_ANON_KEY'
		)
	}
}

// Create Supabase server client for SSR
export const supabase: Handle = async ({ event, resolve }) => {
	const platformEnv = (
		event.platform as { env?: Record<string, unknown> } | undefined
	)?.env
	const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig(platformEnv)

	if (!supabaseUrl || !supabaseAnonKey) {
		// Surface a clear message instead of a bare "Internal Error"
		error(
			500,
			'Missing Supabase configuration (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Set them in Cloudflare Pages → Settings → Environment variables for Production and Preview (Build and runtime), then redeploy.'
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
