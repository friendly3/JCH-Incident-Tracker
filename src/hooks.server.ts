import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { error, redirect, type Handle, type HandleServerError } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { env } from '$env/dynamic/private'

function resolveSupabaseConfig() {
	// Cloudflare Pages runtime bindings + local .env (VITE_ prefix used historically)
	const supabaseUrl =
		env.VITE_SUPABASE_URL ||
		env.PUBLIC_SUPABASE_URL ||
		env.SUPABASE_URL ||
		''
	const supabaseAnonKey =
		env.VITE_SUPABASE_ANON_KEY ||
		env.PUBLIC_SUPABASE_ANON_KEY ||
		env.SUPABASE_ANON_KEY ||
		''
	return { supabaseUrl, supabaseAnonKey }
}

// Create Supabase server client for SSR
export const supabase: Handle = async ({ event, resolve }) => {
	const { supabaseUrl, supabaseAnonKey } = resolveSupabaseConfig()

	if (!supabaseUrl || !supabaseAnonKey) {
		// Surface a clear message instead of a bare "Internal Error"
		error(
			500,
			'Missing Supabase configuration (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). Set them in Cloudflare Pages → Settings → Environment variables for Production and Preview, then redeploy.'
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
