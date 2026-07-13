/**
 * Pill class helpers for incident tables.
 *
 * Normalization convention:
 * - getTypePillClass: most-specific phrase match first (each known type has a unique palette)
 * - getActionPillClass: uppercase exact match for enum-like action values (DB enforces UPPER(name))
 */

/** Collapse whitespace and uppercase for stable type name matching. */
function normalizeTypeKey(type: string): string {
	return type.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Tailwind color classes for incident type pills (bg, text, border).
 * Each known type gets a distinct hue so e.g. Delivery Complaint ≠ Disputed Delivery.
 */
export function getTypePillClass(type: string): string {
	const key = normalizeTypeKey(type);
	if (!key) return 'bg-warm-100 text-warm-700 border-warm-200';

	// Exact / primary known types (unique colours)
	if (key === 'DELIVERY COMPLAINT' || key.includes('DELIVERY COMPLAINT')) {
		return 'bg-blue-100 text-blue-800 border-blue-200';
	}
	if (key === 'DISPUTED DELIVERY' || key.includes('DISPUTED')) {
		return 'bg-orange-100 text-orange-800 border-orange-200';
	}
	if (key === 'REDELIVERY REQUEST' || key.includes('REDELIVERY')) {
		return 'bg-sky-100 text-sky-800 border-sky-200';
	}
	if (key === 'DELIVERY REQUEST' || (key.includes('DELIVERY REQUEST') && !key.includes('RE'))) {
		return 'bg-indigo-100 text-indigo-800 border-indigo-200';
	}
	if (key === 'INCORRECT DELIVERY' || key.includes('INCORRECT')) {
		return 'bg-violet-100 text-violet-800 border-violet-200';
	}
	if (key === 'STOP DELIVERY' || (key.includes('STOP') && key.includes('DELIVERY'))) {
		return 'bg-red-100 text-red-800 border-red-200';
	}
	if (key === 'CARDING ISSUE' || key.includes('CARDING')) {
		return 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200';
	}
	if (key === 'MISSING ITEM' || key.includes('MISSING')) {
		return 'bg-rose-100 text-rose-800 border-rose-200';
	}
	if (key === 'INVESTIGATION' || key.includes('INVESTIGATION')) {
		return 'bg-amber-100 text-amber-800 border-amber-200';
	}
	if (key === 'INCIDENT REPORT' || key.includes('INCIDENT REPORT') || key === 'INCIDENT') {
		return 'bg-purple-100 text-purple-800 border-purple-200';
	}
	if (key === 'FEEDBACK' || key.includes('FEEDBACK')) {
		return 'bg-emerald-100 text-emerald-800 border-emerald-200';
	}

	// Fallback: remaining “delivery” wording that didn’t match a specific type
	if (key.includes('DELIVERY')) {
		return 'bg-cyan-100 text-cyan-800 border-cyan-200';
	}
	if (key.includes('REPORT')) {
		return 'bg-purple-100 text-purple-800 border-purple-200';
	}
	if (key.includes('COMPLAINT')) {
		return 'bg-blue-100 text-blue-800 border-blue-200';
	}

	return 'bg-warm-100 text-warm-700 border-warm-200';
}

/** Allowed priority values stored in incidents.marked */
export const INCIDENT_PRIORITIES = ['Normal', 'High', 'Urgent'] as const;
export type IncidentPriority = (typeof INCIDENT_PRIORITIES)[number];

/** Normalize legacy/blank marked values to a priority. */
export function normalizePriority(value: string | undefined | null): IncidentPriority {
	const v = (value ?? '').trim().toLowerCase();
	if (v === 'high') return 'High';
	if (v === 'urgent') return 'Urgent';
	// Empty / "none" / unknown → Normal
	return 'Normal';
}

/**
 * Tailwind classes for priority pills:
 * Normal = green, High = amber, Urgent = red.
 */
export function getPriorityPillClass(priority: string): string {
	switch (normalizePriority(priority)) {
		case 'Urgent':
			return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-200 dark:border-red-800';
		case 'High':
			return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800';
		default:
			// Normal
			return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-800';
	}
}

/** Tailwind color classes for incident action pills (bg, text, border). */
export function getActionPillClass(action: string): string {
	switch (action.toUpperCase()) {
		case 'RESOLVED':
			return 'bg-green-100 text-green-700 border-green-200';
		case 'LIT':
			return 'bg-yellow-100 text-yellow-700 border-yellow-200';
		case 'ACK':
			return 'bg-blue-100 text-blue-700 border-blue-200';
		case 'LPO':
			return 'bg-purple-100 text-purple-700 border-purple-200';
		case 'AP STAFF':
			return 'bg-orange-100 text-orange-700 border-orange-200';
		case 'NEW':
			return 'bg-red-100 text-red-700 border-red-200';
		default:
			return 'bg-warm-100 text-warm-700 border-warm-200';
	}
}

/**
 * Solid hex fills for charts, aligned with {@link getActionPillClass} families
 * (green / yellow / blue / purple / orange / red / warm grey).
 * Dark-mode variants are brighter for dark cards.
 */
export function getActionStatusChartColor(action: string, isDark = false): string {
	switch (action.toUpperCase()) {
		case 'RESOLVED':
			// green-600 / green-400
			return isDark ? '#4ade80' : '#16a34a';
		case 'LIT':
			// yellow-600 / yellow-400
			return isDark ? '#facc15' : '#ca8a04';
		case 'ACK':
			// blue-600 / blue-400
			return isDark ? '#60a5fa' : '#2563eb';
		case 'LPO':
			// purple-600 / purple-400
			return isDark ? '#c084fc' : '#9333ea';
		case 'AP STAFF':
			// orange-600 / orange-400
			return isDark ? '#fb923c' : '#ea580c';
		case 'NEW':
			// red-600 / red-400
			return isDark ? '#f87171' : '#dc2626';
		default:
			// light–medium gray (aligned with Unassigned chart buckets)
			return isDark ? '#D1D5DB' : '#9CA3AF';
	}
}