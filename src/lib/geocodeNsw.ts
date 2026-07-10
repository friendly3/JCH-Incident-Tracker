/**
 * Lightweight NSW geocoding for map pins.
 * 1) Known suburb centroids (instant, offline — primary)
 * 2) Nominatim (OpenStreetMap) for street-level when available
 * 3) Deterministic micro-offset so co-located streets stay distinguishable
 * Results are cached in-memory + localStorage.
 */

export type GeoPoint = {
	lat: number;
	lng: number;
	/** street | suburb | fallback */
	precision: 'street' | 'suburb' | 'region';
	label: string;
};

/** Approximate centroids for common delivery suburbs (NSW / greater Sydney). */
const SUBURB_CENTROIDS: Record<string, { lat: number; lng: number }> = {
	// Sutherland Shire / South
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
	'sylvania waters': { lat: -34.018, lng: 151.118 },
	'taren point': { lat: -34.02, lng: 151.12 },
	kurnell: { lat: -34.01, lng: 151.21 },
	'port hacking': { lat: -34.07, lng: 151.13 },
	woronora: { lat: -34.025, lng: 151.035 },
	'woronora heights': { lat: -34.035, lng: 151.025 },
	'alfords point': { lat: -33.985, lng: 151.02 },
	// St George / inner south
	hurstville: { lat: -33.9675, lng: 151.102 },
	kogarah: { lat: -33.961, lng: 151.134 },
	rockdale: { lat: -33.952, lng: 151.139 },
	carlton: { lat: -33.968, lng: 151.123 },
	blakehurst: { lat: -33.99, lng: 151.11 },
	'connells point': { lat: -33.99, lng: 151.09 },
	oatley: { lat: -33.98, lng: 151.08 },
	mortdale: { lat: -33.97, lng: 151.08 },
	penshurst: { lat: -33.965, lng: 151.085 },
	'beverly hills': { lat: -33.95, lng: 151.08 },
	riverwood: { lat: -33.95, lng: 151.05 },
	// Inner / CBD
	sydney: { lat: -33.8688, lng: 151.2093 },
	'surry hills': { lat: -33.883, lng: 151.212 },
	redfern: { lat: -33.893, lng: 151.205 },
	waterloo: { lat: -33.9, lng: 151.208 },
	alexandria: { lat: -33.91, lng: 151.195 },
	zetland: { lat: -33.907, lng: 151.21 },
	// Inner west
	newtown: { lat: -33.898, lng: 151.179 },
	marrickville: { lat: -33.91, lng: 151.155 },
	'dulwich hill': { lat: -33.905, lng: 151.14 },
	ashfield: { lat: -33.889, lng: 151.127 },
	burwood: { lat: -33.877, lng: 151.104 },
	strathfield: { lat: -33.876, lng: 151.088 },
	// East
	bondi: { lat: -33.891, lng: 151.274 },
	'bondi junction': { lat: -33.891, lng: 151.247 },
	randwick: { lat: -33.914, lng: 151.241 },
	maroubra: { lat: -33.95, lng: 151.244 },
	// North
	chatswood: { lat: -33.797, lng: 151.183 },
	'north sydney': { lat: -33.839, lng: 151.207 },
	mosman: { lat: -33.829, lng: 151.244 },
	manly: { lat: -33.797, lng: 151.287 },
	// West
	parramatta: { lat: -33.815, lng: 151.001 },
	blacktown: { lat: -33.769, lng: 150.906 },
	penrith: { lat: -33.751, lng: 150.694 },
	liverpool: { lat: -33.92, lng: 150.923 },
	bankstown: { lat: -33.917, lng: 151.033 },
	// Illawarra
	wollongong: { lat: -34.4278, lng: 150.8931 },
	// Central coast
	gosford: { lat: -33.4267, lng: 151.3417 }
};

const memoryCache = new Map<string, GeoPoint | null>();
/** Bump when strategy changes so stale null/bad coords are not reused. */
const STORAGE_KEY = 'nsw-geocode-v3';

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

