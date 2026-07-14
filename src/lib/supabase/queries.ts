import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'
import type { Facility } from '../data/facilities'
import type {
	Incident,
	IncidentSource,
	IncidentType,
	IncidentAction,
	RespondedByOption
} from '../data/incidents'
import type { TeamLeader, Driver } from '../data/team'
import {
	normalizeDateOnly,
	normalizeTimeField,
	splitDateTimeToLocalParts
} from '../formatDate'

export type SupabaseFacility = Database['public']['Tables']['facilities']['Row']
export type SupabaseIncident = Database['public']['Tables']['incidents']['Row']

export const INCIDENT_SENDER_MIGRATION = 'add_incident_sender_marked_source.sql'
export const INCIDENT_NORMALIZATION_MIGRATION = 'normalise_incidents_lookup_tables.sql'
export const INCIDENT_LOCATION_MIGRATION = 'add_incident_location_fields.sql'
export const INCIDENT_LOCATION_COORDS_MIGRATION = 'add_incident_location_coords.sql'
export const RESPONDED_BY_MIGRATION = 'add_responded_by_lookup.sql'
export const EMAIL_RECEIVED_TIME_MIGRATION = 'add_email_received_time.sql'
export const INCIDENT_UPDATED_BY_MIGRATION = 'add_incident_updated_by.sql'
/** @deprecated Use INCIDENT_SENDER_MIGRATION or INCIDENT_NORMALIZATION_MIGRATION */
export const INCIDENT_SCHEMA_MIGRATION = INCIDENT_SENDER_MIGRATION

/** Display name for audit fields (full name → name → email). */
export function userDisplayName(
	user:
		| {
				email?: string | null
				user_metadata?: Record<string, unknown> | null
		  }
		| null
		| undefined
): string {
	if (!user) return ''
	const meta = user.user_metadata ?? {}
	const full =
		typeof meta.full_name === 'string' ? meta.full_name.trim() : ''
	const name = typeof meta.name === 'string' ? meta.name.trim() : ''
	return full || name || user.email?.trim() || 'Unknown user'
}

export type IncidentAudit = {
	userId?: string | null
	userName?: string | null
}

function normalizeIncidentSource(value: string | null | undefined): IncidentSource {
	return value?.trim().toLowerCase() === 'ui' ? 'ui' : 'import'
}

const NORMALIZATION_SCHEMA_MARKERS = [
	'type_id',
	'action_id',
	'driver_id',
	'team_leader_id',
	'incident_types',
	'incident_actions',
	'drivers',
	'team_leaders'
] as const

const SENDER_SCHEMA_MARKERS = ['sender', 'marked', 'source'] as const
const LOCATION_SCHEMA_MARKERS = ['location_street', 'location_suburb'] as const
const LOCATION_COORDS_SCHEMA_MARKERS = [
	'location_lat',
	'location_lng',
	'location_precision',
	'location_geocoded_at'
] as const
const EMAIL_RECEIVED_TIME_MARKERS = ['email_received_time'] as const
const UPDATED_BY_SCHEMA_MARKERS = ['updated_by', 'updated_by_name'] as const

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Match whole column/table tokens — avoids `sender` matching inside `email_sender`. */
function messageMentionsToken(message: string, token: string): boolean {
	const escaped = escapeRegExp(token)
	if (new RegExp(`['"]${escaped}['"]`, 'i').test(message)) return true
	return new RegExp(`(?<![.\\w])${escaped}(?![.\\w])`, 'i').test(message)
}

function messageMentionsAny(message: string, markers: readonly string[]): boolean {
	return markers.some((marker) => messageMentionsToken(message, marker))
}

function messageMentionsSenderMarkers(message: string): boolean {
	return SENDER_SCHEMA_MARKERS.some((marker) => messageMentionsToken(message, marker))
}

