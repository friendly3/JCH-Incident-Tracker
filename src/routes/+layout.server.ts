import type { LayoutServerLoad } from './$types'
import type { User } from '@supabase/supabase-js'

/** Strip auth user to plain JSON so devalue never fails on non-POJO fields. */
function plainUser(user: User | null | undefined) {
	if (!user) return null
	return {
		id: user.id,
		email: user.email ?? undefined,
		phone: user.phone ?? undefined,
		role: user.role ?? undefined,
		aud: user.aud ?? undefined,
		app_metadata: user.app_metadata ?? {},
		user_metadata: user.user_metadata ?? {},
		created_at: user.created_at ?? undefined,
		last_sign_in_at: user.last_sign_in_at ?? undefined,
		updated_at: user.updated_at ?? undefined
	}
}

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const user = plainUser(locals.user)
	return {
		// Keep shape used by layout / pages (session.user + top-level user)
		session: user ? { user } : null,
		user,
		cookies: cookies.getAll()
	}
}
