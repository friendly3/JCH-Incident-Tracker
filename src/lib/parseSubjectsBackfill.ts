/**
 * Bulk parse email subjects and write ref / type / driver / location back to incidents.
 * Creates missing incident_types and drivers as needed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Incident, IncidentType } from '$lib/data/incidents';
import type { Driver } from '$lib/data/team';
import { createDb } from '$lib/supabase/queries';
import { withGeocodedLocation } from '$lib/geocodeIncidentCoords';
import {
	matchDriverUsername,
	matchIncidentTypeName,
	parseEmailSubject
} from '$lib/parseEmailSubjectLocation';

export type SubjectBackfillResult = {
	scanned: number;
	withSubject: number;
	parsed: number;
	updated: number;
	skippedNoSubject: number;
	skippedNoParse: number;
	skippedNoChanges: number;
	typesCreated: string[];
	driversCreated: string[];
	errors: string[];
};

function isBlank(v: string | null | undefined): boolean {
	return !v || !String(v).trim();
}

/**
 * For each incident with an email subject:
 * - parse ref, type, driver, location
 * - create type/driver rows if missing
 * - update the incident when something changes
 *
 * @param fillOnlyEmpty - when true (default), only fill blank fields; still creates missing types/drivers for matching
 */
export async function backfillIncidentsFromSubjects(options: {
	supabase: SupabaseClient;
	incidents: Incident[];
	incidentTypes: IncidentType[];
	drivers: Driver[];
	userId?: string;
	/** Only write fields that are currently empty (default true). */
	fillOnlyEmpty?: boolean;
}): Promise<SubjectBackfillResult> {
	const fillOnlyEmpty = options.fillOnlyEmpty !== false;
	const db = createDb(options.supabase);

	let types = [...options.incidentTypes];
	let drivers = [...options.drivers];

	const result: SubjectBackfillResult = {
		scanned: options.incidents.length,
		withSubject: 0,
		parsed: 0,
		updated: 0,
		skippedNoSubject: 0,
		skippedNoParse: 0,
		skippedNoChanges: 0,
		typesCreated: [],
		driversCreated: [],
		errors: []
	};

	async function ensureType(typeName: string): Promise<IncidentType | null> {
		const existing = matchIncidentTypeName(typeName, types);
		if (existing) return existing;

		const created = await db.addIncidentType(typeName);
		if (!created) {
			result.errors.push(`Failed to create type “${typeName}”`);
			return null;
		}
		types = [...types, created];
		if (!result.typesCreated.includes(created.name)) {
			result.typesCreated.push(created.name);
		}
		return created;
	}

	async function ensureDriver(username: string): Promise<Driver | null> {
		const existing = matchDriverUsername(username, drivers);
		if (existing) {
			const full = drivers.find((d) => d.id === existing.id);
			return full ?? { id: existing.id, name: existing.username, username: existing.username };
		}

		const uname = username.trim().toUpperCase();
		const driver: Driver = {
			id: crypto.randomUUID(),
			name: uname,
			username: uname
		};
		const ok = await db.addDriver(driver, options.userId);
		if (!ok) {
			result.errors.push(`Failed to create driver “${uname}”`);
			return null;
		}
		drivers = [...drivers, driver].sort((a, b) =>
			a.username.localeCompare(b.username)
		);
		if (!result.driversCreated.includes(uname)) {
			result.driversCreated.push(uname);
		}
		return driver;
	}

	for (const incident of options.incidents) {
		const subject = incident.emailSubject?.trim();
		if (!subject) {
			result.skippedNoSubject += 1;
			continue;
		}
		result.withSubject += 1;

		const parsed = parseEmailSubject(subject);
		if (!parsed) {
			result.skippedNoParse += 1;
			continue;
		}
		result.parsed += 1;

		const updates: Partial<Incident> = {};

		// Reference
		if (parsed.referenceNo) {
			if (!fillOnlyEmpty || isBlank(incident.referenceNo)) {
				if (incident.referenceNo?.trim() !== parsed.referenceNo) {
					updates.referenceNo = parsed.referenceNo;
				}
			}
		}

		// Type — create if needed
		if (parsed.typeName) {
			const typeRow = await ensureType(parsed.typeName);
			if (typeRow) {
				if (!fillOnlyEmpty || !incident.typeId) {
					if (incident.typeId !== typeRow.id) {
						updates.typeId = typeRow.id;
						updates.type = typeRow.name;
					}
				}
			}
		}

		// Driver — create if needed
		if (parsed.driver) {
			const driverRow = await ensureDriver(parsed.driver);
			if (driverRow) {
				if (!fillOnlyEmpty || !incident.driverId) {
					if (incident.driverId !== driverRow.id) {
						updates.driverId = driverRow.id;
						updates.driver = driverRow.username;
					}
				}
			}
		}

		// Map location (+ coords when text is set)
		if (parsed.suburb) {
			const locEmpty =
				isBlank(incident.locationSuburb) && isBlank(incident.locationStreet);
			if (!fillOnlyEmpty || locEmpty) {
				const nextStreet = parsed.street ?? '';
				const nextSuburb = parsed.suburb;
				if (
					(incident.locationStreet ?? '').trim() !== nextStreet ||
					(incident.locationSuburb ?? '').trim() !== nextSuburb
				) {
					updates.locationStreet = nextStreet;
					updates.locationSuburb = nextSuburb;
				}
			}
		}

		// Geocode when we have (or just set) location text but no stored coords
		const mergedStreet =
			updates.locationStreet !== undefined
				? updates.locationStreet
				: incident.locationStreet;
		const mergedSuburb =
			updates.locationSuburb !== undefined
				? updates.locationSuburb
				: incident.locationSuburb;
		const needsCoords =
			!isBlank(mergedSuburb) &&
			(incident.locationLat == null ||
				incident.locationLng == null ||
				updates.locationStreet !== undefined ||
				updates.locationSuburb !== undefined);
		if (needsCoords) {
			const coords = await withGeocodedLocation({
				...incident,
				locationStreet: mergedStreet,
				locationSuburb: mergedSuburb
			});
			if (
				coords.locationLat !== incident.locationLat ||
				coords.locationLng !== incident.locationLng
			) {
				updates.locationLat = coords.locationLat;
				updates.locationLng = coords.locationLng;
				updates.locationPrecision = coords.locationPrecision;
				updates.locationGeocodedAt = coords.locationGeocodedAt;
			}
		}

		const keys = Object.keys(updates);
		if (keys.length === 0) {
			result.skippedNoChanges += 1;
			continue;
		}

		try {
			const ok = await db.updateIncident(incident.id, updates);
			if (ok) {
				result.updated += 1;
			} else {
				result.errors.push(
					`Update failed for ${incident.referenceNo || incident.id} (${keys.join(', ')})`
				);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			result.errors.push(`${incident.referenceNo || incident.id}: ${msg}`);
		}
	}

	return result;
}