function getIncidentSchemaErrorMessage(error: { message?: string; code?: string }): string | null {
	const msg = error.message?.toLowerCase() ?? ''
	const isSchemaMismatch =
		error.code === '42703' ||
		msg.includes('does not exist') ||
		(msg.includes('column') && msg.includes('incidents'))

	if (!isSchemaMismatch) return null

	if (messageMentionsAny(msg, NORMALIZATION_SCHEMA_MARKERS)) {
		return `Database migration required. Please apply ${INCIDENT_NORMALIZATION_MIGRATION}.`
	}

	if (messageMentionsSenderMarkers(msg)) {
		return `Database migration required. Please apply ${INCIDENT_SENDER_MIGRATION}.`
	}

	if (messageMentionsAny(msg, LOCATION_SCHEMA_MARKERS)) {
		return `Database migration required. Please apply ${INCIDENT_LOCATION_MIGRATION}.`
	}

	if (messageMentionsAny(msg, LOCATION_COORDS_SCHEMA_MARKERS)) {
		return `Database migration required. Please apply ${INCIDENT_LOCATION_COORDS_MIGRATION}.`
	}

	if (messageMentionsAny(msg, EMAIL_RECEIVED_TIME_MARKERS)) {
		return `Database migration required. Please apply ${EMAIL_RECEIVED_TIME_MIGRATION}.`
	}

	if (messageMentionsAny(msg, UPDATED_BY_SCHEMA_MARKERS)) {
		return `Database migration required. Please apply ${INCIDENT_UPDATED_BY_MIGRATION}.`
	}

	return `Database schema mismatch. Please apply pending migrations: ${INCIDENT_NORMALIZATION_MIGRATION}, ${INCIDENT_SENDER_MIGRATION}, ${INCIDENT_LOCATION_MIGRATION}, ${INCIDENT_LOCATION_COORDS_MIGRATION}, ${EMAIL_RECEIVED_TIME_MIGRATION}, and ${INCIDENT_UPDATED_BY_MIGRATION}.`
}

function parseCoord(value: unknown): number | null {
	if (value == null || value === '') return null
	const n = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(n) ? n : null
}

function parsePrecision(
	value: unknown
): 'street' | 'suburb' | 'region' | null {
	const s = String(value ?? '').trim().toLowerCase()
	if (s === 'street' || s === 'suburb' || s === 'region') return s
	return null
}

// Convert Supabase row to our app's Facility type
export function toFacility(row: SupabaseFacility): Facility {
	return {
		id: row.id,
		name: row.name,
		provider: row.provider || '',
		type: row.type as any,
		address: row.address || '',
		suburb: row.suburb || '',
		state: row.state || '',
		postcode: row.postcode || '',
		phone: row.phone || '',
		starRating: row.star_rating || 0,
		qualityMeasures: row.quality_measures as any || { residents: 0, compliance: 0, staffing: 0, quality: 0 },
		services: row.services || [],
		totalBeds: row.total_beds || 0,
		availableBeds: row.available_beds || 0,
		dailyPrice: row.daily_price as any || { from: 0, to: 0 },
		refundableDeposit: row.refundable_deposit as any || { from: 0, to: 0 },
		description: row.description || '',
		lastAuditDate: row.last_audit_date || '',
		complianceStatus: row.compliance_status as any || 'Met',
		latitude: row.latitude || 0,
		longitude: row.longitude || 0,
		funding: row.funding || 0
	}
}

// Convert app Incident to Supabase format
export function toIncidentInsert(
	incident: Incident,
	userId?: string,
	audit?: IncidentAudit
): any {
	const receivedTime = normalizeTimeField(incident.time) || incident.time?.trim() || ''
	const now = new Date().toISOString()
	const editorId = audit?.userId ?? userId ?? null
	const editorName = audit?.userName?.trim() || null
	return {
		id: incident.id,
		reference_no: incident.referenceNo,
		date_received: incident.dateReceived,
		// Legacy column kept for older rows / tools; primary received clock is email_received_time
		time: receivedTime,
		email_received_time: receivedTime || null,
		type_id: incident.typeId || null,
		driver_id: incident.driverId || null,
		team_leader_id: incident.teamLeaderId || null,
		response: incident.response,
		reference_text: incident.referenceText,
		action_id: incident.actionId || null,
		date_response: incident.dateResponse || null,
		time_response: incident.timeResponse || null,
		email_sender: incident.emailSender?.trim() || null,
		email_subject: incident.emailSubject?.trim() || null,
		location_street: incident.locationStreet?.trim() ?? '',
		location_suburb: incident.locationSuburb?.trim() ?? '',
		location_lat: parseCoord(incident.locationLat),
		location_lng: parseCoord(incident.locationLng),
		location_precision: incident.locationPrecision ?? null,
		location_geocoded_at: incident.locationGeocodedAt?.trim() || null,
		sender: incident.sender?.trim() ?? '',
		marked: incident.marked?.trim() ?? '',
		source: 'ui',
		status: 'Open',
		user_id: userId || null,
		updated_at: now,
		updated_by: editorId,
		updated_by_name: editorName
	}
}

