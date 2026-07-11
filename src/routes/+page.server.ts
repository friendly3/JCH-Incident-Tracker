import { createDb } from '$lib/supabase/queries'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const db = createDb(locals.supabase)

	try {
		const [incidents, incidentTypes, incidentActions, drivers, teamLeaders, respondedByOptions] =
			await Promise.all([
				db.getIncidents(),
				db.getIncidentTypes(),
				db.getIncidentActions(),
				db.getDrivers(),
				db.getTeamLeaders(),
				db.getRespondedByOptions()
			])

		// Seed Responded By from team leaders when the lookup is empty
		let respondedBy = respondedByOptions
		if (respondedBy.length === 0) {
			await db.seedRespondedByFromTeamLeaders()
			respondedBy = await db.getRespondedByOptions()
		}

		return {
			incidents,
			incidentTypes,
			incidentActions,
			drivers,
			teamLeaders,
			respondedByOptions: respondedBy,
			loadError: null as string | null
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to load incidents'
		console.error('Incidents page load error:', err)
		return {
			incidents: [],
			incidentTypes: [],
			incidentActions: [],
			drivers: [],
			teamLeaders: [],
			respondedByOptions: [],
			loadError: message
		}
	}
}
