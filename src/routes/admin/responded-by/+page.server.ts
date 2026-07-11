import { createDb } from '$lib/supabase/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	try {
		const db = createDb(locals.supabase);
		let options = await db.getRespondedByOptions();

		// First visit after migration: seed from team leaders if empty
		if (options.length === 0) {
			await db.seedRespondedByFromTeamLeaders();
			options = await db.getRespondedByOptions();
		}

		return {
			respondedByOptions: options,
			loadError: null as string | null
		};
	} catch (error) {
		console.error('Responded By load error:', error);
		return {
			respondedByOptions: [],
			loadError: error instanceof Error ? error.message : 'Failed to load Responded By options'
		};
	}
};