// Convert partial Incident (camelCase) to Supabase update payload (snake_case only).
// existingSource is read from the database — email fields are omitted for imports.
export function toIncidentUpdate(
	updates: Partial<Incident>,
	existingSource: IncidentSource,
	audit?: IncidentAudit
): any {
	const payload: any = {
		updated_at: new Date().toISOString()
	};
	if (audit?.userId) payload.updated_by = audit.userId;
	if (audit?.userName?.trim()) payload.updated_by_name = audit.userName.trim();
	const allowEmailUpdate = existingSource === 'ui';

	if (updates.referenceNo !== undefined) payload.reference_no = updates.referenceNo;
	if (updates.dateReceived !== undefined) payload.date_received = updates.dateReceived;
	if (updates.time !== undefined) {
		const receivedTime = normalizeTimeField(updates.time) || updates.time?.trim() || '';
		// Date Received time in the UI maps to email_received_time only.
		// Do not overwrite legacy `time` — Apps Script may store incident/body time there.
		payload.email_received_time = receivedTime || null;
	}
	if (updates.typeId !== undefined) payload.type_id = updates.typeId || null;
	if (updates.driverId !== undefined) payload.driver_id = updates.driverId || null;
	if (updates.teamLeaderId !== undefined) payload.team_leader_id = updates.teamLeaderId || null;
	if (updates.response !== undefined) payload.response = updates.response;
	if (updates.referenceText !== undefined) payload.reference_text = updates.referenceText;
	if (updates.actionId !== undefined) payload.action_id = updates.actionId || null;
	if (updates.dateResponse !== undefined) payload.date_response = updates.dateResponse;
	if (updates.timeResponse !== undefined) payload.time_response = updates.timeResponse;
	if (allowEmailUpdate && updates.emailSender !== undefined) {
		payload.email_sender = updates.emailSender?.trim() || null;
	}
	if (allowEmailUpdate && updates.emailSubject !== undefined) {
		payload.email_subject = updates.emailSubject?.trim() || null;
	}
	if (updates.locationStreet !== undefined) {
		payload.location_street = updates.locationStreet?.trim() ?? '';
	}
	if (updates.locationSuburb !== undefined) {
		payload.location_suburb = updates.locationSuburb?.trim() ?? '';
	}
	if (updates.locationLat !== undefined) {
		payload.location_lat = parseCoord(updates.locationLat);
	}
	if (updates.locationLng !== undefined) {
		payload.location_lng = parseCoord(updates.locationLng);
	}
	if (updates.locationPrecision !== undefined) {
		payload.location_precision = updates.locationPrecision ?? null;
	}
	if (updates.locationGeocodedAt !== undefined) {
		payload.location_geocoded_at = updates.locationGeocodedAt?.trim() || null;
	}
	if (updates.sender !== undefined) payload.sender = updates.sender?.trim() ?? '';
	if (updates.marked !== undefined) payload.marked = updates.marked?.trim() ?? '';

	return payload;
}

