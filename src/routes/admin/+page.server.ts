import { createDb } from '$lib/supabase/queries'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const db = createDb(locals.supabase)
	const [incidentTypes, incidentActions, drivers, teamLeaders] = await Promise.all([
		db.getIncidentTypes(),
		db.getIncidentActions(),
		db.getDrivers(),
		db.getTeamLeaders()
	])

	return { incidentTypes, incidentActions, drivers, teamLeaders }
}