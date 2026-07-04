import { browser } from '$app/environment';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Incident } from '$lib/data/incidents';
import { incidentStore } from '$lib/data/store.svelte';

/** Sync client store from SSR page data. Falls back to a browser client when supabase isn't serialised. */
export function syncIncidentStoreFromPageData(
	supabase: SupabaseClient | undefined,
	incidents: Incident[] | undefined
) {
	const list = incidents ?? [];
	const client =
		supabase ??
		(browser
			? createBrowserClient(
					import.meta.env.VITE_SUPABASE_URL,
					import.meta.env.VITE_SUPABASE_ANON_KEY
				)
			: null);

	if (client) {
		incidentStore.syncFromServer(client, list);
	}
}

/** Prefer hydrated store data; fall back to SSR payload before the client store initialises. */
export function incidentsFromPageData(storeList: Incident[], pageIncidents: Incident[] | undefined) {
	return incidentStore.isInitialized ? storeList : (pageIncidents ?? []);
}