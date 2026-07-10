import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Server-side geocode proxy (Nominatim).
 * Avoids browser CORS and keeps a proper User-Agent for OSM policy.
 * Rate-limit politely: clients should space requests (~1/s when uncached).
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const q = url.searchParams.get('q')?.trim();
	if (!q || q.length < 3) {
		return json({ error: 'Missing or short q' }, { status: 400 });
	}

	const nominatim = new URL('https://nominatim.openstreetmap.org/search');
	nominatim.searchParams.set('q', q);
	nominatim.searchParams.set('format', 'json');
	nominatim.searchParams.set('limit', '1');
	nominatim.searchParams.set('countrycodes', 'au');
	nominatim.searchParams.set('addressdetails', '0');

	try {
		const res = await fetch(nominatim.toString(), {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'JCH-Incident-Tracker/0.3 (https://github.com/friendly3/JCH-Incident-Tracker; ops map geocode)'
			}
		});

		if (!res.ok) {
			return json({ error: 'Upstream geocode failed', status: res.status }, { status: 502 });
		}

		const data = (await res.json()) as {
			lat: string;
			lon: string;
			display_name?: string;
		}[];

		const hit = data[0];
		if (!hit?.lat || !hit?.lon) {
			return json({ found: false }, { status: 200 });
		}

		const lat = parseFloat(hit.lat);
		const lng = parseFloat(hit.lon);
		// Rough Australia / NSW-ish window
		if (lat < -44 || lat > -10 || lng < 112 || lng > 154) {
			return json({ found: false, reason: 'outside_au' }, { status: 200 });
		}

		return json({
			found: true,
			lat,
			lng,
			label: hit.display_name ?? q,
			precision: 'street' as const
		});
	} catch (err) {
		console.error('geocode proxy error', err);
		return json({ error: 'Geocode request failed' }, { status: 502 });
	}
};
