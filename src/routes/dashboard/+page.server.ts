import { createDb } from '$lib/supabase/queries'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const db = createDb(locals.supabase)

	try {
		const [incidents, respondedByOptions] = await Promise.all([
			db.getIncidents(),
			db.getRespondedByOptions()
		])
		return { incidents, respondedByOptions, loadError: null as string | null }
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load incidents'
		console.error('Dashboard load error:', err)
		return { incidents: [], respondedByOptions: [], loadError: message }
	}
}
