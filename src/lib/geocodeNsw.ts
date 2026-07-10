/**
 * Lightweight NSW geocoding for map pins.
 * 1) Known suburb centroids (instant, offline)
 * 2) Nominatim (OpenStreetMap) for street-level when available
 * Results are cached in-memory + localStorage.
 */

export type GeoPoint = {
	lat: number;
	lng: number;
	/** street | suburb | fallback */
	precision: 'street' | 'suburb' | 'region';
	label: string;
};

/** Approximate centroids for common delivery suburbs (NSW). Expand as needed. */
const SUBURB_CENTROIDS: Record<string, { lat: number; lng: number }> = {
	menai: { lat: -34.0147, lng: 151.0126 },
	jannali: { lat: -34.0161, lng: 151.0647 },
	sutherland: { lat: -34.0317, lng: 151.0581 },
	cronulla: { lat: -34.0575, lng: 151.1522 },
	miranda: { lat: -34.0336, lng: 151.1003 },
	caringbah: { lat: -34.0354, lng: 151.1225 },
	engadine: { lat: -34.0656, lng: 151.0139 },
	heathcote: { lat: -34.0847, lng: 151.0081 },
	loftus: { lat: -34.0453, lng: 151.0497 },
	yarrawarrah: { lat: -34.055, lng: 151.032 },
	bangor: { lat: -34.0169, lng: 151.0019 },
	illawong: { lat: -33.999, lng: 151.035 },
	'como west': { lat: -34.004, lng: 151.062 },
	como: { lat: -33.9995, lng: 151.068 },
	'oyster bay': { lat: -34.003, lng: 151.078 },
	'bonnet bay': { lat: -34.01, lng: 151.052 },
	kirrawee: { lat: -34.035, lng: 151.072 },
	gymea: { lat: -34.035, lng: 151.085 },
	'gymea bay': { lat: -34.05, lng: 151.088 },
	'grays point': { lat: -34.055, lng: 151.075 },
	woolooware: { lat: -34.045, lng: 151.145 },
	bundeena: { lat: -34.085, lng: 151.151 },
	sylvania: { lat: -34.015, lng: 151.105 },
	'taren point': { lat: -34.02, lng: 151.12 },
	sydney: { lat: -33.8688, lng: 151.2093 }
};

const memoryCache = new Map<string, GeoPoint | null>();
const STORAGE_KEY = 'nsw-geocode-v1';

function loadStorage(): Record<string, GeoPoint | null> {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		return JSON.parse(raw) as Record<string, GeoPoint | null>;
	} catch {
		return {};
	}
}

function saveStorage(map: Record<string, GeoPoint | null>) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		/* quota */
	}
}

function suburbKey(suburb: string): string {
	return suburb.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getCached(key: string): GeoPoint | null | undefined {
	if (memoryCache.has(key)) return memoryCache.get(key);
	const store = loadStorage();
	if (key in store) {
		memoryCache.set(key, store[key]);
		return store[key];
	}
	return undefined;
}

function setCached(key: string, value: GeoPoint | null) {
	memoryCache.set(key, value);
	const store = loadStorage();
	store[key] = value;
	saveStorage(store);
}

function suburbCentroid(suburb: string): GeoPoint | null {
	const hit = SUBURB_CENTROIDS[suburbKey(suburb)];
	if (!hit) return null;
	return {
		lat: hit.lat,
		lng: hit.lng,
		precision: 'suburb',
		label: `${suburb}, NSW`
	};
}

/** Default map view: Sydney CBD, NSW, Australia. */
export const SYDNEY_CENTER: [number, number] = [-33.8688, 151.2093];
/** Zoom that shows greater Sydney (suburbs still readable). */
export const SYDNEY_DEFAULT_ZOOM = 11;

/** @deprecated Prefer SYDNEY_CENTER — kept as alias for callers. */
export const NSW_CENTER: [number, number] = SYDNEY_CENTER;

/** Soft NSW bounding box (pan clamp / fit fallback). */
export const NSW_BOUNDS: [[number, number], [number, number]] = [
	[-37.55, 140.95],
	[-28.1, 153.7]
];

/**
 * Geocode a street + suburb in NSW.
 * Prefers Nominatim street-level; falls back to suburb centroid.
 */
export async function geocodeNswLocation(
	query: string,
	suburb: string
): Promise<GeoPoint | null> {
	const cacheKey = query.trim().toLowerCase();
	const cached = getCached(cacheKey);
	if (cached !== undefined) return cached;

	// Try OpenStreetMap Nominatim (rate-limit friendly: caller should stagger)
	try {
		const url = new URL('https://nominatim.openstreetmap.org/search');
		url.searchParams.set('q', query);
		url.searchParams.set('format', 'json');
		url.searchParams.set('limit', '1');
		url.searchParams.set('countrycodes', 'au');
		url.searchParams.set('addressdetails', '0');

		const res = await fetch(url.toString(), {
			headers: {
				Accept: 'application/json',
				// Policy: identify the application
				'User-Agent': 'JCH-Incident-Tracker/0.3 (dashboard map; local ops tool)'
			}
		});
		if (res.ok) {
			const data = (await res.json()) as { lat: string; lon: string; display_name?: string }[];
			if (data[0]?.lat && data[0]?.lon) {
				const point: GeoPoint = {
					lat: parseFloat(data[0].lat),
					lng: parseFloat(data[0].lon),
					precision: 'street',
					label: data[0].display_name ?? query
				};
				// Sanity: must land roughly in NSW
				if (point.lat >= -38 && point.lat <= -28 && point.lng >= 140 && point.lng <= 154) {
					setCached(cacheKey, point);
					return point;
				}
			}
		}
	} catch {
		/* network / CORS — fall through */
	}

	const fallback = suburbCentroid(suburb);
	setCached(cacheKey, fallback);
	return fallback;
}

/** Geocode many locations with ~1.1s spacing (Nominatim courtesy). */
export async function geocodeMany(
	items: { key: string; query: string; suburb: string }[],
	onProgress?: (done: number, total: number) => void
): Promise<Map<string, GeoPoint>> {
	const out = new Map<string, GeoPoint>();
	let done = 0;
	for (const item of items) {
		const point = await geocodeNswLocation(item.query, item.suburb);
		if (point) out.set(item.key, point);
		done += 1;
		onProgress?.(done, items.length);
		// Avoid hammering Nominatim when not cached
		if (getCached(item.query.trim().toLowerCase()) === undefined) {
			await new Promise((r) => setTimeout(r, 1100));
		} else {
			await new Promise((r) => setTimeout(r, 50));
		}
	}
	return out;
}
