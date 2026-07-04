import { createServerClient } from '@supabase/ssr'
import { redirect, type Handle } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { env } from '$env/dynamic/private'

// Create Supabase server client for SSR
export const supabase: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(
		env.VITE_SUPABASE_URL,
		env.VITE_SUPABASE_ANON_KEY,
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				setAll: (cookiesToSet) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						event.cookies.set(name, value, { ...options, path: '/' })
					})
				}
			}
		}
	)

	const {
		data: { user }
	} = await event.locals.supabase.auth.getUser()

	event.locals.session = user ? { user } : null
	event.locals.user = user ?? null

	return resolve(event)
}

// Protect routes that require authentication
export const authorize: Handle = async ({ event, resolve }) => {
	const protectedRoutes = ['/', '/dashboard', '/team', '/facility', '/admin']

	const isProtected = protectedRoutes.some((route) => 
		event.url.pathname === route || event.url.pathname.startsWith(route + '/')
	)

	if (isProtected && !event.locals.user) {
		redirect(303, '/auth')
	}

	// If on auth page (but not logout) and already authenticated, redirect to dashboard
	if (event.url.pathname.startsWith('/auth') && !event.url.pathname.startsWith('/auth/logout') && event.locals.user) {
		redirect(303, '/dashboard')
	}

	return resolve(event)
}

export const handle: Handle = sequence(supabase, authorize)
