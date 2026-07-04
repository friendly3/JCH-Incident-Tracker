import { createDb } from '$lib/supabase/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  try {
    const db = createDb(locals.supabase);
    const [incidentTypes, incidentActions] = await Promise.all([
      db.getIncidentTypes(),
      db.getIncidentActions(),
    ]);

    return {
      incidentTypes: incidentTypes ?? [],
      incidentActions: incidentActions ?? [],
    };
  } catch (error) {
    console.error('Load error:', error);
    return {
      incidentTypes: [],
      incidentActions: [],
    };
  }
};