import { createDb } from '$lib/supabase/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	try {
		const db = createDb(locals.supabase);
		let [incidentTypes, incidentActions, respondedByOptions] = await Promise.all([
			db.getIncidentTypes(),
			db.getIncidentActions(),
			db.getRespondedByOptions()
		]);

		if ((respondedByOptions ?? []).length === 0) {
			await db.seedRespondedByFromTeamLeaders();
			respondedByOptions = await db.getRespondedByOptions();
		}

		return {
			incidentTypes: incidentTypes ?? [],
			incidentActions: incidentActions ?? [],
			respondedByOptions: respondedByOptions ?? [],
			loadError: null as string | null
		};
	} catch (error) {
		console.error('Dropdowns load error:', error);
		return {
			incidentTypes: [],
			incidentActions: [],
			respondedByOptions: [],
			loadError: error instanceof Error ? error.message : 'Failed to load dropdown values'
		};
	}
};