/** Stable 32-bit hash for deterministic jitter. */
function hashString(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/**
 * Offset a lat/lng by metres (approx) so co-located pins do not stack.
 * `index` 0 stays put; later indices spiral outward.
 */
export function offsetLatLngByIndex(
	lat: number,
	lng: number,
	index: number,
	total: number
): { lat: number; lng: number } {
	if (total <= 1 || index <= 0) return { lat, lng };
	const angle = index * 2.399963; // golden-angle-ish
	const radiusM = 28 + index * 22;
	const dLat = (radiusM * Math.cos(angle)) / 111_320;
	const cosLat = Math.cos((lat * Math.PI) / 180);
	const dLng = (radiusM * Math.sin(angle)) / (111_320 * Math.max(0.2, cosLat));
	return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * Slight deterministic nudge from street name so different streets in the same
 * suburb are not identical even before multi-pin spiral.
 */
export function jitterFromKey(
	lat: number,
	lng: number,
	key: string
): { lat: number; lng: number } {
	const h = hashString(key);
	const angle = ((h % 360) * Math.PI) / 180;
	const radiusM = 12 + (h % 40); // 12–51 m
	const dLat = (radiusM * Math.cos(angle)) / 111_320;
	const cosLat = Math.cos((lat * Math.PI) / 180);
	const dLng = (radiusM * Math.sin(angle)) / (111_320 * Math.max(0.2, cosLat));
	return { lat: lat + dLat, lng: lng + dLng };
}

function inNswBounds(lat: number, lng: number): boolean {
	return lat >= -38 && lat <= -28 && lng >= 140 && lng <= 154;
}

async function nominatimSearch(q: string): Promise<GeoPoint | null> {
	try {
		const url = new URL('https://nominatim.openstreetmap.org/search');
		url.searchParams.set('q', q);
		url.searchParams.set('format', 'json');
		url.searchParams.set('limit', '1');
		url.searchParams.set('countrycodes', 'au');
		url.searchParams.set('addressdetails', '0');

		const res = await fetch(url.toString(), {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'JCH-Incident-Tracker/0.3 (dashboard map; local ops tool)'
			}
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { lat: string; lon: string; display_name?: string }[];
		if (!data[0]?.lat || !data[0]?.lon) return null;
		const lat = parseFloat(data[0].lat);
		const lng = parseFloat(data[0].lon);
		if (!inNswBounds(lat, lng)) return null;
		return {
			lat,
			lng,
			precision: 'street',
			label: data[0].display_name ?? q
		};
	} catch {
		return null;
	}
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
 * Prefers suburb centroid (reliable offline), then Nominatim, then jitter by key.
 */
export async function geocodeNswLocation(
	query: string,
	suburb: string,
	opts?: { street?: string }
): Promise<GeoPoint | null> {
	const cacheKey = query.trim().toLowerCase();
	const cached = getCached(cacheKey);
	if (cached !== undefined) {
		// Re-apply street jitter on cached suburb points so stack separation stays stable
		if (cached && cached.precision === 'suburb' && opts?.street) {
			const j = jitterFromKey(cached.lat, cached.lng, cacheKey);
			return { ...cached, lat: j.lat, lng: j.lng };
		}
		return cached;
	}

	const street = (opts?.street ?? '').trim();
	const suburbTrim = suburb.trim();

	// 1) Known suburb centroid (instant) — primary path; Nominatim often blocked in browsers
	const centroid = suburbCentroid(suburbTrim);
	if (centroid) {
		const base = street
			? (() => {
					const j = jitterFromKey(centroid.lat, centroid.lng, cacheKey);
					return { ...centroid, lat: j.lat, lng: j.lng, label: `${street}, ${suburbTrim}, NSW` };
				})()
			: centroid;
		// Still try Nominatim for better street precision when possible (non-blocking strategy: try then keep better)
		const streetQuery = street
			? `${street}, ${suburbTrim} NSW, Australia`
			: `${suburbTrim} NSW, Australia`;
		const remote = await nominatimSearch(streetQuery);
		if (remote) {
			// Prefer remote if it is close to suburb centroid (within ~8 km) — avoids wrong AU hits
			const dLat = (remote.lat - centroid.lat) * 111.32;
			const dLng =
				(remote.lng - centroid.lng) *
				111.32 *
				Math.cos((centroid.lat * Math.PI) / 180);
			const distKm = Math.hypot(dLat, dLng);
			if (distKm < 8) {
				const point: GeoPoint = {
					...remote,
					precision: street ? 'street' : 'suburb'
				};
				setCached(cacheKey, point);
				return point;
			}
		}
		setCached(cacheKey, centroid); // cache base centroid; jitter reapplied per key above
		return base;
	}

	// 2) No known suburb — try Nominatim on full query then suburb-only
	const remoteFull = await nominatimSearch(query);
	if (remoteFull) {
		setCached(cacheKey, remoteFull);
		return remoteFull;
	}
	if (suburbTrim) {
		const remoteSuburb = await nominatimSearch(`${suburbTrim} NSW, Australia`);
		if (remoteSuburb) {
			const point: GeoPoint = {
				...remoteSuburb,
				precision: 'suburb',
				label: `${suburbTrim}, NSW`
			};
			const out = street
				? (() => {
						const j = jitterFromKey(point.lat, point.lng, cacheKey);
						return { ...point, lat: j.lat, lng: j.lng };
					})()
				: point;
			setCached(cacheKey, point);
			return out;
		}
	}

	setCached(cacheKey, null);
	return null;
}

/**
 * After geocoding, spread pins that share (nearly) the same coordinates
 * so every place is visible as its own indicator.
 */
export function spreadCoincidentPoints<
	T extends { lat: number; lng: number; key: string }
>(items: T[]): T[] {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		// ~1.1 m grid — treat near-duplicates as coincident
		const gkey = `${item.lat.toFixed(5)},${item.lng.toFixed(5)}`;
		const list = groups.get(gkey) ?? [];
		list.push(item);
		groups.set(gkey, list);
	}

	const out: T[] = [];
	for (const list of groups.values()) {
		if (list.length === 1) {
			out.push(list[0]);
			continue;
		}
		// Stable order by key for deterministic spiral
		list.sort((a, b) => a.key.localeCompare(b.key));
		list.forEach((item, index) => {
			const o = offsetLatLngByIndex(item.lat, item.lng, index, list.length);
			out.push({ ...item, lat: o.lat, lng: o.lng });
		});
	}
	return out;
}

/** Geocode many locations with pacing (Nominatim courtesy). */
export async function geocodeMany(
	items: { key: string; query: string; suburb: string; street?: string }[],
	onProgress?: (done: number, total: number) => void
): Promise<Map<string, GeoPoint>> {
	const out = new Map<string, GeoPoint>();
	let done = 0;
	for (const item of items) {
		const point = await geocodeNswLocation(item.query, item.suburb, {
			street: item.street
		});
		if (point) out.set(item.key, point);
		done += 1;
		onProgress?.(done, items.length);
		await new Promise((r) => setTimeout(r, 80));
	}
	return out;
}
