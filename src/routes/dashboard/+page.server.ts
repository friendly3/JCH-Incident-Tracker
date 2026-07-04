import { createDb } from '$lib/supabase/queries'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const db = createDb(locals.supabase)

	try {
		const [incidents, incidentTypes, incidentActions, drivers, teamLeaders] = await Promise.all([
			db.getIncidents(),
			db.getIncidentTypes(),
			db.getIncidentActions(),
			db.getDrivers(),
			db.getTeamLeaders()
		])

		return {
			incidents,
			incidentTypes,
			incidentActions,
			drivers,
			teamLeaders,
			loadError: null as string | null
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load dashboard data'
		console.error('Dashboard load error:', err)
		return {
			incidents: [],
			incidentTypes: [],
			incidentActions: [],
			drivers: [],
			teamLeaders: [],
			loadError: message
		}
	}
}
