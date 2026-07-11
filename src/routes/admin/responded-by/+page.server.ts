import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Responded By is now a tab on Configuration → Dropdowns. */
export const load: PageServerLoad = async () => {
	redirect(308, '/admin/dropdowns?tab=respondedBy');
};
