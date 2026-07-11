/**
 * Pill class helpers for incident tables.
 *
 * Normalization convention:
 * - getTypePillClass: lowercase substring matching for free-text type names
 * - getActionPillClass: uppercase exact match for enum-like action values (DB enforces UPPER(name))
 */

/** Tailwind color classes for incident type pills (bg, text, border). */
export function getTypePillClass(type: string): string {
	const lower = type.toLowerCase();
	if (lower.includes('delivery') || lower.includes('redelivery')) return 'bg-blue-100 text-blue-700 border-blue-200';
	if (lower.includes('complaint') || lower.includes('disputed')) return 'bg-orange-100 text-orange-700 border-orange-200';
	if (lower.includes('feedback')) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
	if (lower.includes('incident') || lower.includes('report')) return 'bg-purple-100 text-purple-700 border-purple-200';
	if (lower.includes('investigation')) return 'bg-amber-100 text-amber-700 border-amber-200';
	if (lower.includes('missing')) return 'bg-rose-100 text-rose-700 border-rose-200';
	if (lower.includes('stop') || lower.includes('carding')) return 'bg-red-100 text-red-700 border-red-200';
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