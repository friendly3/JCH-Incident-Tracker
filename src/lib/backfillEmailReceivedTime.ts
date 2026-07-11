/**
 * One-off / manual backfill: ensure email-received time is populated and
 * displayed from stored incident fields.
 *
 * Sources (in order):
 * 1) Existing `time` column (normalize HH:mm:ss → HH:mm)
 * 2) ISO / datetime embedded in `date_received` (split into date + time)
 * 3) Leave blank if neither available (true mailbox Date needs import-side capture)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Incident } from '$lib/data/incidents';
import { createDb } from '$lib/supabase/queries';
import {
	normalizeDateOnly,
	normalizeTimeField,
	splitDateTimeToLocalParts
} from '$lib/formatDate';

export type EmailTimeBackfillResult = {
	scanned: number;
	updated: number;
	normalizedTimeOnly: number;
	splitFromDateReceived: number;
	skippedAlreadySet: number;
	skippedNoTimeSource: number;
	errors: string[];
	samples: { id: string; ref: string; date: string; time: string; how: string }[];
};

export { splitDateTimeToLocalParts };

export async function backfillEmailReceivedTimes(options: {
	supabase: SupabaseClient;
	incidents: Incident[];
	/** When true, only fill blank `time` (default). */
	onlyBlankTime?: boolean;
}): Promise<EmailTimeBackfillResult> {
	const onlyBlank = options.onlyBlankTime !== false;
	const db = createDb(options.supabase);

	const result: EmailTimeBackfillResult = {
		scanned: options.incidents.length,
		updated: 0,
		normalizedTimeOnly: 0,
		splitFromDateReceived: 0,
		skippedAlreadySet: 0,
		skippedNoTimeSource: 0,
		errors: [],
		samples: []
	};

	for (const incident of options.incidents) {
		const currentTime = normalizeTimeField(incident.time);
		const rawTime = incident.time?.trim() ?? '';
		const currentDate =
			normalizeDateOnly(incident.dateReceived) || incident.dateReceived?.trim() || '';

		let nextDate = currentDate;
		let nextTime = currentTime;
		let how = '';

		if (currentTime) {
			if (rawTime !== currentTime) {
				nextTime = currentTime;
				how = 'normalized time';
				result.normalizedTimeOnly += 1;
			} else if (onlyBlank) {
				result.skippedAlreadySet += 1;
				continue;
			}
		}

		if (!nextTime || !onlyBlank) {
			const split = splitDateTimeToLocalParts(incident.dateReceived ?? '');
			if (split?.time) {
				if (!nextTime || !onlyBlank) {
					nextDate = split.date || nextDate;
					nextTime = split.time;
					how = how || 'from date_received datetime';
					if (!currentTime) result.splitFromDateReceived += 1;
				}
			}
		}

		if (!nextTime) {
			if (!currentTime) result.skippedNoTimeSource += 1;
			else result.skippedAlreadySet += 1;
			continue;
		}

		const dateChanged =
			!!nextDate && nextDate !== (normalizeDateOnly(incident.dateReceived) || '');
		const timeChanged = nextTime !== currentTime || rawTime !== nextTime;

		if (!dateChanged && !timeChanged && rawTime === nextTime) {
			result.skippedAlreadySet += 1;
			continue;
		}

		const updates: Partial<Incident> = { time: nextTime };
		if (dateChanged && nextDate) updates.dateReceived = nextDate;

		try {
			const ok = await db.updateIncident(incident.id, updates);
			if (ok) {
				result.updated += 1;
				if (result.samples.length < 12) {
					result.samples.push({
						id: incident.id,
						ref: incident.referenceNo || incident.id.slice(0, 8),
						date: nextDate,
						time: nextTime,
						how: how || 'updated'
					});
				}
			} else {
				result.errors.push(`Update failed for ${incident.referenceNo || incident.id}`);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			result.errors.push(`${incident.referenceNo || incident.id}: ${msg}`);
		}
	}

	return result;
}
