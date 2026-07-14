/**
 * Lightweight NSW geocoding for map pins.
 * 1) Street-level via /api/geocode (server Nominatim proxy) when street is known
 * 2) Known suburb centroids (offline fallback)
 * 3) Deterministic micro-offset only for co-located suburb fallbacks
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
const STORAGE_KEY = 'nsw-geocode-v4-street';

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

/** Call our server geocode proxy (avoids browser CORS on Nominatim). */
async function serverGeocode(q: string): Promise<GeoPoint | null> {
	if (typeof fetch === 'undefined') return null;
	try {
		const url = `/api/geocode?q=${encodeURIComponent(q)}`;
		const res = await fetch(url);
		if (!res.ok) return null;
		const data = (await res.json()) as {
			found?: boolean;
			lat?: number;
			lng?: number;
			label?: string;
			precision?: 'street' | 'suburb';
		};
		if (!data.found || data.lat == null || data.lng == null) return null;
		if (!inNswBounds(data.lat, data.lng)) return null;
		return {
			lat: data.lat,
			lng: data.lng,
			precision: data.precision === 'suburb' ? 'suburb' : 'street',
			label: data.label ?? q
		};
	} catch {
		return null;
	}
}

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
	const dLat = (a.lat - b.lat) * 111.32;
	const dLng =
		(a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
	return Math.hypot(dLat, dLng);
}

/** Zoom at/above this shows street-level pins; below aggregates by suburb. */
export const STREET_DETAIL_MIN_ZOOM = 13;

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

/** Where a geocode result came from (for map status / rate limiting). */
export type GeocodeSource =
	| 'browser-cache'
	| 'network'
	| 'suburb-table'
	| 'none';

export type GeocodeLookupResult = {
	point: GeoPoint | null;
	source: GeocodeSource;
};

/**
 * Geocode a street + suburb in NSW (with source metadata).
 * Prefers true street-level coords via server Nominatim; falls back to suburb centre.
 */
export async function geocodeNswLocationWithSource(
	query: string,
	suburb: string,
	opts?: { street?: string }
): Promise<GeocodeLookupResult> {
	const cacheKey = query.trim().toLowerCase();
	const cached = getCached(cacheKey);
	if (cached !== undefined) {
		// Re-apply street jitter only on suburb-precision fallbacks
		if (cached && cached.precision === 'suburb' && opts?.street) {
			const j = jitterFromKey(cached.lat, cached.lng, cacheKey);
			return {
				point: { ...cached, lat: j.lat, lng: j.lng },
				source: 'browser-cache'
			};
		}
		return { point: cached, source: cached ? 'browser-cache' : 'none' };
	}

	const street = (opts?.street ?? '').trim();
	const suburbTrim = suburb.trim();
	const centroid = suburbCentroid(suburbTrim);

	// 1) Street-level (or full query) via server proxy — preferred precision
	const streetQuery = street
		? `${street}, ${suburbTrim} NSW, Australia`
		: query || `${suburbTrim} NSW, Australia`;
	const remote = await serverGeocode(streetQuery);
	if (remote) {
		// If we know the suburb centre, reject hits that are clearly the wrong suburb
		if (centroid && kmBetween(remote, centroid) > 12) {
			// try suburb-only geocode next
		} else {
			const point: GeoPoint = {
				...remote,
				precision: street ? 'street' : remote.precision,
				label: street
					? `${street}, ${suburbTrim}, NSW`
					: (remote.label ?? `${suburbTrim}, NSW`)
			};
			setCached(cacheKey, point);
			return { point, source: 'network' };
		}
	}

	// 2) Suburb-only remote if street miss
	if (suburbTrim) {
		const remoteSuburb = await serverGeocode(`${suburbTrim} NSW, Australia`);
		if (remoteSuburb && inNswBounds(remoteSuburb.lat, remoteSuburb.lng)) {
			const point: GeoPoint = {
				...remoteSuburb,
				precision: 'suburb',
				label: `${suburbTrim}, NSW`
			};
			setCached(cacheKey, point);
			if (street) {
				const j = jitterFromKey(point.lat, point.lng, cacheKey);
				return {
					point: {
						...point,
						lat: j.lat,
						lng: j.lng,
						label: `${street}, ${suburbTrim}, NSW`
					},
					source: 'network'
				};
			}
			return { point, source: 'network' };
		}
	}

	// 3) Offline suburb centroid catalogue
	if (centroid) {
		setCached(cacheKey, centroid);
		if (street) {
			const j = jitterFromKey(centroid.lat, centroid.lng, cacheKey);
			return {
				point: {
					...centroid,
					lat: j.lat,
					lng: j.lng,
					label: `${street}, ${suburbTrim}, NSW`
				},
				source: 'suburb-table'
			};
		}
		return { point: centroid, source: 'suburb-table' };
	}

	setCached(cacheKey, null);
	return { point: null, source: 'none' };
}

