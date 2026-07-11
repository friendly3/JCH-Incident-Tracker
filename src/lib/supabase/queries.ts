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
export const RESPONDED_BY_MIGRATION = 'add_responded_by_lookup.sql'
/** @deprecated Use INCIDENT_SENDER_MIGRATION or INCIDENT_NORMALIZATION_MIGRATION */
export const INCIDENT_SCHEMA_MIGRATION = INCIDENT_SENDER_MIGRATION

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

	return `Database schema mismatch. Please apply pending migrations: ${INCIDENT_NORMALIZATION_MIGRATION}, ${INCIDENT_SENDER_MIGRATION}, and ${INCIDENT_LOCATION_MIGRATION}.`
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
export function toIncidentInsert(incident: Incident, userId?: string): any {
	return {
		id: incident.id,
		reference_no: incident.referenceNo,
		date_received: incident.dateReceived,
		time: incident.time?.trim() || '',
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
		sender: incident.sender?.trim() ?? '',
		marked: incident.marked?.trim() ?? '',
		source: 'ui',
		status: 'Open',
		user_id: userId || null
	}
}

// Convert partial Incident (camelCase) to Supabase update payload (snake_case only).
// existingSource is read from the database — email fields are omitted for imports.
export function toIncidentUpdate(updates: Partial<Incident>, existingSource: IncidentSource): any {
	const payload: any = {
		updated_at: new Date().toISOString()
	};
	const allowEmailUpdate = existingSource === 'ui';

	if (updates.referenceNo !== undefined) payload.reference_no = updates.referenceNo;
	if (updates.dateReceived !== undefined) payload.date_received = updates.dateReceived;
	if (updates.time !== undefined) payload.time = updates.time?.trim() || '';
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

		async addRespondedBy(name: string): Promise<RespondedByOption | null> {
			const trimmed = name.trim()
			if (!trimmed) return null
			const { data, error } = await supabase
				.from('responded_by')
				.insert({ name: trimmed })
				.select()
				.single()
			if (error) {
				console.error('Error adding responded_by:', error)
				return null
			}
			return { id: data.id, name: data.name }
		},

		async updateRespondedBy(id: string, name: string): Promise<boolean> {
			const trimmed = name.trim()
			if (!trimmed) return false
			const { error } = await supabase
				.from('responded_by')
				.update({ name: trimmed })
				.eq('id', id)
			if (error) console.error('Error updating responded_by:', error)
			return !error
		},

		async deleteRespondedBy(id: string): Promise<boolean> {
			const { error } = await supabase.from('responded_by').delete().eq('id', id)
			if (error) console.error('Error deleting responded_by:', error)
			return !error
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
				// Prefer dedicated `time` column; else recover clock from date_received datetime
				let time = normalizeTimeField(row.time || '');
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
					action: row.incident_actions?.name || 'NEW'
				};
			})
		},

		async addIncident(incident: Incident, userId?: string) {
			const { error } = await supabase
				.from('incidents')
				.insert(toIncidentInsert(incident, userId))

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

		async updateIncident(id: string, updates: Partial<Incident>) {
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
				.update(toIncidentUpdate(updates, existingSource))
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
