import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type NominatimHit = {
	lat: string;
	lon: string;
	display_name?: string;
	class?: string;
	type?: string;
	importance?: number;
};

export type GeocodeCandidate = {
	lat: number;
	lng: number;
	label: string;
	class: string;
	type: string;
	importance: number;
};

/**
 * Server-side geocode proxy (Nominatim).
 * Avoids browser CORS and keeps a proper User-Agent for OSM policy.
 * Rate-limit politely: clients should space requests (~1/s when uncached).
 *
 * Query params:
 *  - q: free-text query (required)
 *  - limit: max candidates 1–8 (default 1 for backward compatibility)
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
	const q = url.searchParams.get('q')?.trim();
	if (!q || q.length < 3) {
		return json({ error: 'Missing or short q' }, { status: 400 });
	}

	const limitRaw = Number(url.searchParams.get('limit') ?? '1');
	const limit = Number.isFinite(limitRaw) ? Math.min(8, Math.max(1, Math.floor(limitRaw))) : 1;

	const nominatim = new URL('https://nominatim.openstreetmap.org/search');
	nominatim.searchParams.set('q', q);
	nominatim.searchParams.set('format', 'json');
	nominatim.searchParams.set('limit', String(limit));
	nominatim.searchParams.set('countrycodes', 'au');
	nominatim.searchParams.set('addressdetails', '0');

	try {
		const upstream = await fetch(nominatim.toString(), {
			headers: {
				Accept: 'application/json',
				'User-Agent':
					'JCH-Incident-Tracker/0.4 (https://github.com/friendly3/JCH-Incident-Tracker; ops map geocode)'
			},
			// Prevent map UI from hanging when Nominatim is slow
			signal: AbortSignal.timeout(7_000)
		});

		if (!upstream.ok) {
			return json(
				{ error: 'Upstream geocode failed', status: upstream.status },
				{ status: 502 }
			);
		}

		const data = (await upstream.json()) as NominatimHit[];
		const candidates: GeocodeCandidate[] = [];

		for (const hit of data) {
			if (!hit?.lat || !hit?.lon) continue;
			const lat = parseFloat(hit.lat);
			const lng = parseFloat(hit.lon);
			// Rough Australia / NSW-ish window
			if (lat < -44 || lat > -10 || lng < 112 || lng > 154) continue;
			candidates.push({
				lat,
				lng,
				label: hit.display_name ?? q,
				class: hit.class ?? '',
				type: hit.type ?? '',
				importance: typeof hit.importance === 'number' ? hit.importance : 0
			});
		}

		if (candidates.length === 0) {
			return json({ found: false, candidates: [] }, { status: 200 });
		}

		const best = candidates[0];
		return json({
			found: true,
			lat: best.lat,
			lng: best.lng,
			label: best.label,
			precision: 'street' as const,
			candidates
		});
	} catch (err) {
		console.error('geocode proxy error', err);
		return json({ error: 'Geocode request failed' }, { status: 502 });
	}
};