export function createDb(supabase: SupabaseClient) {
	return {
		// Facilities
		async getFacilities(): Promise<Facility[]> {
			const { data, error } = await supabase
				.from('facilities')
				.select('*')
				.order('name')

			if (error) {
				console.error('Error fetching facilities:', error)
				return []
			}

			return (data || []).map(toFacility)
		},

		async getFacilityById(id: string): Promise<Facility | null> {
			const { data, error } = await supabase
				.from('facilities')
				.select('*')
				.eq('id', id)
				.single()

			if (error || !data) return null
			return toFacility(data)
		},

		// Lookup tables
		async getIncidentTypes(): Promise<IncidentType[]> {
			const { data, error } = await supabase
				.from('incident_types')
				.select('*')
				.order('name')
			if (error) {
				console.error('Error fetching incident types:', error)
				return []
			}
			return (data || []).map(row => ({ id: row.id, name: row.name }))
		},

		async addIncidentType(name: string): Promise<IncidentType | null> {
			const { data, error } = await supabase
				.from('incident_types')
				.insert({ name: name.trim().toUpperCase() })
				.select()
				.single()
			if (error) { console.error('Error adding incident type:', error); return null }
			return { id: data.id, name: data.name }
		},

		async deleteIncidentType(id: string): Promise<boolean> {
			const { error } = await supabase.from('incident_types').delete().eq('id', id);
			if (error) console.error('Error deleting incident type:', error);
			return !error;
		},

		async updateIncidentType(id: string, name: string): Promise<boolean> {
			const { error } = await supabase
				.from('incident_types')
				.update({ name: name.trim().toUpperCase() })
				.eq('id', id);
			if (error) console.error('Error updating incident type:', error);
			return !error;
		},

		async getIncidentActions(): Promise<IncidentAction[]> {
			const { data, error } = await supabase
				.from('incident_actions')
				.select('*')
				.order('name')
			if (error) {
				console.error('Error fetching incident actions:', error)
				return []
			}
			return (data || []).map(row => ({ id: row.id, name: row.name }))
		},

		async addIncidentAction(name: string): Promise<IncidentAction | null> {
			const { data, error } = await supabase
				.from('incident_actions')
				.insert({ name: name.trim().toUpperCase() })
				.select()
				.single()
			if (error) { console.error('Error adding incident action:', error); return null }
			return { id: data.id, name: data.name }
		},

		async deleteIncidentAction(id: string): Promise<boolean> {
			const { error } = await supabase.from('incident_actions').delete().eq('id', id);
			if (error) console.error('Error deleting incident action:', error);
			return !error;
		},

		async updateIncidentAction(id: string, name: string): Promise<boolean> {
			const { error } = await supabase
				.from('incident_actions')
				.update({ name: name.trim().toUpperCase() })
				.eq('id', id);
			if (error) console.error('Error updating incident action:', error);
			return !error;
		},

		// Responded By lookup (person names — preserve casing)
		async getRespondedByOptions(): Promise<RespondedByOption[]> {
			const { data, error } = await supabase.from('responded_by').select('*').order('name')
			if (error) {
				console.error('Error fetching responded_by options:', error)
				return []
			}
			return (data || []).map((row) => ({ id: row.id, name: row.name }))
		},

		/**
		 * When the lookup table is empty, copy team leader names into it.
		 * Safe to call repeatedly (unique on name).
		 */
		async seedRespondedByFromTeamLeaders(): Promise<number> {
			const leaders = await this.getTeamLeaders()
			const names = [
				...new Set(
					leaders
						.map((l) => l.name?.trim())
						.filter((n): n is string => !!n)
				)
			]
			if (names.length === 0) return 0
			const { data, error } = await supabase
				.from('responded_by')
				.upsert(
					names.map((name) => ({ name })),
					{ onConflict: 'name', ignoreDuplicates: true }
				)
				.select('id')
			if (error) {
				console.error('Error seeding responded_by from team leaders:', error)
				return 0
			}
			return data?.length ?? 0
		},

		/**
		 * Add a Responded By option.
		 * Returns the row, or null with a human-readable errorMessage.
		 */
		async addRespondedBy(
			name: string
		): Promise<{ option: RespondedByOption | null; errorMessage: string | null }> {
			const trimmed = name.replace(/\s+/g, ' ').trim()
			if (!trimmed) {
				return { option: null, errorMessage: 'Name is required.' }
			}

			// Pre-check (case-insensitive) so we don't mis-blame uniqueness for RLS failures
			const existing = await this.getRespondedByOptions()
			const clash = existing.find((o) => o.name.localeCompare(trimmed, undefined, { sensitivity: 'accent' }) === 0
				|| o.name.toLowerCase() === trimmed.toLowerCase())
			if (clash) {
				return {
					option: null,
					errorMessage: `“${clash.name}” is already in the list.`
				}
			}

			const { data, error } = await supabase
				.from('responded_by')
				.insert({ name: trimmed })
				.select('id, name')
				.maybeSingle()

			if (error) {
				console.error('Error adding responded_by:', error)
				const msg = (error.message || '').toLowerCase()
				const code = error.code || ''
				if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
					return {
						option: null,
						errorMessage: `“${trimmed}” already exists (exact database match).`
					}
				}
				if (code === '42501' || msg.includes('row-level security') || msg.includes('permission')) {
					return {
						option: null,
						errorMessage:
							'Permission denied writing responded_by. Run fix_responded_by_rls_grants.sql in Supabase.'
					}
				}
				if (msg.includes('does not exist') || code === '42P01' || code === 'PGRST205') {
					return {
						option: null,
						errorMessage:
							'Table responded_by is missing. Run add_responded_by_lookup.sql in Supabase.'
					}
				}
				// Insert may have succeeded but SELECT of the row failed (RLS) — try re-read
				const after = await this.getRespondedByOptions()
				const found = after.find((o) => o.name.toLowerCase() === trimmed.toLowerCase())
				if (found) {
					return { option: found, errorMessage: null }
				}
				return {
					option: null,
					errorMessage: error.message || 'Could not add Responded By value.'
				}
			}

			if (!data) {
				// No error but no row returned — re-fetch list
				const after = await this.getRespondedByOptions()
				const found = after.find((o) => o.name.toLowerCase() === trimmed.toLowerCase())
				if (found) return { option: found, errorMessage: null }
				return {
					option: null,
					errorMessage:
						'Insert did not return a row. Check RLS SELECT policy on responded_by (run fix_responded_by_rls_grants.sql).'
				}
			}

			return { option: { id: data.id, name: data.name }, errorMessage: null }
		},

		async updateRespondedBy(
			id: string,
			name: string
		): Promise<{ ok: boolean; errorMessage: string | null }> {
			const trimmed = name.replace(/\s+/g, ' ').trim()
			if (!trimmed) return { ok: false, errorMessage: 'Name is required.' }
			const { error } = await supabase
				.from('responded_by')
				.update({ name: trimmed })
				.eq('id', id)
			if (error) {
				console.error('Error updating responded_by:', error)
				const msg = (error.message || '').toLowerCase()
				const code = error.code || ''
				if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
					return { ok: false, errorMessage: `“${trimmed}” already exists.` }
				}
				return { ok: false, errorMessage: error.message || 'Could not update.' }
			}
			return { ok: true, errorMessage: null }
		},

		async deleteRespondedBy(id: string): Promise<{ ok: boolean; errorMessage: string | null }> {
			const { error } = await supabase.from('responded_by').delete().eq('id', id)
			if (error) {
				console.error('Error deleting responded_by:', error)
				return { ok: false, errorMessage: error.message || 'Could not delete.' }
			}
			return { ok: true, errorMessage: null }
		},

		// Incidents
		async getIncidents(userId?: string): Promise<Incident[]> {
			let query = supabase
				.from('incidents')
				.select(`
					*,
					incident_types ( id, name ),
					incident_actions ( id, name ),
					drivers ( id, name, username ),
					team_leaders ( id, name )
				`)
				.order('date_received', { ascending: false })

			if (userId) {
				query = query.eq('user_id', userId)
			}

			const { data, error } = await query

			if (error) {
				const schemaMessage = getIncidentSchemaErrorMessage(error)
				if (schemaMessage) {
					console.error(schemaMessage, error)
					throw new Error(schemaMessage)
				}
				console.error('Error fetching incidents:', error)
				return []
			}

			return (data || []).map((row: any) => {
				// Date Received clock: prefer email_received_time (Apps Script / Gmail),
				// then legacy `time`, then any clock embedded in date_received.
				let time =
					normalizeTimeField(row.email_received_time || '') ||
					normalizeTimeField(row.time || '');
				let dateReceived = row.date_received || '';
				if (!time && dateReceived) {
					const split = splitDateTimeToLocalParts(String(dateReceived));
					if (split?.time) {
						time = split.time;
						if (split.date) dateReceived = split.date;
					}
				} else {
					const dateOnly = normalizeDateOnly(String(dateReceived));
					if (dateOnly) dateReceived = dateOnly;
				}

				return {
					id: row.id,
					source: normalizeIncidentSource(row.source),
					emailSender: row.email_sender || '',
					emailSubject: row.email_subject || '',
					locationStreet: row.location_street || '',
					locationSuburb: row.location_suburb || '',
					locationLat: parseCoord(row.location_lat),
					locationLng: parseCoord(row.location_lng),
					locationPrecision: parsePrecision(row.location_precision),
					locationGeocodedAt: row.location_geocoded_at || null,
					dateReceived,
					time,
					sender: row.sender?.trim() ?? '',
					teamLeaderId: row.team_leader_id || null,
					teamLeader: row.team_leaders?.name || '',
					typeId: row.type_id || null,
					type: row.incident_types?.name || '',
					marked: row.marked?.trim() ?? '',
					referenceNo: row.reference_no || '',
					referenceText: row.reference_text || '',
					driverId: row.driver_id || null,
					driver: row.drivers?.username || '',
					response: row.response || '',
					dateResponse: row.date_response || '',
					timeResponse: normalizeTimeField(row.time_response || ''),
					actionId: row.action_id || null,
					// Leave blank when unset — do not invent "NEW" for display
					action: row.incident_actions?.name || '',
					updatedAt: row.updated_at || row.created_at || '',
					updatedBy: row.updated_by ?? null,
					updatedByName: row.updated_by_name?.trim() || ''
				};
			})
		},

		async addIncident(incident: Incident, userId?: string, audit?: IncidentAudit) {
			const { error } = await supabase
				.from('incidents')
				.insert(
					toIncidentInsert(incident, userId, {
						userId: audit?.userId ?? userId,
						userName: audit?.userName
					})
				)

			if (error) {
				const schemaMessage = getIncidentSchemaErrorMessage(error)
				if (schemaMessage) {
					console.error(schemaMessage, error)
					throw new Error(schemaMessage)
				}
				console.error('Error adding incident:', error)
			}
			return !error
		},

		async updateIncident(
			id: string,
			updates: Partial<Incident>,
			audit?: IncidentAudit
		) {
			const { data: existing, error: fetchError } = await supabase
				.from('incidents')
				.select('source')
				.eq('id', id)
				.single()

			if (fetchError || !existing) {
				const schemaMessage = fetchError ? getIncidentSchemaErrorMessage(fetchError) : null
				if (schemaMessage) {
					console.error(schemaMessage, fetchError)
					throw new Error(schemaMessage)
				}
				console.error('Error fetching incident source:', fetchError)
				return false
			}

			const existingSource = normalizeIncidentSource(existing.source)
			const { error } = await supabase
				.from('incidents')
				.update(toIncidentUpdate(updates, existingSource, audit))
				.eq('id', id)

			if (error) {
				const schemaMessage = getIncidentSchemaErrorMessage(error)
				if (schemaMessage) {
					console.error(schemaMessage, error)
					throw new Error(schemaMessage)
				}
				console.error('Error updating incident:', error)
			}
			return !error
		},

		/**
		 * Lightweight lat/lng write-back for the map (no source fetch / audit churn).
		 * Used when backfilling coords after a first-time geocode.
		 */
		async updateIncidentCoords(
			id: string,
			coords: {
				locationLat: number
				locationLng: number
				locationPrecision: 'street' | 'suburb' | 'region'
				locationGeocodedAt: string
			}
		): Promise<boolean> {
			const { error } = await supabase
				.from('incidents')
				.update({
					location_lat: coords.locationLat,
					location_lng: coords.locationLng,
					location_precision: coords.locationPrecision,
					location_geocoded_at: coords.locationGeocodedAt
				})
				.eq('id', id)

			if (error) {
				const schemaMessage = getIncidentSchemaErrorMessage(error)
				if (schemaMessage) {
					console.error(schemaMessage, error)
					throw new Error(schemaMessage)
				}
				console.error('Error updating incident coords:', id, error)
				return false
			}
			return true
		},

		async deleteIncident(id: string) {
			const { error } = await supabase
				.from('incidents')
				.delete()
				.eq('id', id)

			if (error) console.error('Error deleting incident:', error)
			return !error
		},

		// Team Leaders
		async getTeamLeaders(userId?: string): Promise<TeamLeader[]> {
			let query = supabase
				.from('team_leaders')
				.select('*')
				.order('name')

			if (userId) {
				query = query.eq('user_id', userId)
			}

			const { data, error } = await query

			if (error) {
				console.error('Error fetching team leaders:', error)
				return []
			}

			return (data || []).map(row => ({
				id: row.id,
				name: row.name || '',
				email: row.email || undefined,
				phone: row.phone || undefined,
				created_at: row.created_at
			}))
		},

		async addTeamLeader(leader: TeamLeader, userId?: string) {
			const { error } = await supabase
				.from('team_leaders')
				.insert({
					id: leader.id,
					name: leader.name.trim().toUpperCase(),
					email: leader.email || null,
					phone: leader.phone || null,
					user_id: userId || null
				})

			if (error) console.error('Error adding team leader:', error)
			return !error
		},

		async updateTeamLeader(id: string, updates: Partial<TeamLeader>) {
			const { error } = await supabase
				.from('team_leaders')
				.update({
					name: updates.name ? updates.name.trim().toUpperCase() : undefined,
					email: updates.email || null,
					phone: updates.phone || null
				})
				.eq('id', id)

			if (error) console.error('Error updating team leader:', error)
			return !error
		},

		async deleteTeamLeader(id: string) {
			const { error } = await supabase
				.from('team_leaders')
				.delete()
				.eq('id', id)

			if (error) console.error('Error deleting team leader:', error)
			return !error
		},

		// Drivers
		async getDrivers(userId?: string): Promise<Driver[]> {
			let query = supabase
				.from('drivers')
				.select('*')
				.order('name')

			if (userId) {
				query = query.eq('user_id', userId)
			}

			const { data, error } = await query

			if (error) {
				console.error('Error fetching drivers:', error)
				return []
			}

			return (data || []).map(row => ({
				id: row.id,
				name: row.name || '',
				username: row.username || '',
				email: row.email || undefined,
				phone: row.phone || undefined,
				teamLeaderId: row.team_leader_id || undefined,
				created_at: row.created_at
			}))
		},

		async addDriver(driver: Driver, userId?: string) {
			const { error } = await supabase
				.from('drivers')
				.insert({
					id: driver.id,
					name: driver.name.trim().toUpperCase(),
					username: driver.username.trim().toUpperCase(),
					email: driver.email || null,
					phone: driver.phone || null,
					team_leader_id: driver.teamLeaderId || null,
					user_id: userId || null
				})

			if (error) console.error('Error adding driver:', error)
			return !error
		},

		async updateDriver(id: string, updates: Partial<Driver>) {
			const { error } = await supabase
				.from('drivers')
				.update({
					name: updates.name ? updates.name.trim().toUpperCase() : undefined,
					username: updates.username ? updates.username.trim().toUpperCase() : undefined,
					email: updates.email || null,
					phone: updates.phone || null,
					team_leader_id: updates.teamLeaderId || null
				})
				.eq('id', id)

			if (error) console.error('Error updating driver:', error)
			return !error
		},

		async deleteDriver(id: string) {
			const { error } = await supabase
				.from('drivers')
				.delete()
				.eq('id', id)

			if (error) console.error('Error deleting driver:', error)
			return !error
		}
	}
}