/**
 * Geocode a street + suburb in NSW.
 * Prefers true street-level coords via server Nominatim; falls back to suburb centre.
 */
export async function geocodeNswLocation(
	query: string,
	suburb: string,
	opts?: { street?: string }
): Promise<GeoPoint | null> {
	const { point } = await geocodeNswLocationWithSource(query, suburb, opts);
	return point;
}

/**
 * After geocoding, spread pins that share (nearly) the same coordinates
 * so every place is visible as its own indicator.
 * @deprecated Prefer collapseOverlappingToSuburbPins for map display.
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

export type CollapsedMapPin = {
	key: string;
	lat: number;
	lng: number;
	count: number;
	suburb: string;
	/** Empty when several streets were merged into one pin. */
	street: string;
	placeCount: number;
	/** True when more than one geocoded place was collapsed. */
	merged: boolean;
	precision: GeoPoint['precision'];
	/** Streets represented (for popup). */
	streets: string[];
};

/**
 * When indicators share (nearly) the same map position, keep **one** pin and
 * label it with the **suburb** (not individual streets).
 * Isolated pins keep their street label when known.
 *
 * @param gridDecimals - lat/lng rounding for “same spot” (4 ≈ 11 m, 5 ≈ 1 m)
 */
export function collapseOverlappingToSuburbPins<
	T extends {
		key: string;
		lat: number;
		lng: number;
		count: number;
		suburb: string;
		street: string;
		precision: GeoPoint['precision'];
	}
>(items: T[], gridDecimals = 4): CollapsedMapPin[] {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const gkey = `${item.lat.toFixed(gridDecimals)},${item.lng.toFixed(gridDecimals)}`;
		const list = groups.get(gkey) ?? [];
		list.push(item);
		groups.set(gkey, list);
	}

	const out: CollapsedMapPin[] = [];
	for (const list of groups.values()) {
		const count = list.reduce((s, p) => s + p.count, 0);
		const lat = list.reduce((s, p) => s + p.lat, 0) / list.length;
		const lng = list.reduce((s, p) => s + p.lng, 0) / list.length;
		const streets = [
			...new Set(list.map((p) => p.street.trim()).filter(Boolean))
		].sort((a, b) => a.localeCompare(b));
		const suburbs = [
			...new Set(list.map((p) => p.suburb.trim()).filter(Boolean))
		];
		const suburb = suburbs[0] || 'Unknown';
		const merged = list.length > 1 || streets.length > 1;
		const precision: GeoPoint['precision'] = list.every((p) => p.precision === 'street')
			? 'street'
			: 'suburb';

		out.push({
			key: merged
				? `cluster|${suburb.toLowerCase()}|${lat.toFixed(gridDecimals)},${lng.toFixed(gridDecimals)}`
				: list[0].key,
			lat,
			lng,
			count,
			suburb,
			// Single unique street & not merged → keep street; else suburb-only label
			street: !merged && streets.length === 1 ? streets[0] : '',
			placeCount: list.length,
			merged,
			precision,
			streets
		});
	}

	return out.sort((a, b) => b.count - a.count || a.suburb.localeCompare(b.suburb));
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
		// Nominatim policy ~1 req/s when hitting the network (cached = fast)
		await new Promise((r) => setTimeout(r, 200));
	}
	return out;
}

/** Aggregate street-level geocoded places into suburb-level pins. */
export function aggregatePlacesBySuburb<
	T extends {
		key: string;
		lat: number;
		lng: number;
		count: number;
		suburb: string;
		street: string;
		precision: GeoPoint['precision'];
	}
>(
	places: T[]
): {
	key: string;
	lat: number;
	lng: number;
	count: number;
	suburb: string;
	street: string;
	placeCount: number;
	precision: 'suburb';
}[] {
	const map = new Map<
		string,
		{
			key: string;
			latSum: number;
			lngSum: number;
			n: number;
			count: number;
			suburb: string;
			placeCount: number;
		}
	>();

	for (const p of places) {
		const sk = p.suburb.trim().toLowerCase() || 'unknown';
		const existing = map.get(sk);
		if (existing) {
			existing.latSum += p.lat;
			existing.lngSum += p.lng;
			existing.n += 1;
			existing.count += p.count;
			existing.placeCount += 1;
		} else {
			map.set(sk, {
				key: `suburb|${sk}`,
				latSum: p.lat,
				lngSum: p.lng,
				n: 1,
				count: p.count,
				suburb: p.suburb,
				placeCount: 1
			});
		}
	}

	return [...map.values()]
		.map((g) => {
			const centroid = suburbCentroid(g.suburb);
			return {
				key: g.key,
				// Prefer known suburb centre for stable suburb pins; else mean of streets
				lat: centroid?.lat ?? g.latSum / g.n,
				lng: centroid?.lng ?? g.lngSum / g.n,
				count: g.count,
				suburb: g.suburb,
				street: '',
				placeCount: g.placeCount,
				precision: 'suburb' as const
			};
		})
		.sort((a, b) => b.count - a.count);
}
