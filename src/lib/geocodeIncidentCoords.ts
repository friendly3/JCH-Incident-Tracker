/**
 * Resolve an incident’s map text to lat/lng and attach fields for DB persistence.
 * Uses existing geocodeNsw cache (memory + localStorage) and Nominatim proxy.
 */
import type { Incident } from '$lib/data/incidents';
import { geocodeNswLocation, type GeoPoint } from '$lib/geocodeNsw';
import {
	resolveIncidentLocation,
	type IncidentLocationFields
} from '$lib/parseEmailSubjectLocation';

export type LocationCoordFields = {
	locationLat: number | null;
	locationLng: number | null;
	locationPrecision: 'street' | 'suburb' | 'region' | null;
	locationGeocodedAt: string | null;
};

export function emptyLocationCoords(): LocationCoordFields {
	return {
		locationLat: null,
		locationLng: null,
		locationPrecision: null,
		locationGeocodedAt: null
	};
}

export function hasStoredCoords(row: {
	locationLat?: number | null;
	locationLng?: number | null;
}): boolean {
	const lat = row.locationLat;
	const lng = row.locationLng;
	return (
		typeof lat === 'number' &&
		typeof lng === 'number' &&
		Number.isFinite(lat) &&
		Number.isFinite(lng)
	);
}

export function coordsFromGeoPoint(point: GeoPoint): LocationCoordFields {
	return {
		locationLat: point.lat,
		locationLng: point.lng,
		locationPrecision: point.precision,
		locationGeocodedAt: new Date().toISOString()
	};
}

/**
 * Geocode from manual suburb/street or email subject.
 * Returns null coords when no location text or geocode fails.
 */
export async function resolveLocationCoords(
	row: IncidentLocationFields
): Promise<LocationCoordFields> {
	const parsed = resolveIncidentLocation(row);
	if (!parsed) return emptyLocationCoords();

	const point = await geocodeNswLocation(parsed.query, parsed.suburb, {
		street: parsed.street
	});
	if (!point) return emptyLocationCoords();
	return coordsFromGeoPoint(point);
}

/** Merge geocoded coords onto an incident (for insert/update payloads). */
export async function withGeocodedLocation<T extends IncidentLocationFields>(
	incident: T
): Promise<T & LocationCoordFields> {
	const coords = await resolveLocationCoords(incident);
	return { ...incident, ...coords };
}

/** Persist helper shape used by the map after resolving a place. */
export type CoordPersistUpdate = {
	id: string;
	locationLat: number;
	locationLng: number;
	locationPrecision: 'street' | 'suburb' | 'region';
	locationGeocodedAt: string;
};

export function coordPersistFromPoint(
	ids: string[],
	point: GeoPoint
): CoordPersistUpdate[] {
	const at = new Date().toISOString();
	return ids.map((id) => ({
		id,
		locationLat: point.lat,
		locationLng: point.lng,
		locationPrecision: point.precision,
		locationGeocodedAt: at
	}));
}

/** Patch in-memory incident list after coords are saved (avoid full reload). */
export function applyCoordUpdatesToList(
	list: Incident[],
	updates: CoordPersistUpdate[]
): Incident[] {
	if (updates.length === 0) return list;
	const byId = new Map(updates.map((u) => [u.id, u]));
	return list.map((inc) => {
		const u = byId.get(inc.id);
		if (!u) return inc;
		return {
			...inc,
			locationLat: u.locationLat,
			locationLng: u.locationLng,
			locationPrecision: u.locationPrecision,
			locationGeocodedAt: u.locationGeocodedAt
		};
	});
}
