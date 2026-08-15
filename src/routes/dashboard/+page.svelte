<script lang="ts">
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { incidentStore } from '$lib/data/store.svelte';
	import { formatDate, formatDateTimeFields } from '$lib/formatDate';
	import type { Incident } from '$lib/data/incidents';
	import {
		getActionPillClass,
		getActionStatusChartColor,
		getPriorityPillClass,
		getTypeTextClass,
		normalizePriority
	} from '$lib/pillClasses';
	import {
		incidentsFromPageData,
		syncIncidentStoreFromPageData
	} from '$lib/syncIncidentStore';
	import { getDuplicateIncidentIds } from '$lib/incidentDuplicates';
	import CourierTruckIcon from '$lib/components/CourierTruckIcon.svelte';
	import NswIncidentMap from '$lib/components/NswIncidentMap.svelte';
	import {
		replaceCanvasesWithImages,
		sanitizeCloneColors,
		stripAssistiveOnly
	} from '$lib/pdfCapture';
	import {
		canonicalLeaderLabel,
		teamLeaderStatsBucket
	} from '$lib/teamLeaderStats';
	import {
		dashboardPeriod,
		TIME_RANGE_OPTIONS,
		currentMonthTimeRange,
		currentMonthYm,
		dayTimeRange,
		formatMonthYearLabel,
		isDateReceivedInTimeRange,
		isDayTimeRange,
		isMonthTimeRange,
		isYearTimeRange,
		monthKeyFromRange,
		yearTimeRange,
		type MonthTimeRangeKey,
		type TimeRangeKey
	} from '$lib/dashboardPeriod.svelte';
	import {
		dashboardUi,
		type OverTimeBucket
	} from '$lib/dashboardUi.svelte';
	import { theme } from '$lib/theme.svelte';
	import type { Chart as ChartJS, ChartOptions, Plugin } from 'chart.js';
	import { onMount, tick, untrack } from 'svelte';

	/** Lazy-load Chart.js in the browser only (keeps Worker free of canvas import cost). */
	let ChartCtor: typeof import('chart.js').Chart | null = null;

	async function ensureChartJs(): Promise<typeof import('chart.js').Chart | null> {
		if (typeof window === 'undefined') return null;
		if (ChartCtor) return ChartCtor;
		const { Chart, registerables } = await import('chart.js');
		const ChartDataLabels = (await import('chartjs-plugin-datalabels')).default;
		Chart.register(...registerables, ChartDataLabels);
		ChartCtor = Chart;
		return Chart;
	}

	function cssVar(name: string, fallback: string): string {
		if (typeof document === 'undefined') return fallback;
		const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
		return value || fallback;
	}

	function isDarkMode(): boolean {
		if (typeof document === 'undefined') return theme.isDark;
		return document.documentElement.classList.contains('dark');
	}

	function withAlpha(color: string, alpha: number): string {
		if (color.startsWith('#') && color.length === 7) {
			const r = parseInt(color.slice(1, 3), 16);
			const g = parseInt(color.slice(3, 5), 16);
			const b = parseInt(color.slice(5, 7), 16);
			return `rgba(${r}, ${g}, ${b}, ${alpha})`;
		}
		return color;
	}

	/**
	 * Chart chrome (axes / tooltips) — high-contrast neutrals independent of the
	 * teal UI accent so plots stay readable on white and dark cards.
	 */
	/** Same light gray as the NSW map basemap shell (`.nsw-incident-map` #e8e8e8). */
	const MAP_GRID_GRAY = '#e8e8e8';

	/**
	 * Incidents-by-driver horizontal bars: fixed thickness so bar height stays
	 * 16px regardless of how many drivers are in the period. Plot height scales
	 * with driver count so categories do not overlap.
	 */
	const DRIVER_BAR_THICKNESS_PX = 16;
	/**
	 * Soft rounded-rect (between square and pill). Full pill would be
	 * thickness/2 (8px); 6px keeps stacked joins flush at the ends.
	 */
	const DRIVER_BAR_RADIUS_PX = 6;
	/**
	 * Gap between bars. Chart.js spreads categories across the plot height, so
	 * slot = thickness + gap and plot height must be exactly n×slot + pad —
	 * do not flex-grow the plot or gaps balloon.
	 */
	const DRIVER_BAR_GAP_PX = 6;
	const DRIVER_BAR_SLOT_PX = DRIVER_BAR_THICKNESS_PX + DRIVER_BAR_GAP_PX;
	/** Empty-state plot height only (no drivers). */
	const DRIVER_CHART_MIN_HEIGHT_PX = 200;
	/** Axes / layout chrome outside category slots. */
	const DRIVER_CHART_PAD_PX = 48;

	/** Team-leader bars: keep 23px; driver chart was thinned separately. */
	const TEAM_LEADER_BAR_THICKNESS_PX = 23;
	const TEAM_LEADER_BAR_SLOT_PX = TEAM_LEADER_BAR_THICKNESS_PX + DRIVER_BAR_GAP_PX;

	/** Driver×month line chart: show this many highest-volume drivers by default. */
	const DRIVER_MONTH_TOP_N = 10;
	/** Shortcut in the Drivers dropdown (in addition to default top N). */
	const DRIVER_MONTH_TOP_5 = 5;

	function driverChartHeightForCount(driverCount: number): number {
		const n = Math.max(0, driverCount);
		if (n === 0) return DRIVER_CHART_MIN_HEIGHT_PX;
		// Exact height so each category band is SLOT px (bar thickness + gap)
		return n * DRIVER_BAR_SLOT_PX + DRIVER_CHART_PAD_PX;
	}

	function teamLeaderChartHeightForCount(leaderCount: number): number {
		const n = Math.max(0, leaderCount);
		if (n === 0) return DRIVER_CHART_MIN_HEIGHT_PX;
		return n * TEAM_LEADER_BAR_SLOT_PX + DRIVER_CHART_PAD_PX;
	}

	/** Over-time chart x-axis aggregation options (value persisted in dashboardUi). */
	const OVER_TIME_BUCKET_OPTIONS: { value: OverTimeBucket; label: string }[] = [
		{ value: 'day', label: 'Day' },
		{ value: 'month', label: 'Month' },
		{ value: 'year', label: 'Year' }
	];

	/**
	 * Parallel to Incidents Over Time categories.
	 * Keys are YYYY-MM-DD | YYYY-MM | YYYY depending on dashboardUi.overTimeBucket.
	 * Kept outside $derived so chart onClick/plugin can resolve without TDZ issues.
	 */
	let overTimeChartDateKeys: string[] = [];
	/** Mirror for axis chrome plugin / click handlers outside reactive contexts. */
	let overTimeChartBucket: OverTimeBucket = 'day';

	/**
	 * Driver line chart mirrors (month keys YYYY-MM; axis chrome uses month style).
	 * Declared early so the axis-chrome plugin can close over them without TDZ issues.
	 */
	let driverMonthChartBucketKeys: string[] = [];
	/** Always month — same under-label chrome as over-time month bucket. */
	let driverMonthChartBucket: OverTimeBucket = 'month';
	let driverMonthChartDriverKeys: string[] = [];
	let driverMonthChartDriverLabels: string[] = [];

	const CHART_FALLBACKS = {
		light: {
			accent: '#0072B2',
			ticks: '#3a3b3d',
			legend: '#181818',
			// Match map chart gray for axis gridlines
			grid: MAP_GRID_GRAY,
			pointBorder: '#ffffff'
		},
		dark: {
			accent: '#56B4E9',
			ticks: '#e0e2e2',
			legend: '#f8f8f8',
			// Subtle light gray on dark cards (same hue family as map gray)
			grid: MAP_GRID_GRAY,
			pointBorder: '#1e1f21'
		}
	} as const;

	/**
	 * Categorical series palette — max pairwise distinction for line/bar legends.
	 * Mix of Okabe–Ito, Paul Tol Bright, and Tableau accents. No greys (reserved
	 * for Unassigned / Unspecified). Hue order alternates warm/cool so adjacent
	 * hash slots stay far apart.
	 */
	const SERIES_PALETTE_LIGHT = [
		'#0072B2', // blue
		'#E69F00', // orange / gold
		'#009E73', // bluish green
		'#CC3311', // strong red
		'#332288', // indigo
		'#EE7733', // bright orange
		'#117733', // forest
		'#AA3377', // magenta
		'#56B4E9', // sky blue
		'#661100', // brown
		'#44AA99', // teal
		'#882255', // wine
		'#999933', // olive
		'#DD4477', // rose
		'#4477AA', // steel blue
		'#228833', // mid green
		'#CC79A7', // mauve
		'#D55E00', // vermillion
		'#88CCEE', // light cyan
		'#6A3D9A' // deep purple
	] as const;

	/** Brighter, high-chroma variants for dark cards (same semantic order). */
	const SERIES_PALETTE_DARK = [
		'#56B4E9', // sky
		'#FFC14D', // gold
		'#33D4A0', // bright green
		'#FF6B6B', // coral red
		'#A5B4FC', // periwinkle
		'#FF9F43', // bright orange
		'#4ADE80', // lime green
		'#F472B6', // hot pink
		'#7DD3FC', // light blue
		'#D4A574', // tan
		'#2DD4BF', // cyan
		'#E879F9', // fuchsia
		'#C5D86D', // chartreuse
		'#FDA4AF', // rose
		'#93C5FD', // pale blue
		'#34D399', // emerald
		'#F0A0D0', // soft pink
		'#FF7A45', // vermillion
		'#67E8F9', // ice cyan
		'#C4B5FD' // lavender
	] as const;

	function getChartTheme(isDark = isDarkMode()) {
		const fallbacks = isDark ? CHART_FALLBACKS.dark : CHART_FALLBACKS.light;
		const accent = fallbacks.accent;
		return {
			accent,
			// Prefer CSS text tokens when available, but fall back to stronger neutrals
			ticks: isDark
				? cssVar('--color-warm-700', fallbacks.ticks)
				: cssVar('--color-warm-700', fallbacks.ticks),
			legend: isDark
				? cssVar('--color-warm-800', fallbacks.legend)
				: cssVar('--color-warm-900', fallbacks.legend),
			// Light map-matching gray (soft on white; faint on dark cards)
			grid: isDark ? withAlpha(MAP_GRID_GRAY, 0.18) : MAP_GRID_GRAY,
			fill: withAlpha(accent, isDark ? 0.18 : 0.15),
			pointBorder: fallbacks.pointBorder,
			tooltipBg: isDark
				? withAlpha(cssVar('--color-warm-200', '#1e1f21'), 0.96)
				: withAlpha('#1a1a1a', 0.92),
			tooltipTitle: '#ffffff',
			cardBg: isDark
				? cssVar('--color-warm-100', '#141516')
				: cssVar('--color-warm-50', '#ffffff')
		};
	}

	/** Golden-angle HSL fallback when more series exist than palette slots. */
	function seriesColorBeyondPalette(extraIndex: number, isDark = isDarkMode()): string {
		// 137.508° golden angle spreads hues evenly; step lightness so near-hues differ
		const hue = (extraIndex * 137.508 + 18) % 360;
		const tier = extraIndex % 3;
		const sat = isDark ? 0.78 - tier * 0.06 : 0.72 - tier * 0.05;
		const light = isDark ? 0.58 + tier * 0.08 : 0.38 + tier * 0.1;
		const [r, g, b] = hslToRgb(hue, sat, light);
		return rgbToHex(r, g, b);
	}

	/** High-contrast colour for the n-th series / pie slice (0-based, wraps palette). */
	function getSeriesColor(index: number, isDark = isDarkMode()): string {
		const palette = isDark ? SERIES_PALETTE_DARK : SERIES_PALETTE_LIGHT;
		const n = palette.length;
		// Always land in the designed palette (large FNV hashes used to skip it
		// and fall into near-duplicate HSL hues — the main source of “same colour” legends).
		const i = ((index % n) + n) % n;
		return palette[i];
	}

	/**
	 * FNV-1a hash → stable series index so a category prefers the same palette slot
	 * when sort order, volume rank, or which peers appear in the period changes.
	 */
	function stableSeriesIndex(label: string): number {
		const s = label.trim().toLowerCase();
		let h = 2166136261;
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		return h >>> 0;
	}

	/**
	 * Empty / unknown category buckets (team leader, driver, type, etc.).
	 * Includes "Unassigned", "Unspecified", and blank labels.
	 */
	function isUnassignedCategory(label: string | undefined | null): boolean {
		const n = (label ?? '').trim().toUpperCase().replace(/[_-]+/g, ' ');
		if (!n) return true;
		return n === 'UNASSIGNED' || n === 'UNSPECIFIED';
	}

	/** Light–medium gray for Unassigned / Unspecified on all dashboard charts. */
	function getUnassignedChartColor(isDark = isDarkMode()): string {
		// Lighter than slate-500 so empty buckets read as secondary, not heavy
		// light: gray-400 · dark: gray-300 (readable on dark cards without looking black)
		return isDark ? '#D1D5DB' : '#9CA3AF';
	}

	/**
	 * Fixed colours for known incident types (aligned with type pill families).
	 * Keeps the most common series far apart regardless of hash collisions.
	 */
	function knownTypeChartColor(label: string, isDark: boolean): string | null {
		const key = label.trim().toUpperCase().replace(/\s+/g, ' ');
		if (!key) return null;
		// [light, dark] — high chroma, distinct from neighbours in the series palette
		const pick = (light: string, dark: string) => (isDark ? dark : light);

		if (key === 'DELIVERY COMPLAINT' || key.includes('DELIVERY COMPLAINT')) {
			return pick('#2563EB', '#60A5FA'); // blue
		}
		if (key === 'DISPUTED DELIVERY' || key.includes('DISPUTED')) {
			// Always black on line/bar legends (light and dark)
			return '#000000';
		}
		if (key === 'REDELIVERY REQUEST' || key.includes('REDELIVERY')) {
			return pick('#0284C7', '#38BDF8'); // sky
		}
		if (key === 'DELIVERY REQUEST' || (key.includes('DELIVERY REQUEST') && !key.includes('RE'))) {
			return pick('#4F46E5', '#818CF8'); // indigo
		}
		if (key === 'INCORRECT DELIVERY' || key.includes('INCORRECT')) {
			return pick('#7C3AED', '#A78BFA'); // violet
		}
		if (key === 'STOP DELIVERY' || (key.includes('STOP') && key.includes('DELIVERY'))) {
			return pick('#DC2626', '#F87171'); // red
		}
		if (key === 'CARDING ISSUE' || key.includes('CARDING')) {
			return pick('#C026D3', '#E879F9'); // fuchsia
		}
		if (key === 'MISSING ITEM' || key.includes('MISSING')) {
			return pick('#E11D48', '#FB7185'); // rose
		}
		if (key === 'INVESTIGATION' || key.includes('INVESTIGATION')) {
			return pick('#D97706', '#FBBF24'); // amber
		}
		if (key === 'INCIDENT REPORT' || key.includes('INCIDENT REPORT') || key === 'INCIDENT') {
			return pick('#9333EA', '#C084FC'); // purple
		}
		if (key === 'FEEDBACK' || key.includes('FEEDBACK')) {
			return pick('#059669', '#34D399'); // emerald
		}
		return null;
	}

	/**
	 * Series colour by category label (stable). Prefer known-type colours, else
	 * palette slot from label hash. For multi-series charts prefer
	 * {@link assignDistinctCategoryColors} so co-visible legend items never share a slot.
	 */
	function getChartCategoryColor(
		label: string | undefined | null,
		_index: number = 0,
		isDark = isDarkMode()
	): string {
		if (isUnassignedCategory(label)) return getUnassignedChartColor(isDark);
		const known = knownTypeChartColor(label ?? '', isDark);
		if (known) return known;
		return getSeriesColor(stableSeriesIndex(label ?? ''), isDark);
	}

	/**
	 * Assign mutually distinct colours to a set of category labels.
	 * - Unassigned / Unspecified → fixed gray
	 * - Known incident types → fixed pill-aligned hues
	 * - Other labels → preferred palette slot from hash, walking forward if taken
	 * Order of assignment is deterministic (hash, then name) so colours stay stable
	 * when the peer set is unchanged.
	 */
	function assignDistinctCategoryColors(
		labels: readonly string[],
		isDark = isDarkMode()
	): Map<string, string> {
		const palette = isDark ? SERIES_PALETTE_DARK : SERIES_PALETTE_LIGHT;
		const n = palette.length;
		const result = new Map<string, string>();
		const unique: string[] = [];
		const seen = new Set<string>();
		for (const raw of labels) {
			const label = (raw ?? '').trim() || 'Unspecified';
			if (seen.has(label)) continue;
			seen.add(label);
			unique.push(label);
		}

		for (const label of unique) {
			if (isUnassignedCategory(label)) {
				result.set(label, getUnassignedChartColor(isDark));
			}
		}

		const named = unique.filter((l) => !isUnassignedCategory(l));
		const ordered = [...named].sort((a, b) => {
			const ha = stableSeriesIndex(a);
			const hb = stableSeriesIndex(b);
			if (ha !== hb) return ha < hb ? -1 : 1;
			return a.localeCompare(b, undefined, { sensitivity: 'base' });
		});

		// Known types first so free-form labels avoid those hues when possible
		const usedSlots = new Set<number>();
		const nearestSlot = (hex: string): number => {
			const parsed = parseHex(hex);
			if (!parsed) return 0;
			let best = 0;
			let bestDist = Infinity;
			for (let i = 0; i < n; i++) {
				const p = parseHex(palette[i]);
				if (!p) continue;
				const d =
					(parsed[0] - p[0]) ** 2 + (parsed[1] - p[1]) ** 2 + (parsed[2] - p[2]) ** 2;
				if (d < bestDist) {
					bestDist = d;
					best = i;
				}
			}
			return best;
		};

		for (const label of ordered) {
			const known = knownTypeChartColor(label, isDark);
			if (!known) continue;
			result.set(label, known);
			usedSlots.add(nearestSlot(known));
		}

		let extra = 0;
		for (const label of ordered) {
			if (result.has(label)) continue;
			const preferred = stableSeriesIndex(label) % n;
			let chosen = -1;
			for (let k = 0; k < n; k++) {
				const slot = (preferred + k) % n;
				if (!usedSlots.has(slot)) {
					chosen = slot;
					break;
				}
			}
			if (chosen >= 0) {
				usedSlots.add(chosen);
				result.set(label, palette[chosen]);
			} else {
				result.set(label, seriesColorBeyondPalette(extra++, isDark));
			}
		}

		return result;
	}

	/** Always-visible counts on line points; hide zeros to reduce clutter. */
	function buildLineDataLabels(
		colors: ReturnType<typeof getChartTheme>,
		opts?: { fontSize?: number; multiSeries?: boolean }
	) {
		const fontSize = opts?.fontSize ?? 11;
		const multiSeries = opts?.multiSeries ?? false;
		return {
			// Only label positive points (0 is noise on sparse series)
			display: (context: { dataset: { data: unknown[] }; dataIndex: number }) => {
				const raw = context.dataset.data[context.dataIndex];
				return typeof raw === 'number' && raw > 0;
			},
			align: 'top' as const,
			anchor: 'end' as const,
			// Small gap above the point; scale grace + layout padding prevent top clipping
			offset: multiSeries ? 3 : 6,
			// Do not clamp into the plot (clamping pushed peak labels off-canvas)
			clamp: false,
			clip: false,
			formatter: (value: unknown) =>
				typeof value === 'number' && Number.isFinite(value) ? String(value) : '',
			color: colors.legend,
			font: {
				size: fontSize,
				weight: 'bold' as const
			},
			// Halo so labels stay readable on lines/grid
			textStrokeColor: isDarkMode() ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)',
			textStrokeWidth: 3
		};
	}

	/**
	 * Contiguous outer groups along the over-time axis for secondary labels.
	 * - day bucket: group by YYYY-MM → month name + year under day ticks
	 * - month bucket: group by YYYY → year under month ticks
	 */
	function overTimeOuterGroups(
		keys: string[],
		bucket: OverTimeBucket
	): { groupKey: string; line1: string; line2: string | null; start: number; end: number }[] {
		if (bucket === 'year') return [];
		const groups: {
			groupKey: string;
			line1: string;
			line2: string | null;
			start: number;
			end: number;
		}[] = [];
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i] ?? '';
			let groupKey = '';
			let line1 = '';
			let line2: string | null = null;
			if (bucket === 'day') {
				// key YYYY-MM-DD → group by month
				const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
				if (!m) continue;
				groupKey = `${m[1]}-${m[2]}`;
				const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
				line1 = Number.isNaN(d.getTime())
					? groupKey
					: d.toLocaleDateString('en-AU', { month: 'long' });
				line2 = m[1];
			} else {
				// month bucket: key YYYY-MM → group by year
				const m = /^(\d{4})-(\d{2})$/.exec(key);
				if (!m) continue;
				groupKey = m[1];
				line1 = m[1];
				line2 = null;
			}
			const last = groups[groups.length - 1];
			if (last && last.groupKey === groupKey) {
				last.end = i;
			} else {
				groups.push({ groupKey, line1, line2, start: i, end: i });
			}
		}
		return groups;
	}

	/** Boundary key for vertical dividers (month for day view, year for month view). */
	function overTimeBoundaryKey(bucketKey: string, bucket: OverTimeBucket): string {
		if (bucket === 'day') return bucketKey.slice(0, 7); // YYYY-MM
		if (bucket === 'month') return bucketKey.slice(0, 4); // YYYY
		return bucketKey;
	}

	/**
	 * Shared x-axis chrome for day/month buckets (used by Incidents Over Time and
	 * Incidents by Driver per Month line chart):
	 * - Chart.js draws primary ticks (day / month name / year)
	 * - This draws outer group labels + faint vertical rules in the x-axis band
	 */
	function drawOverTimeAxisChrome(
		chart: ChartJS<'line'>,
		keys: string[],
		bucket: OverTimeBucket
	) {
		if (keys.length === 0 || bucket === 'year') return;
		const xScale = chart.scales.x;
		const area = chart.chartArea;
		if (!xScale || !area) return;

		const dark = isDarkMode();
		const themeColors = getChartTheme(dark);
		const stroke = dark ? withAlpha(MAP_GRID_GRAY, 0.4) : withAlpha('#9ca3af', 0.55);
		const labelColor = themeColors.ticks;
		const ctx = chart.ctx;
		const groups = overTimeOuterGroups(keys, bucket);
		/*
		 * Label band geometry (below chartArea.bottom):
		 * - Day:  Chart.js day ticks (~0–16px) → month name → year
		 * - Month: Chart.js month ticks (~0–18px) → year only (must clear the tick row)
		 */
		const bandDepth = bucket === 'day' ? 50 : 42;
		const bandBottom = Math.min(chart.height - 2, area.bottom + bandDepth);

		// —— Vertical boundary lines (x-axis label band only) ——
		if (keys.length >= 2) {
			ctx.save();
			ctx.strokeStyle = stroke;
			ctx.lineWidth = 1;
			ctx.beginPath();
			const lineTop = area.bottom + 1;
			for (let i = 1; i < keys.length; i++) {
				const prev = overTimeBoundaryKey(keys[i - 1] ?? '', bucket);
				const cur = overTimeBoundaryKey(keys[i] ?? '', bucket);
				if (!prev || !cur || prev === cur) continue;
				const x0 = xScale.getPixelForValue(i - 1);
				const x1 = xScale.getPixelForValue(i);
				if (!Number.isFinite(x0) || !Number.isFinite(x1)) continue;
				const x = (x0 + x1) / 2;
				if (x < area.left || x > area.right) continue;
				ctx.moveTo(x, lineTop);
				ctx.lineTo(x, bandBottom);
			}
			ctx.stroke();
			ctx.restore();
		}

		// —— Outer group labels ——
		// Day: month @ +32, year @ +45 (under day ticks)
		// Month: year only @ +34 (well clear of Chart.js short-month ticks)
		const line1Y = Math.min(
			chart.height - (bucket === 'day' ? 16 : 10),
			area.bottom + (bucket === 'day' ? 32 : 34)
		);
		const line2Y = line1Y + 13;
		ctx.save();
		ctx.fillStyle = labelColor;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		for (const g of groups) {
			const xStart = xScale.getPixelForValue(g.start);
			const xEnd = xScale.getPixelForValue(g.end);
			if (!Number.isFinite(xStart) || !Number.isFinite(xEnd)) continue;
			const x = (xStart + xEnd) / 2;
			if (x < area.left - 4 || x > area.right + 4) continue;
			const maxW = Math.max(24, Math.abs(xEnd - xStart) + 24);
			ctx.font = '600 11px system-ui, sans-serif';
			let draw1 = g.line1;
			if (bucket === 'day' && ctx.measureText(draw1).width > maxW && maxW < 64) {
				draw1 = draw1.slice(0, 3);
			}
			ctx.fillText(draw1, x, line1Y);
			if (g.line2) {
				ctx.font = '500 10px system-ui, sans-serif';
				ctx.fillText(g.line2, x, line2Y);
			}
		}
		ctx.restore();
	}

	const overTimeAxisChromePlugin: Plugin<'line'> = {
		id: 'overTimeAxisChrome',
		afterDraw(chart) {
			drawOverTimeAxisChrome(chart, overTimeChartDateKeys, overTimeChartBucket);
		}
	};

	/** Same chrome for driver line chart (keys/bucket mirrors set when that chart updates). */
	const driverMonthAxisChromePlugin: Plugin<'line'> = {
		id: 'driverMonthAxisChrome',
		afterDraw(chart) {
			drawOverTimeAxisChrome(chart, driverMonthChartBucketKeys, driverMonthChartBucket);
		}
	};

	function buildChartOptions(
		colors: ReturnType<typeof getChartTheme>,
		labels?: unknown
	): ChartOptions<'line'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			// Prefer the nearest point on the x-axis so ticks / labels are clickable too
			interaction: {
				mode: 'index',
				intersect: false
			},
			layout: {
				// Top for point labels; bottom room depends on bucket (set on create + data updates)
				padding: {
					top: 14,
					right: 6,
					left: 2,
					bottom: overTimeAxisBottomPad(untrack(() => dashboardUi.overTimeBucket))
				}
			},
			onHover: (event, elements, chart) => {
				const native = event.native;
				const target = native?.target;
				if (!(target instanceof HTMLElement)) return;
				// Pointer over a point, or over a day category (label / vertical band)
				let overCategory = elements.length > 0;
				if (!overCategory && chart.scales?.x && event.x != null) {
					const idx = Math.round(chart.scales.x.getValueForPixel(event.x) as number);
					const n = chart.data.labels?.length ?? 0;
					overCategory = Number.isFinite(idx) && idx >= 0 && idx < n;
				}
				target.style.cursor = overCategory ? 'pointer' : 'default';
			},
			onClick: (event, elements, chart) => {
				let index: number | undefined;
				if (elements.length > 0) {
					index = elements[0].index;
				} else if (event.x != null && chart.scales?.x) {
					// Click on x-axis label / empty vertical band for that day
					const raw = chart.scales.x.getValueForPixel(event.x);
					if (typeof raw === 'number' && Number.isFinite(raw)) {
						index = Math.round(raw);
					}
				}
				if (index == null || index < 0) return;
				const bucketKey = overTimeChartDateKeys[index];
				if (!bucketKey) return;
				const point = chart.data.datasets[0]?.data?.[index];
				const count = typeof point === 'number' ? point : Number(point);
				if (!Number.isFinite(count) || count <= 0) return;
				drillDownOverTimeBucket(bucketKey);
			},
			plugins: {
				// Single-series chart — legend is redundant
				legend: {
					display: false
				},
				tooltip: {
					backgroundColor: colors.tooltipBg,
					titleColor: colors.tooltipTitle,
					bodyColor: colors.tooltipTitle,
					titleFont: { size: 14, weight: 'bold' },
					bodyFont: { size: 13 },
					padding: 12,
					cornerRadius: 8,
					displayColors: false,
					callbacks: {
						title: (items) => {
							const idx = items[0]?.dataIndex;
							if (idx == null) return '';
							const key = overTimeChartDateKeys[idx];
							return key ? overTimeTooltipTitle(key, overTimeChartBucket) : '';
						},
						label: (context) => `${context.parsed.y} incidents`
					}
				},
				datalabels: buildLineDataLabels(colors, { fontSize: 12 })
			},
			scales: {
				y: {
					beginAtZero: true,
					// Headroom above max so labels sit inside the chart area
					grace: '18%',
					ticks: {
						color: colors.ticks,
						stepSize: 1,
						font: { size: 12, weight: 500 },
						// Avoid fractional ticks when grace expands the max
						precision: 0
					},
					grid: {
						color: colors.grid
					}
				},
				x: {
					// Centre a lone category; plugin beforeLayout keeps this in sync later
					offset: Array.isArray(labels) && labels.length === 1,
					// Primary ticks = day / month name / year; outer groups via plugin
					ticks: {
						color: colors.ticks,
						font: { size: 11, weight: 500 },
						autoSkip: true,
						maxRotation: 0,
						minRotation: 0,
						padding: overTimeTickPadding(untrack(() => dashboardUi.overTimeBucket))
					},
					grid: {
						display: false
					}
				}
			}
		};
	}

	/** Layout bottom padding so Chart.js ticks + plugin under-labels do not clip. */
	function overTimeAxisBottomPad(bucket: OverTimeBucket): number {
		if (bucket === 'day') return 48;
		// Month ticks + year group row under them
		if (bucket === 'month') return 40;
		return 10;
	}

	/** Extra gap under primary tick text before plugin under-labels. */
	function overTimeTickPadding(bucket: OverTimeBucket): number {
		if (bucket === 'day') return 4;
		if (bucket === 'month') return 8;
		return 4;
	}

	function overTimeTooltipTitle(key: string, bucket: OverTimeBucket): string {
		if (bucket === 'day') return formatDate(key);
		if (bucket === 'month') return formatMonthYearLabel(key);
		return key;
	}

	/** Multi-series line chart options (incident type over time). */
	function buildTypeOverTimeChartOptions(
		colors: ReturnType<typeof getChartTheme>
	): ChartOptions<'line'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			layout: {
				padding: { top: 14, right: 6, left: 2, bottom: 2 }
			},
			interaction: {
				mode: 'index',
				intersect: false
			},
			plugins: {
				// Legend is rendered in HTML under the plot so all three cards share equal plot height
				legend: {
					display: false
				},
				tooltip: {
					backgroundColor: colors.tooltipBg,
					titleColor: colors.tooltipTitle,
					bodyColor: colors.tooltipTitle,
					titleFont: { size: 14, weight: 'bold' },
					bodyFont: { size: 13 },
					padding: 12,
					cornerRadius: 8,
					displayColors: true,
					callbacks: {
						label: (context) => {
							const name = context.dataset.label ?? 'Type';
							const y = context.parsed.y ?? 0;
							return `${name}: ${y} ${y === 1 ? 'incident' : 'incidents'}`;
						}
					}
				},
				// Slightly smaller labels when many series share the canvas
				datalabels: buildLineDataLabels(colors, { fontSize: 10, multiSeries: true })
			},
			scales: {
				y: {
					beginAtZero: true,
					stacked: false,
					grace: '18%',
					ticks: {
						color: colors.ticks,
						stepSize: 1,
						font: { size: 12, weight: 500 },
						precision: 0
					},
					grid: {
						color: colors.grid
					}
				},
				x: {
					ticks: {
						color: colors.ticks,
						maxRotation: 45,
						minRotation: 0,
						font: { size: 11, weight: 500 }
					},
					grid: {
						display: false
					}
				}
			}
		};
	}

	/** Multi-series line options: driver × month (x-axis chrome matches over-time month view). */
	function buildDriverMonthLineOptions(
		colors: ReturnType<typeof getChartTheme>,
		labels?: unknown
	): ChartOptions<'line'> {
		// Fixed month bucket — Day/Month/Year toggle is only on Incidents Over Time
		const bucket: OverTimeBucket = 'month';
		return {
			responsive: true,
			maintainAspectRatio: false,
			layout: {
				// Bottom room for year under-labels (same as Incidents Over Time month view)
				padding: {
					top: 14,
					right: 8,
					left: 2,
					bottom: overTimeAxisBottomPad(bucket)
				}
			},
			interaction: {
				mode: 'nearest',
				intersect: false,
				axis: 'xy'
			},
			onHover: (event, elements) => {
				const target = event.native?.target;
				if (!(target instanceof HTMLElement)) return;
				target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
			},
			onClick: (_event, elements, chart) => {
				if (elements.length === 0) return;
				const el = elements[0];
				const periodKey = driverMonthChartBucketKeys[el.index];
				const driverKey = driverMonthChartDriverKeys[el.datasetIndex];
				const driverLabel = driverMonthChartDriverLabels[el.datasetIndex];
				if (!periodKey || !driverKey || !driverLabel) return;
				const point = chart.data.datasets[el.datasetIndex]?.data?.[el.index];
				const count = typeof point === 'number' ? point : Number(point);
				if (!Number.isFinite(count) || count <= 0) return;
				openDriverMonthDetail(driverKey, driverLabel, periodKey, count);
			},
			plugins: {
				legend: {
					display: false
				},
				tooltip: {
					backgroundColor: driverMonthTooltipBg(),
					titleColor: colors.tooltipTitle,
					bodyColor: colors.tooltipTitle,
					titleFont: { size: 14, weight: 'bold' },
					bodyFont: { size: 13 },
					padding: 12,
					cornerRadius: 8,
					displayColors: true,
					// Caret on the right of the box → tooltip sits left of the point
					xAlign: 'right',
					yAlign: 'center',
					caretPadding: 10,
					filter: (item) => {
						// Hide tooltip rows for series the user turned off
						return item.dataset.hidden !== true;
					},
					callbacks: {
						title: (items) => {
							const idx = items[0]?.dataIndex;
							if (idx == null) return '';
							const key = driverMonthChartBucketKeys[idx];
							return key
								? overTimeTooltipTitle(key, driverMonthChartBucket)
								: '';
						},
						label: (context) => {
							const name = context.dataset.label ?? 'Driver';
							const y = context.parsed.y ?? 0;
							return `${name}: ${y} ${y === 1 ? 'incident' : 'incidents'}`;
						},
						// Use legend series colour, not the grey stacked-point fill
						labelColor: (context) => {
							const stroke = driverMonthLegendColor(context.dataset);
							return { borderColor: stroke, backgroundColor: stroke };
						},
						labelTextColor: () => colors.tooltipTitle
					}
				},
				datalabels: buildLineDataLabels(colors, { fontSize: 10, multiSeries: true })
			},
			scales: {
				y: {
					beginAtZero: true,
					stacked: false,
					grace: '18%',
					ticks: {
						color: colors.ticks,
						stepSize: 1,
						font: { size: 12, weight: 500 },
						precision: 0
					},
					grid: {
						color: colors.grid
					}
				},
				x: {
					offset: Array.isArray(labels) && labels.length === 1,
					// Primary ticks = day / month name / year; outer groups via plugin
					ticks: {
						color: colors.ticks,
						font: { size: 11, weight: 500 },
						autoSkip: true,
						maxRotation: 0,
						minRotation: 0,
						padding: overTimeTickPadding(bucket)
					},
					grid: {
						display: false
					}
				}
			}
		};
	}

	/**
	 * Shared point chrome for every dashboard line chart.
	 * Same marker size on Over Time, type-over-time, and driver-per-month.
	 */
	const LINE_CHART_POINTS = {
		radius: 5,
		hoverRadius: 7,
		/** Single-category scale (includes the 15% reduction). */
		singlePointScale: 1.25 * 1.25 * 0.85,
		/** Match NSW map `.incident-pulse` (2.4s, 14px fade). */
		pulseMs: 2400,
		pulseSpread: 14
	} as const;

	/** Stacked single-month driver points (2+ drivers, same incident count). */
	const DRIVER_MONTH_TIE_POINT = {
		light: '#44403c',
		dark: '#a8a29e'
	} as const;

	const pairedLinePulseRaf = new WeakMap<object, number>();

	function lineHasSingleCategory(chart: { data?: { labels?: unknown } }): boolean {
		const labels = chart.data?.labels;
		return Array.isArray(labels) && labels.length === 1;
	}

	function applySingleCategoryLineAxis(chart: ChartJS<'line'>): boolean {
		const single = lineHasSingleCategory(chart);
		const x = chart.options.scales?.x;
		if (x && typeof x === 'object') {
			x.offset = single;
		}
		return single;
	}

	function scaledLinePoint(base: number, single: boolean): number {
		return single ? base * LINE_CHART_POINTS.singlePointScale : base;
	}

	/** Centre + shared marker size for every line chart. */
	function applyLineChartPoints(chart: ChartJS<'line'>): boolean {
		const single = applySingleCategoryLineAxis(chart);
		const radius = scaledLinePoint(LINE_CHART_POINTS.radius, single);
		const hoverRadius = scaledLinePoint(LINE_CHART_POINTS.hoverRadius, single);
		for (const dataset of chart.data.datasets) {
			dataset.pointRadius = radius;
			dataset.pointHoverRadius = hoverRadius;
		}
		return single;
	}

	function prefersReducedMotion(): boolean {
		return (
			typeof window !== 'undefined' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		);
	}

	/** CSS cubic-bezier(0.4, 0, 0.6, 1) — same timing as the map pulse. */
	function mapPulseEase(t: number): number {
		const x = Math.min(1, Math.max(0, t));
		let u = x;
		for (let i = 0; i < 6; i++) {
			const one = 1 - u;
			const xu = 3 * one * one * u * 0.4 + 3 * one * u * u * 0.6 + u * u * u;
			const dx = 3 * one * one * 0.4 + 6 * one * u * 0.2 + 3 * u * u * 0.4;
			if (Math.abs(dx) < 1e-6) break;
			u = Math.min(1, Math.max(0, u - (xu - x) / dx));
		}
		const one = 1 - u;
		return 3 * one * u * u + u * u * u;
	}

	function linePointFillColor(dataset: { pointBackgroundColor?: unknown; borderColor?: unknown }): string {
		const raw = dataset.pointBackgroundColor ?? dataset.borderColor;
		if (typeof raw === 'string' && raw.startsWith('#') && raw.length === 7) return raw;
		if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].startsWith('#')) {
			return raw[0];
		}
		return '#0f7cb3';
	}

	function stopPairedLinePulse(chart: object) {
		const raf = pairedLinePulseRaf.get(chart);
		if (raf != null) {
			cancelAnimationFrame(raf);
			pairedLinePulseRaf.delete(chart);
		}
	}

	function drawPairedLinePulseRings(chart: ChartJS<'line'>, spread: number, alpha: number) {
		const ctx = chart.ctx;
		ctx.save();
		for (let i = 0; i < chart.data.datasets.length; i++) {
			const meta = chart.getDatasetMeta(i);
			if (!meta || meta.hidden) continue;
			const dataset = chart.data.datasets[i];
			if (!dataset || dataset.hidden) continue;
			const fill = linePointFillColor(dataset);
			ctx.fillStyle = withAlpha(fill, alpha);
			for (const el of meta.data) {
				if (!el || (el as { skip?: boolean }).skip) continue;
				const x = el.x;
				const y = el.y;
				if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
				const radius = Number(
					(el as { options?: { radius?: number } }).options?.radius ??
						dataset.pointRadius ??
						5
				);
				if (!Number.isFinite(radius) || radius <= 0) continue;
				const outer = radius + spread;
				if (outer <= radius) continue;
				ctx.beginPath();
				ctx.arc(x, y, outer, 0, Math.PI * 2);
				ctx.arc(x, y, radius, 0, Math.PI * 2, true);
				ctx.fill('evenodd');
			}
		}
		ctx.restore();
	}

	/**
	 * Expanding ring on single-category points — same motion as the NSW map
	 * incident pulse. Shared by both paired line charts.
	 */
	const pairedLinePulsePlugin: Plugin<'line'> = {
		id: 'pairedLineSinglePointPulse',
		// First layout (and every later one) must see offset before scales map pixels.
		// Setting it only after `new Chart()` leaves a single point on the Y-axis
		// until a resize / interaction rebuilds the category scale.
		beforeLayout(chart) {
			applySingleCategoryLineAxis(chart);
		},
		afterDraw(chart) {
			if (!lineHasSingleCategory(chart)) {
				stopPairedLinePulse(chart);
				return;
			}
			if (prefersReducedMotion()) {
				stopPairedLinePulse(chart);
				drawPairedLinePulseRings(chart, 3, 0.33);
				return;
			}
			const cycle = (performance.now() % LINE_CHART_POINTS.pulseMs) / LINE_CHART_POINTS.pulseMs;
			const eased = mapPulseEase(cycle);
			// Keyframes: 0/100% spread 0 @ 70% — 50% spread 14 @ 0%
			const k = eased <= 0.5 ? eased / 0.5 : (1 - eased) / 0.5;
			const spread = LINE_CHART_POINTS.pulseSpread * k;
			const alpha = 0.7 * (1 - k);
			drawPairedLinePulseRings(chart, spread, alpha);
			if (pairedLinePulseRaf.has(chart)) return;
			const raf = requestAnimationFrame(() => {
				pairedLinePulseRaf.delete(chart);
				if (!chart.ctx || !lineHasSingleCategory(chart)) return;
				chart.draw();
			});
			pairedLinePulseRaf.set(chart, raf);
		},
		beforeDestroy(chart) {
			stopPairedLinePulse(chart);
		}
	};

	function applyDriverMonthAxisLayout(chart: ChartJS<'line'>, bucket: OverTimeBucket) {
		const pad = chart.options?.layout?.padding;
		if (pad && typeof pad === 'object' && !Array.isArray(pad)) {
			const box = pad as { bottom?: number; right?: number };
			box.bottom = overTimeAxisBottomPad(bucket);
			// Room for "N drivers" callouts to the right of a lone month
			box.right = lineHasSingleCategory(chart) ? 96 : 8;
		}
		const xTicks = chart.options?.scales?.x?.ticks;
		if (xTicks) {
			xTicks.padding = overTimeTickPadding(bucket);
			xTicks.maxRotation = 0;
			xTicks.minRotation = 0;
			xTicks.autoSkip = true;
		}
	}

	type DriverMonthTieGroup = {
		incidents: number;
		drivers: number;
		x: number;
		y: number;
	};

	function collectDriverMonthTieGroups(chart: ChartJS<'line'>): DriverMonthTieGroup[] {
		const byIncidents = new Map<number, DriverMonthTieGroup>();
		for (let i = 0; i < chart.data.datasets.length; i++) {
			if (typeof chart.isDatasetVisible === 'function' && !chart.isDatasetVisible(i)) {
				continue;
			}
			const meta = chart.getDatasetMeta(i);
			if (!meta || meta.hidden) continue;
			const dataset = chart.data.datasets[i];
			if (!dataset || dataset.hidden) continue;
			const el = meta.data[0];
			if (!el || (el as { skip?: boolean }).skip) continue;
			const raw = dataset.data[0];
			const incidents = typeof raw === 'number' ? raw : Number(raw);
			if (!Number.isFinite(incidents) || incidents <= 0) continue;
			const x = el.x;
			const y = el.y;
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			const prev = byIncidents.get(incidents);
			if (prev) {
				prev.drivers += 1;
			} else {
				byIncidents.set(incidents, { incidents, drivers: 1, x, y });
			}
		}
		return [...byIncidents.values()].filter((g) => g.drivers > 1);
	}

	function visibleDriverMonthIncidentCounts(chart: ChartJS<'line'>): Map<number, number> {
		const counts = new Map<number, number>();
		if (!lineHasSingleCategory(chart)) return counts;
		chart.data.datasets.forEach((dataset, i) => {
			if (dataset.hidden) return;
			if (typeof chart.isDatasetVisible === 'function' && !chart.isDatasetVisible(i)) {
				return;
			}
			const raw = dataset.data[0];
			const incidents = typeof raw === 'number' ? raw : Number(raw);
			if (!Number.isFinite(incidents) || incidents <= 0) return;
			counts.set(incidents, (counts.get(incidents) ?? 0) + 1);
		});
		return counts;
	}

	/** 25% transparent (75% opaque) — driver-month hover tooltip fill. */
	const DRIVER_MONTH_TOOLTIP_BG_ALPHA = 0.75;

	function driverMonthTooltipBg(isDark = isDarkMode()): string {
		return isDark
			? withAlpha('#1e1f21', DRIVER_MONTH_TOOLTIP_BG_ALPHA)
			: withAlpha('#1a1a1a', DRIVER_MONTH_TOOLTIP_BG_ALPHA);
	}

	function driverMonthLegendColor(dataset: {
		label?: unknown;
		borderColor?: unknown;
		legendColor?: unknown;
	}): string {
		if (typeof dataset.legendColor === 'string' && dataset.legendColor.startsWith('#')) {
			return dataset.legendColor;
		}
		if (typeof dataset.borderColor === 'string' && dataset.borderColor.startsWith('#')) {
			return dataset.borderColor;
		}
		return getChartCategoryColor(String(dataset.label ?? ''), 0, theme.isDark);
	}

	function applyDriverMonthTiePointColors(chart: ChartJS<'line'>) {
		const counts = visibleDriverMonthIncidentCounts(chart);
		const tieFill = theme.isDark ? DRIVER_MONTH_TIE_POINT.dark : DRIVER_MONTH_TIE_POINT.light;
		for (const dataset of chart.data.datasets) {
			if (dataset.hidden) continue;
			const raw = dataset.data[0];
			const incidents = typeof raw === 'number' ? raw : Number(raw);
			if ((counts.get(incidents) ?? 0) > 1) {
				dataset.pointBackgroundColor = tieFill;
			}
		}
	}

	function fillRoundRect(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		w: number,
		h: number,
		r: number
	) {
		const radius = Math.min(r, w / 2, h / 2);
		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.arcTo(x + w, y, x + w, y + h, radius);
		ctx.arcTo(x + w, y + h, x, y + h, radius);
		ctx.arcTo(x, y + h, x, y, radius);
		ctx.arcTo(x, y, x + w, y, radius);
		ctx.closePath();
	}

	function drawDriverMonthTieAnnotations(chart: ChartJS<'line'>) {
		if (!lineHasSingleCategory(chart)) return;
		const groups = collectDriverMonthTieGroups(chart);
		if (groups.length === 0) return;

		const ctx = chart.ctx;
		const area = chart.chartArea;
		const colors = getChartTheme(theme.isDark);
		const isDark = theme.isDark;
		const boxBg = isDark ? 'rgba(30, 31, 33, 0.94)' : 'rgba(255, 255, 255, 0.96)';
		const boxBorder = isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(28, 25, 23, 0.2)';
		const lineColor = isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(28, 25, 23, 0.4)';
		const pointR = scaledLinePoint(LINE_CHART_POINTS.radius, true);
		const padX = 6;
		const boxH = 18;

		ctx.save();
		ctx.font = '600 11px system-ui, sans-serif';
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'left';

		const items = groups
			.map((g) => {
				const text = `${g.drivers} drivers`;
				const boxW = Math.ceil(ctx.measureText(text).width) + padX * 2;
				return { ...g, text, boxW };
			})
			.sort((a, b) => a.y - b.y);

		const placed: { x: number; y: number; boxX: number; boxY: number; boxW: number; text: string }[] =
			[];
		for (const item of items) {
			let boxX = item.x + pointR + 16;
			let boxY = item.y - boxH / 2;
			if (boxX + item.boxW > area.right - 2) {
				boxX = Math.max(area.left + 4, area.right - item.boxW - 2);
			}
			for (const prev of placed) {
				const overlaps =
					boxX < prev.boxX + prev.boxW + 4 &&
					boxX + item.boxW + 4 > prev.boxX &&
					boxY < prev.boxY + boxH + 4 &&
					boxY + boxH + 4 > prev.boxY;
				if (overlaps) boxY = prev.boxY + boxH + 4;
			}
			if (boxY + boxH > area.bottom - 2) boxY = area.bottom - boxH - 2;
			if (boxY < area.top + 2) boxY = area.top + 2;
			placed.push({ x: item.x, y: item.y, boxX, boxY, boxW: item.boxW, text: item.text });
		}

		for (const p of placed) {
			const midY = p.boxY + boxH / 2;
			ctx.beginPath();
			ctx.moveTo(p.x + pointR + 1, p.y);
			ctx.lineTo(p.boxX - 1, midY);
			ctx.strokeStyle = lineColor;
			ctx.lineWidth = 1;
			ctx.stroke();

			fillRoundRect(ctx, p.boxX, p.boxY, p.boxW, boxH, 4);
			ctx.fillStyle = boxBg;
			ctx.fill();
			ctx.strokeStyle = boxBorder;
			ctx.lineWidth = 1;
			ctx.stroke();

			ctx.fillStyle = colors.legend;
			ctx.fillText(p.text, p.boxX + padX, midY);
		}
		ctx.restore();
	}

	const driverMonthTieAnnotatePlugin: Plugin<'line'> = {
		id: 'driverMonthTieAnnotate',
		// Draw under the tooltip (tooltip paints in afterDraw)
		afterDatasetsDraw(chart) {
			drawDriverMonthTieAnnotations(chart);
		}
	};

	function applyDriverMonthSeriesFocus(
		chart: ChartJS<'line'>,
		focusLabel: string | null = null
	) {
		const colors = getChartTheme(theme.isDark);
		const isDark = theme.isDark;
		const dimColor = getDimmedSeriesColor(isDark);
		const colorMap = assignDistinctCategoryColors(
			chart.data.datasets.map((d) => String(d.label ?? '')),
			isDark
		);
		const single = lineHasSingleCategory(chart);
		const focus = single ? null : focusLabel;
		chart.data.datasets.forEach((dataset, index) => {
			const label = String(dataset.label ?? '');
			const stroke =
				colorMap.get(label) ?? getChartCategoryColor(dataset.label, 0, isDark);
			const dimmed = focus != null && focus !== label;
			const focused = focus != null && focus === label;
			const lineColor = dimmed ? dimColor : stroke;
			dataset.borderColor = lineColor;
			dataset.backgroundColor = withAlpha(lineColor, dimmed ? 0.02 : 0.06);
			dataset.pointBackgroundColor = lineColor;
			(dataset as { legendColor?: string }).legendColor = stroke;
			dataset.pointBorderColor = dimmed ? dimColor : colors.pointBorder;
			dataset.borderWidth = dimmed ? 1.25 : focused ? 3.5 : 2.5;
			dataset.pointRadius = scaledLinePoint(
				dimmed ? 1.5 : LINE_CHART_POINTS.radius,
				single
			);
			dataset.pointHoverRadius = scaledLinePoint(
				dimmed ? 2.5 : LINE_CHART_POINTS.hoverRadius,
				single
			);
			dataset.pointBorderWidth = dimmed ? 1 : 2;
			dataset.order = dimmed ? index : focused ? 1000 : 100 + index;
		});
	}

	function applyDriverMonthLineTheme(
		chart: ChartJS<'line'>,
		focusLabel: string | null = null
	) {
		const colors = getChartTheme(theme.isDark);
		const isDark = theme.isDark;
		const bucket: OverTimeBucket = 'month';
		applyLineChartPoints(chart);
		applyDriverMonthSeriesFocus(chart, focusLabel);
		applyDriverMonthTiePointColors(chart);
		if (chart.options?.plugins?.legend) {
			chart.options.plugins.legend.display = false;
		}
		if (chart.options?.plugins?.datalabels) {
			const baseLabels = buildLineDataLabels(colors, { fontSize: 10, multiSeries: true });
			Object.assign(chart.options.plugins.datalabels, baseLabels);
			const single = lineHasSingleCategory(chart);
			const focus = single ? null : focusLabel;
			if (single) {
				chart.options.plugins.datalabels.display = (context) => {
					const raw = context.dataset.data[context.dataIndex];
					if (!(typeof raw === 'number' && raw > 0)) return false;
					for (let i = 0; i < context.datasetIndex; i++) {
						if (!context.chart.isDatasetVisible(i)) continue;
						if (context.chart.data.datasets[i]?.data?.[context.dataIndex] === raw) {
							return false;
						}
					}
					return true;
				};
			} else if (focus != null) {
				const baseDisplay = baseLabels.display;
				chart.options.plugins.datalabels.display = (context) => {
					if (String(context.dataset.label ?? '') !== focus) return false;
					if (typeof baseDisplay === 'function') {
						return (baseDisplay as (c: typeof context) => boolean)(context);
					}
					return baseDisplay !== false;
				};
			}
		}
		if (chart.options?.scales?.y?.ticks) {
			chart.options.scales.y.ticks.color = colors.ticks;
		}
		if (chart.options?.scales?.y?.grid) {
			chart.options.scales.y.grid.color = colors.grid;
		}
		if (chart.options?.scales?.x?.ticks) {
			chart.options.scales.x.ticks.color = colors.ticks;
		}
		if (chart.options?.plugins?.tooltip) {
			chart.options.plugins.tooltip.backgroundColor = driverMonthTooltipBg(isDark);
			chart.options.plugins.tooltip.titleColor = colors.tooltipTitle;
			chart.options.plugins.tooltip.bodyColor = colors.tooltipTitle;
		}
		applyDriverMonthAxisLayout(chart, bucket);
		chart.update('none');
	}

	function applyChartTheme(chart: ChartJS<'line'>) {
		const colors = getChartTheme(theme.isDark);
		const dataset = chart.data.datasets[0];
		if (!dataset) return;
		dataset.borderColor = colors.accent;
		dataset.backgroundColor = colors.fill;
		dataset.pointBackgroundColor = colors.accent;
		dataset.pointBorderColor = colors.pointBorder;
		dataset.borderWidth = 2.5;
		dataset.pointBorderWidth = 2;
		applyLineChartPoints(chart);
		if (chart.options?.plugins?.legend?.labels) {
			chart.options.plugins.legend.labels.color = colors.legend;
		}
		if (chart.options?.plugins?.datalabels) {
			Object.assign(chart.options.plugins.datalabels, buildLineDataLabels(colors, { fontSize: 12 }));
		}
		if (chart.options?.scales?.y?.ticks) {
			chart.options.scales.y.ticks.color = colors.ticks;
		}
		if (chart.options?.scales?.y?.grid) {
			chart.options.scales.y.grid.color = colors.grid;
		}
		if (chart.options?.scales?.x?.ticks) {
			chart.options.scales.x.ticks.color = colors.ticks;
		}
		if (chart.options?.plugins?.tooltip) {
			chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
			chart.options.plugins.tooltip.titleColor = colors.tooltipTitle;
			chart.options.plugins.tooltip.bodyColor = colors.tooltipTitle;
		}
		chart.update('none');
	}

	/**
	 * Non-focused series paint — same grey as chart axis gridlines
	 * (`MAP_GRID_GRAY` / theme `grid` token).
	 */
	function getDimmedSeriesColor(isDark = isDarkMode()): string {
		// Light: solid grid grey. Dark: grid uses the same hue at low alpha.
		return isDark ? withAlpha(MAP_GRID_GRAY, 0.35) : MAP_GRID_GRAY;
	}

	function getDimmedSeriesBorderColor(isDark = isDarkMode()): string {
		return isDark ? withAlpha(MAP_GRID_GRAY, 0.45) : MAP_GRID_GRAY;
	}

	/**
	 * Apply full / dimmed colours for multi-series line datasets.
	 * Mutates datasets in place (no array replace) so Chart.js line controllers
	 * reliably pick up the stroke change on hover.
	 */
	function applyTypeOverTimeSeriesFocus(
		chart: ChartJS<'line'>,
		focusLabel: string | null = null
	) {
		const colors = getChartTheme(theme.isDark);
		const isDark = theme.isDark;
		const dimColor = getDimmedSeriesColor(isDark);
		const colorMap = assignDistinctCategoryColors(
			chart.data.datasets.map((d) => String(d.label ?? '')),
			isDark
		);
		const single = applySingleCategoryLineAxis(chart);
		chart.data.datasets.forEach((dataset, index) => {
			const label = String(dataset.label ?? '');
			const stroke =
				colorMap.get(label) ?? getChartCategoryColor(dataset.label, 0, isDark);
			const dimmed = focusLabel != null && focusLabel !== label;
			const focused = focusLabel != null && focusLabel === label;
			const lineColor = dimmed ? dimColor : stroke;
			dataset.borderColor = lineColor;
			dataset.backgroundColor = withAlpha(lineColor, dimmed ? 0.02 : 0.06);
			dataset.pointBackgroundColor = lineColor;
			dataset.pointBorderColor = dimmed ? dimColor : colors.pointBorder;
			dataset.borderWidth = dimmed ? 1.25 : focused ? 3.5 : 2.5;
			dataset.pointRadius = scaledLinePoint(
				dimmed ? 1.5 : LINE_CHART_POINTS.radius,
				single
			);
			dataset.pointHoverRadius = scaledLinePoint(
				dimmed ? 2.5 : LINE_CHART_POINTS.hoverRadius,
				single
			);
			dataset.pointBorderWidth = dimmed ? 1 : 2;
			// Higher order draws later (on top) — line only; safe for non-stacked series
			dataset.order = dimmed ? index : focused ? 1000 : 100 + index;
		});
		if (chart.options?.plugins?.datalabels) {
			const baseLabels = buildLineDataLabels(colors, {
				fontSize: 10,
				multiSeries: true
			});
			Object.assign(chart.options.plugins.datalabels, baseLabels);
			if (focusLabel != null) {
				const baseDisplay = baseLabels.display;
				chart.options.plugins.datalabels.display = (context) => {
					const lbl = String(context.dataset.label ?? '');
					if (lbl !== focusLabel) return false;
					if (typeof baseDisplay === 'function') {
						return (baseDisplay as (c: typeof context) => boolean)(context);
					}
					return baseDisplay !== false;
				};
			}
		}
	}

	/**
	 * Color each type series and refresh axis/legend theme tokens.
	 * When `focusLabel` is set (legend hover), other series are greyed so the
	 * focused line stands out.
	 */
	function applyTypeOverTimeChartTheme(
		chart: ChartJS<'line'>,
		focusLabel: string | null = null
	) {
		const colors = getChartTheme(theme.isDark);
		applyTypeOverTimeSeriesFocus(chart, focusLabel);
		if (chart.options?.plugins?.legend) {
			// Keep legend off-canvas so plot height matches the other two cards
			chart.options.plugins.legend.display = false;
		}
		if (chart.options?.scales?.y?.ticks) {
			chart.options.scales.y.ticks.color = colors.ticks;
		}
		if (chart.options?.scales?.y?.grid) {
			chart.options.scales.y.grid.color = colors.grid;
		}
		if (chart.options?.scales?.x?.ticks) {
			chart.options.scales.x.ticks.color = colors.ticks;
		}
		if (chart.options?.plugins?.tooltip) {
			chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
			chart.options.plugins.tooltip.titleColor = colors.tooltipTitle;
			chart.options.plugins.tooltip.bodyColor = colors.tooltipTitle;
		}
		chart.update('none');
	}

	function parseHex(color: string): [number, number, number] | null {
		if (!color.startsWith('#') || color.length !== 7) return null;
		const r = parseInt(color.slice(1, 3), 16);
		const g = parseInt(color.slice(3, 5), 16);
		const b = parseInt(color.slice(5, 7), 16);
		if ([r, g, b].some((channel) => Number.isNaN(channel))) return null;
		return [r, g, b];
	}

	function rgbToHex(r: number, g: number, b: number): string {
		const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
		return `#${[clamp(r), clamp(g), clamp(b)]
			.map((value) => value.toString(16).padStart(2, '0'))
			.join('')}`;
	}

	function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
		const rn = r / 255;
		const gn = g / 255;
		const bn = b / 255;
		const max = Math.max(rn, gn, bn);
		const min = Math.min(rn, gn, bn);
		const delta = max - min;
		let h = 0;
		const l = (max + min) / 2;
		const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

		if (delta !== 0) {
			switch (max) {
				case rn:
					h = ((gn - bn) / delta) % 6;
					break;
				case gn:
					h = (bn - rn) / delta + 2;
					break;
				default:
					h = (rn - gn) / delta + 4;
			}
			h *= 60;
			if (h < 0) h += 360;
		}

		return [h, s, l];
	}

	function hslToRgb(h: number, s: number, l: number): [number, number, number] {
		const c = (1 - Math.abs(2 * l - 1)) * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = l - c / 2;
		let r = 0;
		let g = 0;
		let b = 0;

		if (h < 60) [r, g, b] = [c, x, 0];
		else if (h < 120) [r, g, b] = [x, c, 0];
		else if (h < 180) [r, g, b] = [0, c, x];
		else if (h < 240) [r, g, b] = [0, x, c];
		else if (h < 300) [r, g, b] = [x, 0, c];
		else [r, g, b] = [c, 0, x];

		return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
	}

	/** @deprecated alias — use getSeriesColor; kept for any remaining call sites */
	function getPieChartColor(index: number, isDark = isDarkMode()) {
		return getSeriesColor(index, isDark);
	}

	/** Slice separators: card-coloured ring so neighbouring slices don't blend. */
	function getPieSliceBorder(isDark = isDarkMode()) {
		if (isDark) {
			return cssVar('--color-warm-100', '#141516');
		}
		return '#ffffff';
	}

	function normalizeAggregationKey(
		raw: string | undefined,
		emptyLabel: string
	): { key: string; label: string } {
		if (typeof raw !== 'string' || !raw.trim()) {
			return { key: emptyLabel, label: emptyLabel };
		}

		const trimmed = raw.trim();
		return { key: trimmed.toUpperCase(), label: trimmed };
	}

	function aggregateIncidentsBy(field: 'driver', emptyLabel = 'Unassigned') {
		const grouped = new Map<string, { label: string; count: number }>();

		dashboardIncidents.forEach((incident) => {
			const { key, label } = normalizeAggregationKey(incident[field], emptyLabel);
			const existing = grouped.get(key);
			grouped.set(key, {
				label: existing?.label ?? label,
				count: (existing?.count ?? 0) + 1
			});
		});

		return Array.from(grouped.values())
			.map(({ label, count }) => [label, count] as [string, number])
			.sort(([, countA], [, countB]) => countB - countA);
	}

	function buildChartAriaLabel(title: string, entries: [string, number][]): string {
		if (entries.length === 0) return `${title}: no incident data available`;

		const total = entries.reduce((sum, [, count]) => sum + count, 0);
		const topEntries = entries
			.slice(0, 5)
			.map(([label, count]) => `${label}: ${count}`)
			.join(', ');
		const remainder = entries.length > 5 ? `, plus ${entries.length - 5} more categories` : '';

		return `${title}: ${total} total incidents. ${topEntries}${remainder}`;
	}

	function buildPieChartData(
		entries: [string, number][]
	): { labels: string[]; datasets: { data: number[]; backgroundColor: string[]; borderColor: string[]; borderWidth: number }[] } {
		return {
			labels: entries.map(([label]) => label),
			datasets: [
				{
					data: entries.map(([, count]) => count),
					backgroundColor: [],
					borderColor: [],
					borderWidth: 2
				}
			]
		};
	}

	/** Contrast text on a hex (or fallback) pie slice for readable datalabels. */
	function contrastOnHex(bg: string, isDark: boolean): string {
		if (bg.startsWith('#') && (bg.length === 7 || bg.length === 4)) {
			const full =
				bg.length === 4
					? `#${bg[1]}${bg[1]}${bg[2]}${bg[2]}${bg[3]}${bg[3]}`
					: bg;
			const r = parseInt(full.slice(1, 3), 16);
			const g = parseInt(full.slice(3, 5), 16);
			const b = parseInt(full.slice(5, 7), 16);
			// Relative luminance (sRGB approximation)
			const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
			return luminance > 0.55 ? '#181818' : '#f8f8f8';
		}
		return isDark ? '#f8f8f8' : '#181818';
	}

	/** Sum only numeric dataset values (Chart.js data unions include Point etc.). */
	function sumNumericData(data: unknown[] | undefined): number {
		if (!data) return 0;
		let total = 0;
		for (const v of data) {
			if (typeof v === 'number' && Number.isFinite(v)) total += v;
		}
		return total;
	}

	/** Share of a doughnut slice (0–1). Small slices get outside labels + leader lines. */
	const SMALL_SLICE_SHARE = 0.08;
	/**
	 * Radial distance from outer arc to the *centre* of the outside value+% text block.
	 * Leaders end at the same point so they don’t fight multi-label offsets.
	 */
	const OUTSIDE_LABEL_RADIUS_GAP = 22;
	/** Canvas layout padding so outside labels/leaders are never clipped by the bitmap edge. */
	/** Compact padding so the donut fits a short plot box without forcing height. */
	const DOUGHNUT_LAYOUT_PADDING = { top: 18, right: 16, bottom: 12, left: 16 } as const;

	function getDoughnutSliceShareFromValues(value: number, total: number): number {
		return total > 0 ? value / total : 0;
	}

	/**
	 * Custom donut labels: value stacked above percentage, same anchor for both.
	 * Outside (small) slices also get a faint gray leader from the arc to the label block.
	 * Replaces chartjs-plugin-datalabels for doughnuts (avoids multi-label misalignment).
	 */
	const doughnutSliceLabels: Plugin<'doughnut'> = {
		id: 'doughnutSliceLabels',
		afterDatasetsDraw(chart) {
			const dataset = chart.data.datasets[0];
			const meta = chart.getDatasetMeta(0);
			if (!dataset || !meta?.data?.length) return;

			const total = sumNumericData(dataset.data as unknown[]);
			if (total <= 0) return;

			const dark = isDarkMode();
			const themeColors = getChartTheme(dark);
			const leaderStroke = dark ? 'rgba(170, 174, 180, 0.55)' : 'rgba(120, 124, 130, 0.5)';
			const ctx = chart.ctx;
			const sliceCount = meta.data.length;
			const fontStack = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

			meta.data.forEach((element, index) => {
				const raw = dataset.data[index];
				const value = typeof raw === 'number' ? raw : 0;
				if (value <= 0) return;

				const share = getDoughnutSliceShareFromValues(value, total);
				const small = share > 0 && share < SMALL_SLICE_SHARE;
				const percentage = Math.round(share * 100);

				const arc = element as unknown as {
					getProps: (
						keys: string[],
						final?: boolean
					) => {
						startAngle: number;
						endAngle: number;
						innerRadius: number;
						outerRadius: number;
						x: number;
						y: number;
					};
				};
				const props = arc.getProps(
					['startAngle', 'endAngle', 'innerRadius', 'outerRadius', 'x', 'y'],
					true
				);
				const mid = (props.startAngle + props.endAngle) / 2;
				const cos = Math.cos(mid);
				const sin = Math.sin(mid);

				// Label block centre: mid-ring for large slices, outside for small
				const rLabel = small
					? props.outerRadius + OUTSIDE_LABEL_RADIUS_GAP
					: (props.innerRadius + props.outerRadius) / 2;
				const x = props.x + cos * rLabel;
				const y = props.y + sin * rLabel;

				const base = small ? 10 : sliceCount > 8 ? 11 : 12;
				const valueSize = base + 2;
				const pctSize = base;
				const valueText = String(value);
				const pctText = `(${percentage}%)`;
				const lineGap = 3;
				const valueH = valueSize * 1.2;
				const pctH = pctSize * 1.2;
				const blockH = valueH + lineGap + pctH;
				const valueY = y - blockH / 2 + valueH / 2;
				const pctY = y + blockH / 2 - pctH / 2;

				// Fill: outside uses legend colour; inside contrasts with slice
				let fill: string;
				if (small) {
					fill = themeColors.legend;
				} else {
					const bg = Array.isArray(dataset.backgroundColor)
						? dataset.backgroundColor[index]
						: dataset.backgroundColor;
					fill = contrastOnHex(typeof bg === 'string' ? bg : '#0072B2', dark);
				}
				const textStroke =
					fill === '#f8f8f8' || fill === '#ffffff'
						? 'rgba(0,0,0,0.55)'
						: dark
							? 'rgba(0,0,0,0.75)'
							: 'rgba(255,255,255,0.9)';

				// Leader for small slices → centre of the value+% block (not a second offset)
				if (small) {
					const x0 = props.x + cos * props.outerRadius;
					const y0 = props.y + sin * props.outerRadius;
					const rElbow = props.outerRadius + 7;
					const x1 = props.x + cos * rElbow;
					const y1 = props.y + sin * rElbow;
					// End just before the text block so the line doesn’t cut through digits
					const rEnd = rLabel - blockH / 2 - 2;
					const x2 = props.x + cos * Math.max(rElbow, rEnd);
					const y2 = props.y + sin * Math.max(rElbow, rEnd);

					ctx.save();
					ctx.strokeStyle = leaderStroke;
					ctx.fillStyle = leaderStroke;
					ctx.lineWidth = 1;
					ctx.lineCap = 'round';
					ctx.lineJoin = 'round';
					ctx.beginPath();
					ctx.moveTo(x0, y0);
					ctx.lineTo(x1, y1);
					ctx.lineTo(x2, y2);
					ctx.stroke();
					ctx.beginPath();
					ctx.arc(x2, y2, 2, 0, Math.PI * 2);
					ctx.fill();
					ctx.restore();
				}

				// Value above percentage — single centre (x,y), no multi-label offset fights
				ctx.save();
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.lineJoin = 'round';
				ctx.lineWidth = 3;
				ctx.strokeStyle = textStroke;
				ctx.fillStyle = fill;

				ctx.font = `bold ${valueSize}px ${fontStack}`;
				ctx.strokeText(valueText, x, valueY);
				ctx.fillText(valueText, x, valueY);

				ctx.font = `bold ${pctSize}px ${fontStack}`;
				ctx.strokeText(pctText, x, pctY);
				ctx.fillText(pctText, x, pctY);
				ctx.restore();
			});
		}
	};

	function buildPieChartOptions(
		colors: ReturnType<typeof getChartTheme>,
		sliceCount = 0
	): ChartOptions<'doughnut'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			// Donut hole — slightly smaller ring so more canvas is free for labels
			cutout: '50%',
			layout: {
				// Labels draw on the canvas; padding shrinks the ring so peaks are not clipped
				padding: { ...DOUGHNUT_LAYOUT_PADDING }
			},
			plugins: {
				// HTML card heading is the only chart title — never draw a Chart.js title
				title: {
					display: false
				},
				legend: {
					display: true,
					// Bottom legend keeps the plot short and consistent across the row
					position: 'bottom',
					labels: {
						usePointStyle: true,
						font: { size: 12, weight: 500 },
						color: colors.legend,
						padding: 6,
						boxWidth: 8
					}
				},
				tooltip: {
					backgroundColor: colors.tooltipBg,
					titleColor: colors.tooltipTitle,
					bodyColor: colors.tooltipTitle,
					titleFont: { size: 14, weight: 'bold' },
					bodyFont: { size: 13 },
					padding: 12,
					cornerRadius: 8,
					displayColors: true,
					callbacks: {
						label: (context) => {
							const total = sumNumericData(context.dataset.data as unknown[]);
							const value = typeof context.parsed === 'number' ? context.parsed : 0;
							const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
							const name = context.label ?? '';
							return `${name}: ${value} (${percentage}%)`;
						}
					}
				},
				// Labels drawn by doughnutSliceLabels plugin (aligned value above %)
				datalabels: {
					display: false
				}
			}
		};
	}

	function applyPieChartTheme(
		chart: ChartJS<'doughnut'>,
		sliceCount = chart.data.labels?.length ?? 0
	) {
		const colors = getChartTheme(theme.isDark);
		const sliceBorder = getPieSliceBorder(theme.isDark);
		const dataset = chart.data.datasets[0];
		if (!dataset) return;

		const pieLabels = (chart.data.labels ?? []).map((label) => String(label));
		const pieColors = assignDistinctCategoryColors(pieLabels, theme.isDark);
		dataset.backgroundColor = pieLabels.map(
			(label) => pieColors.get(label) ?? getChartCategoryColor(label, 0, theme.isDark)
		);
		dataset.borderColor = pieLabels.map(() => sliceBorder);
		dataset.borderWidth = 3;

		if (chart.options?.plugins?.legend) {
			chart.options.plugins.legend.position = 'bottom';
			if (chart.options.plugins.legend.labels) {
				chart.options.plugins.legend.labels.color = colors.legend;
				chart.options.plugins.legend.labels.font = { size: 12, weight: 500 };
				chart.options.plugins.legend.labels.padding = 6;
				chart.options.plugins.legend.labels.boxWidth = 8;
			}
		}
		if (chart.options?.plugins?.tooltip) {
			chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
			chart.options.plugins.tooltip.titleColor = colors.tooltipTitle;
			chart.options.plugins.tooltip.bodyColor = colors.tooltipTitle;
		}
		// Ensure Chart.js never draws a second title under the card heading
		if (chart.options?.plugins) {
			chart.options.plugins.title = { display: false };
			// Labels are custom-drawn (doughnutSliceLabels), not chartjs-plugin-datalabels
			if (chart.options.plugins.datalabels) {
				chart.options.plugins.datalabels.display = false;
			}
		}
		// Keep donut hole + padding consistent (padding is what prevents label clipping)
		if (chart.options) {
			chart.options.cutout = '50%';
			chart.options.layout = {
				...(chart.options.layout ?? {}),
				padding: { ...DOUGHNUT_LAYOUT_PADDING }
			};
		}

		chart.update('none');
	}

	/**
	 * Deep-link to the incidents list with period + optional filters.
	 * Same pattern as driver-chart drill-down (shareable URL query params).
	 */
	function drillDownToIncidents(opts: {
		drill: string;
		driver?: string;
		type?: string;
		/** Exact status name, or list sentinels: __unresolved__ | __resolved__ | __unspecified__ */
		action?: string;
		/** Responded By (team leader); empty / unassigned → __unassigned__ */
		respondedBy?: string;
		/** Facility / PO suburb from the NSW map data label. */
		suburb?: string;
		/** Override period (e.g. d:YYYY-MM-DD for a single over-time day). */
		period?: TimeRangeKey;
	}) {
		const params = new URLSearchParams();
		params.set('period', opts.period ?? untrack(() => timeRange));
		params.set('drill', opts.drill);
		if (opts.driver !== undefined) {
			const d = opts.driver.trim();
			params.set('driver', !d || isUnassignedCategory(d) ? '__unassigned__' : d);
		}
		if (opts.type !== undefined) {
			const t = opts.type.trim();
			params.set('type', !t || t.toUpperCase() === 'UNSPECIFIED' ? '__unspecified__' : t);
		}
		if (opts.action !== undefined) {
			const a = opts.action.trim();
			if (!a || isUnassignedCategory(a) || a.toUpperCase() === 'UNSPECIFIED') {
				params.set('action', '__unspecified__');
			} else {
				params.set('action', a);
			}
		}
		if (opts.respondedBy !== undefined) {
			const r = opts.respondedBy.trim();
			params.set(
				'respondedBy',
				!r || isUnassignedCategory(r) ? '__unassigned__' : r
			);
		}
		if (opts.suburb !== undefined) {
			const s = opts.suburb.trim();
			if (s) params.set('suburb', s);
		}
		void goto(`/?${params.toString()}`);
	}

	/**
	 * Team-leader stacked bar colours:
	 * - Ongoing → medium grey (same family as unassigned chart buckets)
	 * - Resolved → brand teal (matches Total / accent KPI tile)
	 */
	function teamLeaderStatusColors(isDark: boolean): { ongoing: string; resolved: string } {
		return {
			ongoing: getUnassignedChartColor(isDark),
			// Light accent-600 / dark accent-600 (app.css)
			resolved: isDark ? '#1dd4be' : '#038676'
		};
	}

	function buildTeamLeaderBarOptions(
		colors: ReturnType<typeof getChartTheme>
	): ChartOptions<'bar'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			indexAxis: 'y',
			// Match Incidents by Driver plot chrome so category slots align
			layout: {
				padding: { top: 2, right: 32, left: 2, bottom: 2 }
			},
			onHover: (event, elements) => {
				const native = event.native;
				const target = native?.target;
				if (target instanceof HTMLElement) {
					target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
				}
			},
			onClick: (_event, elements, chart) => {
				if (!elements.length) return;
				const hit = elements[0];
				const leaderLabel = String(chart.data.labels?.[hit.index] ?? '');
				const ds = chart.data.datasets[hit.datasetIndex];
				const series = String(ds?.label ?? '');
				const raw = ds?.data?.[hit.index];
				const value = typeof raw === 'number' ? raw : Number(raw);
				if (!leaderLabel || !Number.isFinite(value) || value <= 0) return;
				if (ds?.hidden) return;
				if (
					typeof chart.isDatasetVisible === 'function' &&
					!chart.isDatasetVisible(hit.datasetIndex)
				) {
					return;
				}
				const action =
					series === 'Ongoing'
						? 'Ongoing'
						: series === 'Resolved'
							? '__resolved__'
							: undefined;
				if (!action) return;
				drillDownToIncidents({
					drill: 'team-leader-chart',
					respondedBy: leaderLabel,
					action
				});
			},
			plugins: {
				// Legend is HTML above the plot (same pattern as driver chart)
				// so bar thickness/gap match the driver chart slot formula.
				legend: { display: false },
				title: { display: false },
				tooltip: {
					backgroundColor: colors.tooltipBg,
					titleColor: colors.tooltipTitle,
					bodyColor: colors.tooltipTitle,
					titleFont: { size: 12, weight: 'bold' },
					bodyFont: { size: 11 },
					padding: 8,
					cornerRadius: 8,
					displayColors: true,
					callbacks: {
						label: (context) => {
							const value = context.parsed.x ?? 0;
							const name = context.dataset.label ?? '';
							if (value <= 0) return '';
							const rowTotal = teamLeaderRowTotalFromChart(
								context.chart,
								context.dataIndex
							);
							const pct =
								rowTotal > 0 ? ((value / rowTotal) * 100).toFixed(1) : '0.0';
							return `${name}: ${value} (${pct}% of row) · click to open list`;
						}
					}
				},
				datalabels: {
					anchor: 'center',
					align: 'center',
					clamp: true,
					clip: true,
					display: (context) => {
						const raw = context.dataset.data[context.dataIndex];
						return typeof raw === 'number' && raw >= 1;
					},
					formatter: (
						value: unknown,
						context: {
							dataIndex: number;
							chart: { data: { datasets: { data?: unknown[] }[] } };
						}
					) => {
						if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
							return '';
						}
						const rowTotal = teamLeaderRowTotalFromChart(context.chart, context.dataIndex);
						const pct = rowTotal > 0 ? ((value / rowTotal) * 100).toFixed(1) : '0.0';
						return `${value} (${pct}%)`;
					},
					color: '#ffffff',
					// 13px (was 12)
					font: { size: 13, weight: 'bold' as const },
					textStrokeColor: 'rgba(0,0,0,0.45)',
					textStrokeWidth: 2
				}
			},
			scales: {
				x: {
					stacked: true,
					beginAtZero: true,
					grace: '18%',
					ticks: {
						color: colors.ticks,
						stepSize: 1,
						precision: 0,
						font: { size: 10, weight: 500 }
					},
					grid: { color: colors.grid }
				},
				y: {
					stacked: true,
					ticks: {
						color: colors.ticks,
						font: { size: 10, weight: 600 },
						autoSkip: false
					},
					grid: { display: false }
				}
			}
		};
	}

	function applyTeamLeaderBarTheme(chart: ChartJS<'bar'>) {
		const colors = getChartTheme(theme.isDark);
		const status = teamLeaderStatusColors(theme.isDark);
		chart.data.datasets.forEach((dataset) => {
			const label = String(dataset.label ?? '');
			const solid =
				label === 'Ongoing'
					? status.ongoing
					: label === 'Resolved'
						? status.resolved
						: colors.accent;
			dataset.backgroundColor = withAlpha(solid, 0.85);
			dataset.borderColor = solid;
			dataset.borderWidth = 1;
			dataset.borderRadius = 2;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(dataset as any).barThickness = TEAM_LEADER_BAR_THICKNESS_PX;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(dataset as any).maxBarThickness = TEAM_LEADER_BAR_THICKNESS_PX;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(dataset as any).stack = 'tls';
		});
		if (chart.options?.plugins?.legend?.labels) {
			chart.options.plugins.legend.labels.color = colors.legend;
		}
		if (chart.options?.plugins?.tooltip) {
			chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
			chart.options.plugins.tooltip.titleColor = colors.tooltipTitle;
			chart.options.plugins.tooltip.bodyColor = colors.tooltipTitle;
		}
		if (chart.options?.scales?.x?.ticks) {
			chart.options.scales.x.ticks.color = colors.ticks;
		}
		if (chart.options?.scales?.x?.grid) {
			chart.options.scales.x.grid.color = colors.grid;
		}
		if (chart.options?.scales?.y?.ticks) {
			chart.options.scales.y.ticks.color = colors.ticks;
		}
		if (chart.options?.scales?.x) chart.options.scales.x.stacked = true;
		if (chart.options?.scales?.y) chart.options.scales.y.stacked = true;
		chart.update('none');
	}

	/** Row total from chart stacks (Ongoing + Resolved) for tooltip %. */
	function teamLeaderRowTotalFromChart(
		chart: { data: { datasets: { data?: unknown[] }[] } },
		index: number
	): number {
		let sum = 0;
		for (const ds of chart.data.datasets) {
			const raw = ds.data?.[index];
			const n = typeof raw === 'number' ? raw : Number(raw);
			if (Number.isFinite(n)) sum += n;
		}
		return sum;
	}

	/** Over-time chart point/label → list filtered to that day / month / year. */
	function drillDownOverTimeBucket(bucketKey: string) {
		const bucket = untrack(() => dashboardUi.overTimeBucket);
		if (bucket === 'day') {
			const dayPeriod = dayTimeRange(bucketKey);
			if (!dayPeriod) return;
			drillDownToIncidents({ drill: 'over-time-chart', period: dayPeriod });
			return;
		}
		if (bucket === 'month') {
			if (!/^\d{4}-\d{2}$/.test(bucketKey)) return;
			drillDownToIncidents({
				drill: 'over-time-chart',
				period: `m:${bucketKey}` as MonthTimeRangeKey
			});
			return;
		}
		const yearPeriod = yearTimeRange(bucketKey);
		if (!yearPeriod) return;
		drillDownToIncidents({ drill: 'over-time-chart', period: yearPeriod });
	}

	/** Bar chart: incidents per resolution status. Click a bar → list drill-down. */
	function buildActionStatusBarOptions(
		colors: ReturnType<typeof getChartTheme>
	): ChartOptions<'bar'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			// Default indexAxis 'x' → vertical columns
			layout: {
				// Summary-row plot (~7.15rem)
				padding: { top: 14, right: 4, left: 2, bottom: 2 }
			},
			onHover: (event, elements) => {
				const native = event.native;
				const target = native?.target;
				if (target instanceof HTMLElement) {
					target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
				}
			},
			onClick: (_event, elements, chart) => {
				if (!elements.length) return;
				const hit = elements[0];
				const statusLabel = String(chart.data.labels?.[hit.index] ?? '');
				const raw = chart.data.datasets[hit.datasetIndex]?.data?.[hit.index];
				const value = typeof raw === 'number' ? raw : Number(raw);
				if (!statusLabel || !Number.isFinite(value) || value <= 0) return;
				drillDownToIncidents({ drill: 'status-chart', action: statusLabel });
			},
			plugins: {
				legend: {
					display: false
				},
				title: {
					display: false
				},
				tooltip: {
					backgroundColor: colors.tooltipBg,
					titleColor: colors.tooltipTitle,
					bodyColor: colors.tooltipTitle,
					titleFont: { size: 12, weight: 'bold' },
					bodyFont: { size: 11 },
					padding: 8,
					cornerRadius: 8,
					displayColors: true,
					callbacks: {
						label: (context) => {
							const value = context.parsed.y ?? 0;
							const base = `${value} ${value === 1 ? 'incident' : 'incidents'}`;
							return `${base} · click to view list`;
						}
					}
				},
				datalabels: {
					anchor: 'end',
					align: 'top',
					offset: 1,
					clamp: false,
					clip: false,
					display: (context) => {
						const raw = context.dataset.data[context.dataIndex];
						return typeof raw === 'number' && raw > 0;
					},
					formatter: (value: unknown) =>
						typeof value === 'number' && Number.isFinite(value) ? String(value) : '',
					color: colors.legend,
					font: { size: 11, weight: 'bold' },
					textStrokeColor: isDarkMode() ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)',
					textStrokeWidth: 2
				}
			},
			scales: {
				y: {
					beginAtZero: true,
					grace: '14%',
					ticks: {
						color: colors.ticks,
						stepSize: 1,
						precision: 0,
						font: { size: 10, weight: 500 }
					},
					grid: {
						color: colors.grid
					}
				},
				x: {
					ticks: {
						color: colors.ticks,
						font: { size: 10, weight: 600 },
						maxRotation: 35,
						minRotation: 0,
						autoSkip: false
					},
					grid: {
						display: false
					}
				}
			}
		};
	}

	function applyActionStatusBarTheme(chart: ChartJS<'bar'>) {
		const colors = getChartTheme(theme.isDark);
		const isDark = theme.isDark;
		const dataset = chart.data.datasets[0];
		if (!dataset) return;

		// Match bar fills to action-status pill colours (by label, not series index).
		// Unassigned / Unspecified use medium gray like other charts.
		const labels = (chart.data.labels ?? []).map((l) => String(l));
		const solid = labels.map((label) =>
			isUnassignedCategory(label)
				? getUnassignedChartColor(isDark)
				: getActionStatusChartColor(label, isDark)
		);
		// 70% fill opacity; solid border keeps status colour readable (same palette as before)
		dataset.backgroundColor = solid.map((c) => withAlpha(c, 0.7));
		dataset.borderColor = solid;
		dataset.borderWidth = 1.5;
		dataset.borderRadius = 4;
		dataset.barPercentage = 0.7;
		dataset.categoryPercentage = 0.8;

		if (chart.options?.plugins?.datalabels) {
			chart.options.plugins.datalabels.color = colors.legend;
			chart.options.plugins.datalabels.textStrokeColor = isDark
				? 'rgba(0,0,0,0.75)'
				: 'rgba(255,255,255,0.9)';
		}
		if (chart.options?.plugins?.tooltip) {
			chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
			chart.options.plugins.tooltip.titleColor = colors.tooltipTitle;
			chart.options.plugins.tooltip.bodyColor = colors.tooltipTitle;
		}
		if (chart.options?.scales?.y?.ticks) {
			chart.options.scales.y.ticks.color = colors.ticks;
		}
		if (chart.options?.scales?.y?.grid) {
			chart.options.scales.y.grid.color = colors.grid;
		}
		if (chart.options?.scales?.x?.ticks) {
			chart.options.scales.x.ticks.color = colors.ticks;
		}
		chart.update('none');
	}

	/**
	 * Sum only visible (legend-shown) stack segments for a driver bar index.
	 * Hidden datasets from legend clicks must not count toward end totals.
	 */
	function sumVisibleDriverStack(
		chart: {
			data: { datasets: { data?: unknown[]; hidden?: boolean }[] };
			isDatasetVisible?: (index: number) => boolean;
		},
		dataIndex: number
	): number {
		let sum = 0;
		chart.data.datasets.forEach((ds, i) => {
			if (ds.hidden) return;
			if (typeof chart.isDatasetVisible === 'function' && !chart.isDatasetVisible(i)) return;
			const v = ds.data?.[dataIndex];
			if (typeof v === 'number' && Number.isFinite(v)) sum += v;
		});
		return sum;
	}

	/** Visible incident total across every driver bar (selected period, legend-honouring). */
	function sumVisibleDriverPeriodTotal(chart: {
		data: { labels?: unknown; datasets: { data?: unknown[]; hidden?: boolean }[] };
		isDatasetVisible?: (index: number) => boolean;
	}): number {
		const n = Array.isArray(chart.data.labels) ? chart.data.labels.length : 0;
		let sum = 0;
		for (let i = 0; i < n; i++) sum += sumVisibleDriverStack(chart, i);
		return sum;
	}

	function formatDriverPeriodShare(part: number, whole: number): string {
		if (whole <= 0 || part <= 0) return '0%';
		const pct = (part / whole) * 100;
		if (pct > 0 && pct < 1) return '<1%';
		return `${Math.round(pct)}%`;
	}

	function isVisibleDriverDataset(
		chart: {
			data: { datasets: { hidden?: boolean }[] };
			isDatasetVisible?: (index: number) => boolean;
		},
		index: number
	): boolean {
		const ds = chart.data.datasets[index];
		if (!ds || ds.hidden) return false;
		if (typeof chart.isDatasetVisible === 'function' && !chart.isDatasetVisible(index)) {
			return false;
		}
		return true;
	}

	function firstPositiveVisibleDriverDatasetIndex(
		chart: {
			data: { datasets: { data?: unknown[]; hidden?: boolean }[] };
			isDatasetVisible?: (index: number) => boolean;
		},
		dataIndex: number
	): number {
		for (let i = 0; i < chart.data.datasets.length; i++) {
			if (!isVisibleDriverDataset(chart, i)) continue;
			const v = chart.data.datasets[i]?.data?.[dataIndex];
			if (typeof v === 'number' && v > 0) return i;
		}
		return -1;
	}

	function lastPositiveVisibleDriverDatasetIndex(
		chart: {
			data: { datasets: { data?: unknown[]; hidden?: boolean }[] };
			isDatasetVisible?: (index: number) => boolean;
		},
		dataIndex: number
	): number {
		for (let i = chart.data.datasets.length - 1; i >= 0; i--) {
			if (!isVisibleDriverDataset(chart, i)) continue;
			const v = chart.data.datasets[i]?.data?.[dataIndex];
			if (typeof v === 'number' && v > 0) return i;
		}
		return -1;
	}

	/** Round only the outer ends so stacks stay flush; 6px is between square and pill. */
	function driverBarSegmentRadius(context: {
		datasetIndex: number;
		dataIndex: number;
		chart: {
			data: { datasets: { data?: unknown[]; hidden?: boolean }[] };
			isDatasetVisible?: (index: number) => boolean;
		};
	}) {
		const r = DRIVER_BAR_RADIUS_PX;
		const first = firstPositiveVisibleDriverDatasetIndex(context.chart, context.dataIndex);
		const last = lastPositiveVisibleDriverDatasetIndex(context.chart, context.dataIndex);
		const start = context.datasetIndex === first ? r : 0;
		const end = context.datasetIndex === last ? r : 0;
		return {
			topLeft: start,
			bottomLeft: start,
			topRight: end,
			bottomRight: end
		};
	}

	/** Last dataset index that is currently visible (draws the end total once). */
	function lastVisibleDriverDatasetIndex(chart: {
		data: { datasets: { hidden?: boolean }[] };
		isDatasetVisible?: (index: number) => boolean;
	}): number {
		let last = -1;
		chart.data.datasets.forEach((ds, i) => {
			if (ds.hidden) return;
			if (typeof chart.isDatasetVisible === 'function' && !chart.isDatasetVisible(i)) return;
			last = i;
		});
		return last;
	}

	/** Driver chart segment → list filtered by driver × type × period. */
	function drillDownDriverSegment(driverLabel: string, typeLabel: string) {
		drillDownToIncidents({
			drill: 'driver-chart',
			driver: driverLabel,
			type: typeLabel
		});
	}

	/**
	 * Horizontal stacked bar: drivers on Y, segments = incident type.
	 * Legend is HTML (above plot). Click a segment → drill to incidents list.
	 */
	function buildDriverBarOptions(
		colors: ReturnType<typeof getChartTheme>
	): ChartOptions<'bar'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			indexAxis: 'y',
			layout: {
				// Extra right pad so "12 (25%)" end labels are not clipped
				padding: { top: 2, right: 56, left: 2, bottom: 2 }
			},
			onHover: (event, elements) => {
				const native = event.native;
				const target = native?.target;
				if (target instanceof HTMLElement) {
					target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
				}
			},
			onClick: (_event, elements, chart) => {
				if (!elements.length) return;
				const hit = elements[0];
				const driverLabel = String(chart.data.labels?.[hit.index] ?? '');
				const ds = chart.data.datasets[hit.datasetIndex];
				const typeLabel = String(ds?.label ?? '');
				const raw = ds?.data?.[hit.index];
				const value = typeof raw === 'number' ? raw : Number(raw);
				if (!driverLabel || !Number.isFinite(value) || value <= 0) return;
				// Skip hidden / legend-filtered series
				if (ds?.hidden) return;
				if (
					typeof chart.isDatasetVisible === 'function' &&
					!chart.isDatasetVisible(hit.datasetIndex)
				) {
					return;
				}
				drillDownDriverSegment(driverLabel, typeLabel);
			},
			plugins: {
				legend: { display: false },
				title: { display: false },
				tooltip: {
					backgroundColor: colors.tooltipBg,
					titleColor: colors.tooltipTitle,
					bodyColor: colors.tooltipTitle,
					titleFont: { size: 12, weight: 'bold' },
					bodyFont: { size: 11 },
					padding: 8,
					cornerRadius: 8,
					displayColors: true,
					// Only list visible segments (legend-filtered types stay out)
					filter: (item) => {
						const chart = item.chart;
						const idx = item.datasetIndex;
						if (chart.data.datasets[idx]?.hidden) return false;
						return typeof chart.isDatasetVisible === 'function'
							? chart.isDatasetVisible(idx)
							: true;
					},
					callbacks: {
						// Title = driver; each line = type + count
						title: (items) => {
							const first = items[0];
							return first?.label ? String(first.label) : '';
						},
						label: (context) => {
							const value = context.parsed.x ?? 0;
							if (value <= 0) return '';
							const typeName = context.dataset.label ?? 'Type';
							return `${typeName}: ${value}`;
						},
						footer: (items) => {
							const first = items[0];
							if (!first) return '';
							const total = sumVisibleDriverStack(first.chart, first.dataIndex);
							return total > 0 ? `Total: ${total}` : '';
						}
					}
				},
				// Dual labels via chartjs-plugin-datalabels v2 `labels` map:
				// - segment: type count inside each stack slice
				// - total: visible-only driver total outside the right end of the bar
				datalabels: {
					labels: {
						segment: {
							anchor: 'center',
							align: 'center',
							clamp: true,
							clip: true,
							display: (context: {
								dataset: { data: unknown[]; hidden?: boolean };
								dataIndex: number;
								datasetIndex: number;
								chart: { isDatasetVisible?: (i: number) => boolean };
							}) => {
								if (context.dataset.hidden) return false;
								if (
									typeof context.chart.isDatasetVisible === 'function' &&
									!context.chart.isDatasetVisible(context.datasetIndex)
								) {
									return false;
								}
								const raw = context.dataset.data[context.dataIndex];
								return typeof raw === 'number' && raw >= 1;
							},
							formatter: (value: unknown) =>
								typeof value === 'number' && Number.isFinite(value) && value > 0
									? String(value)
									: '',
							color: '#ffffff',
							font: { size: 10, weight: 'bold' as const },
							textStrokeColor: 'rgba(0,0,0,0.45)',
							textStrokeWidth: 2
						},
						total: {
							// Last *visible* stack dataset draws the end total (once per bar)
							display: (context: {
								datasetIndex: number;
								chart: {
									data: { datasets: { data?: unknown[]; hidden?: boolean }[] };
									isDatasetVisible?: (index: number) => boolean;
								};
								dataIndex: number;
							}) => {
								const lastVisible = lastVisibleDriverDatasetIndex(context.chart);
								if (lastVisible < 0 || context.datasetIndex !== lastVisible) return false;
								return sumVisibleDriverStack(context.chart, context.dataIndex) > 0;
							},
							formatter: (
								_value: unknown,
								context: {
									dataIndex: number;
									chart: {
										data: {
											labels?: unknown;
											datasets: { data?: unknown[]; hidden?: boolean }[];
										};
										isDatasetVisible?: (index: number) => boolean;
									};
								}
							) => {
								const sum = sumVisibleDriverStack(context.chart, context.dataIndex);
								if (sum <= 0) return '';
								const period = sumVisibleDriverPeriodTotal(context.chart);
								return `${sum} (${formatDriverPeriodShare(sum, period)})`;
							},
							// Horizontal bar: end of bar = right side of stack
							anchor: 'end',
							align: 'end',
							offset: 6,
							clamp: false,
							clip: false,
							color: colors.legend,
							font: { size: 12, weight: 'bold' as const },
							textStrokeColor: isDarkMode()
								? 'rgba(0,0,0,0.75)'
								: 'rgba(255,255,255,0.9)',
							textStrokeWidth: 3
						}
					}
				}
			},
			scales: {
				x: {
					stacked: true,
					beginAtZero: true,
					// Room for external "12 (25%)" labels past the bar end
					grace: '22%',
					ticks: {
						color: colors.ticks,
						stepSize: 1,
						precision: 0,
						font: { size: 10, weight: 500 }
					},
					grid: { color: colors.grid }
				},
				y: {
					stacked: true,
					ticks: {
						color: colors.ticks,
						font: { size: 10, weight: 600 },
						autoSkip: false
					},
					grid: { display: false }
				}
			}
		};
	}

	/**
	 * Stacked driver bar theme. When `focusLabel` is set (legend hover), other
	 * type segments grey out so the focused stack colour is prominent.
	 *
	 * Bars need a full dataset rebuild + theme on hover (unlike lines, which
	 * recolour in place). Chart.js stacked bar meta often ignores in-place
	 * backgroundColor tweaks after the first paint.
	 */
	function applyDriverBarTheme(
		chart: ChartJS<'bar'>,
		focusLabel: string | null = null
	) {
		const colors = getChartTheme(theme.isDark);
		const isDark = theme.isDark;
		const dimFill = getDimmedSeriesColor(isDark);
		const dimBorder = getDimmedSeriesBorderColor(isDark);
		const colorMap = assignDistinctCategoryColors(
			chart.data.datasets.map((d) => String(d.label ?? '')),
			isDark
		);

		chart.data.datasets.forEach((dataset) => {
			const typeLabel = String(dataset.label ?? '');
			const solid =
				colorMap.get(typeLabel) ?? getChartCategoryColor(typeLabel, 0, isDark);
			const dimmed = focusLabel != null && focusLabel !== typeLabel;
			const focused = focusLabel != null && focusLabel === typeLabel;
			// Gridline grey when dimmed; full type colour when focused / idle
			dataset.backgroundColor = dimmed ? dimFill : withAlpha(solid, 0.82);
			dataset.borderColor = dimmed ? dimBorder : solid;
			dataset.borderWidth = dimmed ? 0.5 : focused ? 1.5 : 1;
			dataset.borderRadius = driverBarSegmentRadius;
			dataset.borderSkipped = false;
			// Fixed bar thickness (horizontal bar "height") — independent of driver count
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(dataset as any).barThickness = DRIVER_BAR_THICKNESS_PX;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(dataset as any).maxBarThickness = DRIVER_BAR_THICKNESS_PX;
			// Do not change `order` on hover — Chart.js order reorders stack segments.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(dataset as any).stack = 'types';
		});

		// Refresh total label chrome for theme
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const dl = chart.options?.plugins?.datalabels as any;
		if (dl?.labels?.total) {
			dl.labels.total.color = colors.legend;
			dl.labels.total.textStrokeColor = isDark
				? 'rgba(0,0,0,0.75)'
				: 'rgba(255,255,255,0.9)';
		}
		if (chart.options?.plugins?.tooltip) {
			chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
			chart.options.plugins.tooltip.titleColor = colors.tooltipTitle;
			chart.options.plugins.tooltip.bodyColor = colors.tooltipTitle;
		}
		if (chart.options?.plugins?.legend) {
			chart.options.plugins.legend.display = false;
		}
		if (chart.options?.scales?.x?.ticks) {
			chart.options.scales.x.ticks.color = colors.ticks;
		}
		if (chart.options?.scales?.x?.grid) {
			chart.options.scales.x.grid.color = colors.grid;
		}
		if (chart.options?.scales?.y?.ticks) {
			chart.options.scales.y.ticks.color = colors.ticks;
		}
		// Keep stacks on after theme refresh
		if (chart.options?.scales?.x) {
			chart.options.scales.x.stacked = true;
		}
		if (chart.options?.scales?.y) {
			chart.options.scales.y.stacked = true;
		}
		chart.update('none');
	}

	let { data } = $props();

	const incidents = $derived(incidentsFromPageData(incidentStore.list, data.incidents));

	/** Official Responded By dropdown names — table rows use these labels. */
	const respondedByOfficialNames = $derived(
		(data.respondedByOptions ?? [])
			.map((o) => (o.name ?? '').trim())
			.filter((name) => name.length > 0)
	);

	/** Dashboard metrics ignore blank / missing reference numbers (NO REF). */
	function hasIncidentReference(incident: Incident): boolean {
		return Boolean(incident.referenceNo?.trim());
	}

	/**
	 * Later rows that share a reference with an earlier incident (same rule as list DUPE tag).
	 * Computed from the full list so the original is correct even if outside the period filter.
	 */
	const duplicateRefIds = $derived(getDuplicateIncidentIds(incidents));

	/**
	 * All dashboard charts, KPIs, tables, and map use this set only:
	 * has a reference number and is not a duplicate of an earlier row.
	 */
	const dashboardIncidents = $derived(
		incidents.filter((i) => hasIncidentReference(i) && !duplicateRefIds.has(i.id))
	);

	let canvasElement: HTMLCanvasElement | undefined = $state();
	let typeOverTimeCanvas: HTMLCanvasElement | undefined = $state();
	let actionStatusCanvas: HTMLCanvasElement | undefined = $state();
	let driverCanvas: HTMLCanvasElement | undefined = $state();
	let teamLeaderCanvas: HTMLCanvasElement | undefined = $state();
	let driverMonthCanvas: HTMLCanvasElement | undefined = $state();
	let chartInstance = $state<ChartJS<'line'> | undefined>();
	let typeOverTimeChart = $state<ChartJS<'line'> | undefined>();
	let actionStatusChart = $state<ChartJS<'bar'> | undefined>();
	let driverChart = $state<ChartJS<'bar'> | undefined>();
	let teamLeaderChart = $state<ChartJS<'bar'> | undefined>();
	let driverMonthChart = $state<ChartJS<'line'> | undefined>();
	let resizeHandler: (() => void) | undefined;
	let isRetrying = $state(false);
	let retryError = $state<string | null>(null);

	async function handleRetry() {
		isRetrying = true;
		retryError = null;
		try {
			await invalidateAll();
		} catch (err) {
			retryError = err instanceof Error ? err.message : 'Retry failed';
		} finally {
			isRetrying = false;
		}
	}

	// Sync before paint so browser refresh doesn't stick on the loading state
	$effect.pre(() => {
		syncIncidentStoreFromPageData(data.supabase, data.incidents);
	});

	/**
	 * Time window for summary / charts — persisted across navigations
	 * (module store + sessionStorage; see `$lib/dashboardPeriod.svelte.ts`).
	 */
	let timeRange = $state<TimeRangeKey>(dashboardPeriod.value);

	function setTimeRange(next: string) {
		if (
			next !== 'all' &&
			next !== 'today' &&
			next !== 'week' &&
			next !== 'year' &&
			next !== '7' &&
			next !== '30' &&
			next !== '90' &&
			!isMonthTimeRange(next)
		) {
			return;
		}
		const value = next as TimeRangeKey;
		if (timeRange === value) return;
		timeRange = value;
		dashboardPeriod.value = value;
	}

	function onPeriodSelectChange(event: Event) {
		const el = event.currentTarget;
		if (!(el instanceof HTMLSelectElement)) return;
		setTimeRange(el.value);
	}

	/**
	 * Set true to show "Incidents by Type Over Time" again (markup + PDF path kept).
	 * Currently hidden; top row is Stats by Team Leader | Incidents Over Time.
	 */
	const SHOW_TYPE_OVER_TIME_CHART = false;

	/**
	 * Legend filters for multi-series charts (row 3): labels listed here are hidden.
	 * Click legend items to toggle. Reassigned as new arrays for Svelte reactivity.
	 */

	/** Legend hover focus — other series dim on the matching chart. */
	let hoveredTypeOverTimeLabel = $state<string | null>(null);
	let hoveredDriverTypeLabel = $state<string | null>(null);
	let hoveredDriverMonthLabel = $state<string | null>(null);

	/** PDF export (html2canvas + jsPDF). */
	let pdfExporting = $state(false);
	let pdfExportError = $state<string | null>(null);
	/** Live NSW map — used to snapshot the chart into the PDF. */
	let nswMap = $state<
		| {
				captureForPdf?: (opts?: {
					width?: number;
					height?: number;
				}) => Promise<{ url: string; width: number; height: number } | null>;
		  }
		| undefined
	>();

	function pdfFilenameSlug(label: string): string {
		return label
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 48);
	}

	/**
	 * High-fidelity PDF: snapshot the live dashboard grid (html2canvas).
	 * Honours the current Table/Chart toggles, period, and series visibility.
	 */
	async function exportDashboardPdf() {
		if (pdfExporting || typeof window === 'undefined') return;

		pdfExporting = true;
		pdfExportError = null;
		hoveredTypeOverTimeLabel = null;
		hoveredDriverTypeLabel = null;
		hoveredDriverMonthLabel = null;
		actionStatusPickerOpen = false;
		driverMonthPickerOpen = false;
		closeDriverMonthDetail();

		const root = document.getElementById('dashboard-pdf-root');
		root?.classList.add('pdf-capture');

		try {
			await tick();
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

			for (const chart of [
				chartInstance,
				actionStatusChart,
				teamLeaderChart,
				driverChart,
				driverMonthChart
			]) {
				chart?.resize();
				chart?.update('none');
			}
			await new Promise<void>((resolve) => setTimeout(resolve, 200));

			const html2canvas = (await import('html2canvas-pro')).default;
			const { jsPDF } = await import('jspdf');

			async function captureEl(el: HTMLElement): Promise<HTMLCanvasElement> {
				const width = Math.max(el.scrollWidth, el.clientWidth, 1360);
				return html2canvas(el, {
					backgroundColor: '#f7f4ef',
					scale: 2.5,
					useCORS: true,
					allowTaint: false,
					logging: false,
					width,
					windowWidth: width,
					scrollX: 0,
					scrollY: 0,
					onclone(clonedDoc, clone) {
						sanitizeCloneColors(clonedDoc);
						stripAssistiveOnly(clone);
						replaceCanvasesWithImages(el, clone);
					}
				});
			}

			const page1 = document.getElementById('dashboard-pdf-page-1');
			const page2 = document.getElementById('dashboard-pdf-page-2');
			if (!page1) throw new Error('Dashboard capture target is missing');

			const shot1 = await captureEl(page1);
			const shot2 = page2 ? await captureEl(page2) : null;

			function pageMmFor(canvas: HTMLCanvasElement): [number, number] {
				const aspect = canvas.width / Math.max(1, canvas.height);
				const h = 200;
				const w = Math.min(400, Math.max(280, h * aspect));
				return [w, h];
			}

			const [w1, h1] = pageMmFor(shot1);
			const pdf = new jsPDF({
				orientation: w1 >= h1 ? 'landscape' : 'portrait',
				unit: 'mm',
				format: [w1, h1],
				compress: true
			});
			const margin = 3.5;

			function addShot(canvas: HTMLCanvasElement, first: boolean) {
				const [pw, ph] = pageMmFor(canvas);
				if (!first) pdf.addPage([pw, ph], pw >= ph ? 'landscape' : 'portrait');
				const pageW = pdf.internal.pageSize.getWidth() as number;
				const pageH = pdf.internal.pageSize.getHeight() as number;
				const maxW = pageW - margin * 2;
				const maxH = pageH - margin * 2 - 3;
				const aspect = canvas.width / canvas.height;
				let w = maxW;
				let h = w / aspect;
				if (h > maxH) {
					h = maxH;
					w = h * aspect;
				}
				const x = (pageW - w) / 2;
				const y = margin;
				pdf.addImage(
					canvas.toDataURL('image/jpeg', 0.92),
					'JPEG',
					x,
					y,
					w,
					h,
					undefined,
					'MEDIUM'
				);
			}

			addShot(shot1, true);
			if (shot2) addShot(shot2, false);

			const pageCount = pdf.getNumberOfPages();
			for (let p = 1; p <= pageCount; p++) {
				pdf.setPage(p);
				const pageW = pdf.internal.pageSize.getWidth() as number;
				const pageH = pdf.internal.pageSize.getHeight() as number;
				pdf.setFont('helvetica', 'normal');
				pdf.setFontSize(7);
				pdf.setTextColor(120);
				const label =
					p === 1
						? `Page ${p} of ${pageCount} · Overview · JCH Incident Tracker`
						: `Page ${p} of ${pageCount} · Drivers · JCH Incident Tracker`;
				pdf.text(label, margin, pageH - 1.6);
				void pageW;
			}

			const periodSlug = pdfFilenameSlug(timeRangeLabel) || 'period';
			const dateSlug = new Date().toISOString().slice(0, 10);
			pdf.save(`jch-dashboard-${periodSlug}-${dateSlug}.pdf`);
		} catch (err) {
			console.error('Dashboard PDF export failed', err);
			pdfExportError =
				err instanceof Error ? err.message : 'Could not create PDF. Try again.';
		} finally {
			root?.classList.remove('pdf-capture');
			pdfExporting = false;
		}
	}

	function isLegendVisible(hidden: string[], label: string): boolean {
		return !hidden.includes(label);
	}

	function toggleLegendLabel(hidden: string[], label: string): string[] {
		return hidden.includes(label)
			? hidden.filter((l) => l !== label)
			: [...hidden, label];
	}

	function toggleTypeOverTimeLegend(label: string) {
		dashboardUi.hiddenTypeOverTimeLabels = toggleLegendLabel(dashboardUi.hiddenTypeOverTimeLabels, label);
	}

	function toggleDriverTypeLegend(label: string) {
		dashboardUi.hiddenDriverTypeLabels = toggleLegendLabel(dashboardUi.hiddenDriverTypeLabels, label);
	}

	/**
	 * Resolution status bar: which statuses are hidden from the chart.
	 * Default: Unspecified excluded (blank action values).
	 */
	const ACTION_STATUS_DEFAULT_HIDDEN = ['Unspecified'] as const;
	let actionStatusHiddenLabels = $state<string[]>([...ACTION_STATUS_DEFAULT_HIDDEN]);
	let actionStatusPickerOpen = $state(false);

	function setActionStatusVisible(label: string, visible: boolean) {
		const isHidden = actionStatusHiddenLabels.includes(label);
		if (visible && isHidden) {
			actionStatusHiddenLabels = actionStatusHiddenLabels.filter((l) => l !== label);
		} else if (!visible && !isHidden) {
			actionStatusHiddenLabels = [...actionStatusHiddenLabels, label];
		}
	}

	function onActionStatusCheckboxChange(label: string, event: Event) {
		const el = event.currentTarget;
		if (!(el instanceof HTMLInputElement)) return;
		setActionStatusVisible(label, el.checked);
	}

	function applyActionStatusShowAll() {
		actionStatusHiddenLabels = [];
	}

	function applyActionStatusHideAll() {
		actionStatusHiddenLabels = incidentsByActionStatus.map(([label]) => label);
	}

	function applyActionStatusDefaultVisibility() {
		actionStatusHiddenLabels = [...ACTION_STATUS_DEFAULT_HIDDEN];
	}

	/**
	 * Driver×month line series visibility (checkbox dropdown).
	 * Default (until user customises): hide everyone outside the top N by volume.
	 * Reset when the period / driver set changes.
	 */
	let driverMonthHiddenLabels = $state<string[]>([]);
	let driverMonthVisibilityTouched = $state(false);
	let driverMonthVisibilitySourceKey = $state('');
	/** Drivers multi-select dropdown open state. */
	let driverMonthPickerOpen = $state(false);

	function driverMonthTopNHidden(labelsInRankOrder: string[], topN: number): string[] {
		if (labelsInRankOrder.length <= topN) return [];
		return labelsInRankOrder.slice(topN);
	}

	function applyDriverMonthTopNVisibility(topN: number = DRIVER_MONTH_TOP_N) {
		// Top 10 (default) resets “untouched” so period changes re-apply top 10;
		// other shortcuts (e.g. Top 5) count as a user choice.
		driverMonthVisibilityTouched = topN !== DRIVER_MONTH_TOP_N;
		driverMonthHiddenLabels = driverMonthTopNHidden(
			driverMonthTally.rows.map((r) => r.label),
			topN
		);
	}

	function applyDriverMonthShowAll() {
		driverMonthVisibilityTouched = true;
		driverMonthHiddenLabels = [];
	}

	function applyDriverMonthHideAll() {
		driverMonthVisibilityTouched = true;
		driverMonthHiddenLabels = driverMonthTally.rows.map((r) => r.label);
	}

	function setDriverMonthSeriesVisible(label: string, visible: boolean) {
		driverMonthVisibilityTouched = true;
		const isHidden = driverMonthHiddenLabels.includes(label);
		if (visible && isHidden) {
			driverMonthHiddenLabels = driverMonthHiddenLabels.filter((l) => l !== label);
		} else if (!visible && !isHidden) {
			driverMonthHiddenLabels = [...driverMonthHiddenLabels, label];
		}
	}

	function toggleDriverMonthLegend(label: string) {
		driverMonthVisibilityTouched = true;
		driverMonthHiddenLabels = toggleLegendLabel(driverMonthHiddenLabels, label);
	}

	function onDriverMonthCheckboxChange(label: string, event: Event) {
		const el = event.currentTarget;
		if (!(el instanceof HTMLInputElement)) return;
		setDriverMonthSeriesVisible(label, el.checked);
	}

	/** Canonical YYYY-MM-DD from dateReceived (handles ISO datetimes). */
	function dateReceivedKey(dateStr: string | undefined | null): string | null {
		const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr?.trim() ?? '');
		return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
	}

	/**
	 * Distinct calendar months (YYYY-MM) that have at least one incident,
	 * newest first — for the time picker month list.
	 */
	const availableMonths = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const incident of dashboardIncidents) {
			const key = dateReceivedKey(incident.dateReceived);
			if (!key) continue;
			const ym = key.slice(0, 7);
			counts.set(ym, (counts.get(ym) ?? 0) + 1);
		}
		return [...counts.entries()]
			.sort(([a], [b]) => b.localeCompare(a))
			.map(([ym, count]) => ({ ym, count, value: `m:${ym}` as MonthTimeRangeKey }));
	});

	/** Always include the current calendar month in the picker, even with 0 incidents. */
	const periodMonthOptions = $derived.by(() => {
		const curYm = currentMonthYm();
		const curValue = currentMonthTimeRange();
		const byYm = new Map(availableMonths.map((m) => [m.ym, m]));
		const cur = byYm.get(curYm) ?? { ym: curYm, count: 0, value: curValue };
		const rest = availableMonths.filter((m) => m.ym !== curYm);
		return [cur, ...rest];
	});

	const timeRangeLabel = $derived.by(() => {
		const relative = TIME_RANGE_OPTIONS.find((o) => o.value === timeRange);
		if (relative) return relative.label;
		if (isMonthTimeRange(timeRange)) {
			const ym = monthKeyFromRange(timeRange);
			const hit = periodMonthOptions.find((m) => m.ym === ym);
			const base = formatMonthYearLabel(ym);
			if (hit) return `${base} (${hit.count})`;
			return base;
		}
		if (isDayTimeRange(timeRange) || isYearTimeRange(timeRange)) {
			return String(timeRange);
		}
		return 'All time';
	});

	// Keep local timeRange in sync with the persisted store (e.g. after navigation).
	// Do not clear month selection when the month has no data.
	$effect(() => {
		const stored = dashboardPeriod.value;
		if (timeRange !== stored) {
			timeRange = stored;
		}
	});

	// Day-level series (type-over-time + any day-based consumers)
	const incidentsByDate = $derived.by(() => {
		const grouped: Record<string, number> = {};
		const range = timeRange;

		dashboardIncidents.forEach((incident) => {
			const date = incident.dateReceived;
			if (!isDateReceivedInTimeRange(date, range)) return;
			const key = dateReceivedKey(date);
			if (!key) return;
			grouped[key] = (grouped[key] || 0) + 1;
		});

		return Object.entries(grouped).sort(([dateA], [dateB]) => dateA.localeCompare(dateB));
	});

	/**
	 * Incidents Over Time series: aggregates by day / month / year within the
	 * selected period. Keys are YYYY-MM-DD | YYYY-MM | YYYY.
	 */
	const overTimeSeries = $derived.by(() => {
		const range = timeRange;
		const bucket = dashboardUi.overTimeBucket;
		const grouped = new Map<string, number>();
		for (const incident of dashboardIncidents) {
			if (!isDateReceivedInTimeRange(incident.dateReceived, range)) continue;
			const dayKey = dateReceivedKey(incident.dateReceived);
			if (!dayKey) continue;
			const key =
				bucket === 'day' ? dayKey : bucket === 'month' ? dayKey.slice(0, 7) : dayKey.slice(0, 4);
			grouped.set(key, (grouped.get(key) ?? 0) + 1);
		}
		return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
	});

	/** Primary x-tick label for the active over-time bucket. */
	function overTimeTickLabel(bucketKey: string, bucket: OverTimeBucket): string {
		if (bucket === 'day') {
			const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bucketKey.trim());
			if (!m) return bucketKey;
			return String(parseInt(m[3], 10));
		}
		if (bucket === 'month') {
			const m = /^(\d{4})-(\d{2})$/.exec(bucketKey.trim());
			if (!m) return bucketKey;
			const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
			if (Number.isNaN(d.getTime())) return bucketKey;
			return d.toLocaleDateString('en-AU', { month: 'short' });
		}
		return bucketKey; // year
	}

	const chartData = $derived.by(() => {
		const bucket = dashboardUi.overTimeBucket;
		const series = overTimeSeries;
		return {
			labels: series.map(([key]) => overTimeTickLabel(key, bucket)),
			datasets: [
				{
					label: 'Incidents',
					data: series.map(([, count]) => count),
					borderWidth: 2.5,
					fill: true,
					tension: 0.35,
					pointRadius: LINE_CHART_POINTS.radius,
					pointBorderWidth: 2,
					pointHoverRadius: LINE_CHART_POINTS.hoverRadius
				}
			]
		};
	});

	// Keep drill-down keys + bucket mirror aligned with chart categories
	$effect(() => {
		overTimeChartDateKeys = overTimeSeries.map(([key]) => key);
		overTimeChartBucket = dashboardUi.overTimeBucket;
	});

	/**
	 * Multi-series line data: for each incident type, counts per day on the same
	 * relative time window as "Incidents Over Time".
	 * Missing/blank types are bucketed as "Unspecified" (medium-gray series colour).
	 */
	const typeOverTimeChartData = $derived.by(() => {
		// Same relative window as the time picker (via incidentsByDate)
		const range = timeRange;
		const dateKeys = incidentsByDate.map(([date]) => date);
		const dateSet = new Set(dateKeys);
		const dark = theme.isDark;

		// Stable type keys → display labels (types seen on those dates)
		const typeMeta = new Map<string, string>();
		/** typeKey → date → count */
		const counts = new Map<string, Map<string, number>>();
		/** typeKey → total in selected period (legend; explicit range filter) */
		const typeTotals = new Map<string, number>();

		for (const incident of dashboardIncidents) {
			// Honour time picker directly (do not rely only on date-key set membership)
			if (!isDateReceivedInTimeRange(incident.dateReceived, range)) continue;
			const date = dateReceivedKey(incident.dateReceived);
			if (!date || !dateSet.has(date)) continue;

			// Canonical empty-type bucket for this chart
			const { key, label } = normalizeAggregationKey(incident.type, 'Unspecified');
			const displayLabel = isUnassignedCategory(label) ? 'Unspecified' : label;
			const typeKey = isUnassignedCategory(label) ? 'UNSPECIFIED' : key;
			if (!typeMeta.has(typeKey)) {
				typeMeta.set(typeKey, displayLabel);
				counts.set(typeKey, new Map(dateKeys.map((d) => [d, 0])));
			}
			const byDate = counts.get(typeKey)!;
			byDate.set(date, (byDate.get(date) ?? 0) + 1);
			typeTotals.set(typeKey, (typeTotals.get(typeKey) ?? 0) + 1);
		}

		// Named types A–Z, then Unspecified last so it is easy to find in the legend
		const sortedTypes = [...typeMeta.entries()].sort((a, b) => {
			const aU = isUnassignedCategory(a[1]);
			const bU = isUnassignedCategory(b[1]);
			if (aU !== bU) return aU ? 1 : -1;
			return a[1].localeCompare(b[1], undefined, { sensitivity: 'base' });
		});

		return {
			labels: dateKeys.map((date) => formatDate(date)),
			/** Raw rows for sr-only table: [typeLabel, counts per date...] */
			tableRows: sortedTypes.map(([key, label]) => ({
				label,
				counts: dateKeys.map((d) => counts.get(key)?.get(d) ?? 0)
			})),
			dateKeys,
			/** Active time window label for legends / a11y */
			periodLabel: timeRangeLabel,
			datasets: (() => {
				const colorMap = assignDistinctCategoryColors(
					sortedTypes.map(([, label]) => label),
					dark
				);
				return sortedTypes.map(([key, label]) => {
					const color =
						colorMap.get(label) ?? getChartCategoryColor(label, 0, dark);
					const data = dateKeys.map((d) => counts.get(key)?.get(d) ?? 0);
					// Prefer explicit period total (same filter as time picker)
					const total =
						typeTotals.get(key) ?? data.reduce((sum, n) => sum + n, 0);
					return {
						label,
						/** Total incidents for this type in the selected period (legend). */
						total,
						data,
						borderColor: color,
						backgroundColor: withAlpha(color, 0.06),
						pointBackgroundColor: color,
						borderWidth: 2,
						fill: false,
						tension: 0.35,
						pointRadius: LINE_CHART_POINTS.radius,
						pointBorderWidth: 2,
						pointHoverRadius: LINE_CHART_POINTS.hoverRadius
					};
				});
			})()
		};
	});

	const hasTypeOverTimeData = $derived(typeOverTimeChartData.datasets.length > 0);

	const typeOverTimeAriaLabel = $derived.by(() => {
		const { datasets, dateKeys } = typeOverTimeChartData;
		if (datasets.length === 0 || dateKeys.length === 0) {
			return 'Incidents by type over time: no incident data available';
		}
		const typeNames = datasets.map((d) => d.label).slice(0, 8).join(', ');
		const more =
			datasets.length > 8 ? `, plus ${datasets.length - 8} more types` : '';
		return `Incidents by type over time (${timeRangeLabel}) for ${dateKeys.length} days. Types: ${typeNames}${more}.`;
	});

	/** Incidents in the selected time period (shared by summary tiles, charts, tables, map). */
	const periodIncidents = $derived.by(() => {
		const range = timeRange;
		return dashboardIncidents.filter((i) => isDateReceivedInTimeRange(i.dateReceived, range));
	});

	/**
	 * Counts by resolution status in the selected period.
	 * Order: New → Ongoing → remaining statuses by count high → low.
	 */
	const incidentsByActionStatus = $derived.by(() => {
		const grouped = new Map<string, { label: string; count: number }>();
		for (const incident of periodIncidents) {
			const { key, label } = normalizeAggregationKey(incident.action, 'Unspecified');
			const existing = grouped.get(key);
			grouped.set(key, {
				label: existing?.label ?? label,
				count: (existing?.count ?? 0) + 1
			});
		}
		function statusOrderRank(label: string): number {
			const key = label.trim().toUpperCase();
			if (key === 'NEW') return 0;
			if (key === 'ONGOING') return 1;
			return 2;
		}
		return Array.from(grouped.values())
			.map(({ label, count }) => [label, count] as [string, number])
			.sort(([labelA, countA], [labelB, countB]) => {
				const rankA = statusOrderRank(labelA);
				const rankB = statusOrderRank(labelB);
				if (rankA !== rankB) return rankA - rankB;
				return countB - countA;
			});
	});

	/** Statuses shown on the bar chart after include/exclude dropdown. */
	const visibleIncidentsByActionStatus = $derived.by(() => {
		const hidden = new Set(actionStatusHiddenLabels);
		return incidentsByActionStatus.filter(([label]) => !hidden.has(label));
	});

	const actionStatusVisibleCount = $derived(visibleIncidentsByActionStatus.length);
	const actionStatusTotalCount = $derived(incidentsByActionStatus.length);

	const actionStatusBarData = $derived.by(() => ({
		labels: visibleIncidentsByActionStatus.map(([label]) => label),
		datasets: [
			{
				label: 'Incidents',
				data: visibleIncidentsByActionStatus.map(([, count]) => count),
				borderWidth: 1
			}
		]
	}));

	/**
	 * Stats by Team Leader: Responded By only (same rule as the CaringbahPDC tally).
	 * One row per dropdown option, plus any extra free-text Responded By values.
	 * Ongoing = resolution status Ongoing.
	 * Resolved = any status except Ongoing and New.
	 * New is excluded from the row totals (e.g. 1 July CaringbahPDC / New does not
	 * increment Ongoing, Resolved, or Total).
	 *
	 * Unassigned = Responded By is null/blank (any status, including New).
	 */
	const statsByTeamLeader = $derived.by(() => {
		const officialNames = respondedByOfficialNames;
		const byLeader = new Map<
			string,
			{ key: string; label: string; ongoing: number; resolved: number }
		>();
		// Always list every Responded By dropdown option (CaringbahPDC included), even at 0.
		for (const name of officialNames) {
			const label = canonicalLeaderLabel(name, officialNames);
			const key = label.toUpperCase();
			if (!byLeader.has(key)) {
				byLeader.set(key, { key, label, ongoing: 0, resolved: 0 });
			}
		}
		/** Period incidents with null/blank Responded By (any status). */
		let unassignedTotal = 0;
		for (const incident of periodIncidents) {
			const bucket = teamLeaderStatsBucket(incident, officialNames);
			if (bucket.kind === 'unassigned') {
				unassignedTotal += 1;
				continue;
			}

			const action = (incident.action ?? '').trim().toUpperCase();
			const isOngoing = action === 'ONGOING';
			const isNew = action === 'NEW';
			// Resolved = not Ongoing and not New — New is excluded from leader Ongoing/Resolved columns
			const isResolved = !isOngoing && !isNew;
			// New (with a Responded By) is not Ongoing or Resolved — omit from the row tally
			if (!isOngoing && !isResolved) continue;

			const r = { key: bucket.key, label: bucket.label };
			let row = byLeader.get(r.key);
			if (!row) {
				row = { key: r.key, label: r.label, ongoing: 0, resolved: 0 };
				byLeader.set(r.key, row);
			}
			if (isOngoing) row.ongoing += 1;
			else row.resolved += 1;
		}
		const rows = [...byLeader.values()].sort((a, b) => {
			if (b.ongoing !== a.ongoing) return b.ongoing - a.ongoing;
			if (b.resolved !== a.resolved) return b.resolved - a.resolved;
			return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
		});
		const totalOngoing = rows.reduce((sum, row) => sum + row.ongoing, 0);
		const totalResolved = rows.reduce((sum, row) => sum + row.resolved, 0);
		const leadersTotal = totalOngoing + totalResolved;
		const grandTotal = leadersTotal + unassignedTotal;
		return {
			periodLabel: timeRangeLabel,
			totalOngoing,
			totalResolved,
			unassignedTotal,
			grandTotal,
			rows: rows.map((row) => {
				const total = row.ongoing + row.resolved;
				return {
					key: row.key,
					label: row.label,
					ongoing: row.ongoing,
					/** Share of this team leader’s total that is Ongoing. */
					ongoingPct: total > 0 ? (row.ongoing / total) * 100 : 0,
					resolved: row.resolved,
					/** Share of this team leader’s total that is Resolved. */
					resolvedPct: total > 0 ? (row.resolved / total) * 100 : 0,
					/** Ongoing + Resolved for this team leader. */
					total
				};
			})
		};
	});

	const hasStatsByTeamLeader = $derived(
		statsByTeamLeader.rows.length > 0 || statsByTeamLeader.unassignedTotal > 0
	);

	/** Chart only needs assigned leaders with at least one incident (skip 0-count dropdown rows). */
	const teamLeaderChartRows = $derived(statsByTeamLeader.rows.filter((row) => row.total > 0));
	const hasTeamLeaderChartData = $derived(teamLeaderChartRows.length > 0);

	const teamLeaderBarData = $derived.by(() => {
		const dark = theme.isDark;
		const status = teamLeaderStatusColors(dark);
		const rows = teamLeaderChartRows;
		return {
			labels: rows.map((r) => r.label),
			datasets: [
				{
					label: 'Ongoing',
					data: rows.map((r) => r.ongoing),
					backgroundColor: withAlpha(status.ongoing, 0.85),
					borderColor: status.ongoing,
					borderWidth: 1,
					borderRadius: 2,
					stack: 'tls',
					barThickness: TEAM_LEADER_BAR_THICKNESS_PX,
					maxBarThickness: TEAM_LEADER_BAR_THICKNESS_PX
				},
				{
					label: 'Resolved',
					data: rows.map((r) => r.resolved),
					backgroundColor: withAlpha(status.resolved, 0.85),
					borderColor: status.resolved,
					borderWidth: 1,
					borderRadius: 2,
					stack: 'tls',
					barThickness: TEAM_LEADER_BAR_THICKNESS_PX,
					maxBarThickness: TEAM_LEADER_BAR_THICKNESS_PX
				}
			]
		};
	});

	const teamLeaderChartHeightPx = $derived(
		teamLeaderChartHeightForCount(teamLeaderChartRows.length)
	);

	const statsByTeamLeaderAriaLabel = $derived.by(() => {
		const { rows, totalOngoing, totalResolved, unassignedTotal, grandTotal, periodLabel } =
			statsByTeamLeader;
		if (rows.length === 0 && unassignedTotal === 0) {
			return `Stats by Team Leader (${periodLabel}): no ongoing or resolved incidents in this period`;
		}
		return `Stats by Team Leader for ${periodLabel}. ${rows.length} team leader${rows.length === 1 ? '' : 's'}, ${totalOngoing} ongoing, ${totalResolved} resolved, ${unassignedTotal} unassigned, ${grandTotal} total.`;
	});

	/** Any statuses exist in the period (for the picker / empty copy). */
	const hasActionStatusSourceData = $derived(incidentsByActionStatus.length > 0);
	/** Visible bars after include/exclude (drives chart empty state). */
	const hasActionStatusData = $derived(visibleIncidentsByActionStatus.length > 0);
	const actionStatusAriaLabel = $derived(
		buildChartAriaLabel(
			`Incidents by Resolution Status (${timeRangeLabel})`,
			visibleIncidentsByActionStatus
		)
	);

	/**
	 * Stacked horizontal bars: one row per driver, segments = incident type.
	 * Uses the same relative time window as the over-time charts.
	 * Drivers ordered by total count (desc); types ordered by volume in range.
	 */
	const driverStackedBarData = $derived.by(() => {
		const dark = theme.isDark;
		const range = timeRange;
		type DriverRow = { label: string; types: Map<string, number>; total: number };
		const byDriver = new Map<string, DriverRow>();
		const typeMeta = new Map<string, string>();
		const typeTotals = new Map<string, number>();

		for (const incident of dashboardIncidents) {
			if (!isDateReceivedInTimeRange(incident.dateReceived, range)) continue;

			const d = normalizeAggregationKey(incident.driver, 'Unassigned');
			const t = normalizeAggregationKey(incident.type, 'Unspecified');
			typeMeta.set(t.key, t.label);
			typeTotals.set(t.key, (typeTotals.get(t.key) ?? 0) + 1);

			let row = byDriver.get(d.key);
			if (!row) {
				row = { label: d.label, types: new Map(), total: 0 };
				byDriver.set(d.key, row);
			}
			row.types.set(t.key, (row.types.get(t.key) ?? 0) + 1);
			row.total += 1;
		}

		const drivers = [...byDriver.values()].sort((a, b) => b.total - a.total);
		const typeKeys = [...typeMeta.keys()].sort(
			(a, b) => (typeTotals.get(b) ?? 0) - (typeTotals.get(a) ?? 0)
		);

		const labels = drivers.map((d) => d.label);
		const typeLabels = typeKeys.map((k) => typeMeta.get(k) ?? k);
		const colorMap = assignDistinctCategoryColors(typeLabels, dark);
		const datasets = typeKeys.map((typeKey) => {
			const typeLabel = typeMeta.get(typeKey) ?? typeKey;
			const solid =
				colorMap.get(typeLabel) ?? getChartCategoryColor(typeLabel, 0, dark);
			const data = drivers.map((d) => d.types.get(typeKey) ?? 0);
			const total = typeTotals.get(typeKey) ?? data.reduce((sum, n) => sum + n, 0);
			return {
				label: typeLabel,
				/** Total incidents of this type across all drivers in range (legend). */
				total,
				data,
				backgroundColor: withAlpha(solid, 0.82),
				borderColor: solid,
				borderWidth: 1,
				borderRadius: DRIVER_BAR_RADIUS_PX,
				borderSkipped: false,
				stack: 'types',
				/** Fixed bar height (px) — not proportional to driver count. */
				barThickness: DRIVER_BAR_THICKNESS_PX,
				maxBarThickness: DRIVER_BAR_THICKNESS_PX
			};
		});

		return {
			labels,
			datasets,
			/** Active time window for legends / a11y */
			periodLabel: timeRangeLabel,
			/** For accessible table / HTML legend */
			typeLabels: typeKeys.map((k) => typeMeta.get(k) ?? k),
			driverRows: drivers.map((d) => ({
				label: d.label,
				total: d.total,
				byType: typeKeys.map((k) => d.types.get(k) ?? 0)
			}))
		};
	});

	const hasDriverData = $derived(driverStackedBarData.labels.length > 0);

	/** Plot height so each driver category has a fixed 20px bar + gap. */
	const driverChartPlotHeightPx = $derived(
		driverChartHeightForCount(driverStackedBarData.labels.length)
	);

	// Drop legend filters for series that no longer exist after period/data change
	$effect(() => {
		const typeLabels = new Set(typeOverTimeChartData.datasets.map((d) => d.label));
		const next = dashboardUi.hiddenTypeOverTimeLabels.filter((l) => typeLabels.has(l));
		if (
			next.length !== dashboardUi.hiddenTypeOverTimeLabels.length ||
			next.some((l, i) => l !== dashboardUi.hiddenTypeOverTimeLabels[i])
		) {
			dashboardUi.hiddenTypeOverTimeLabels = next;
		}
	});

	$effect(() => {
		const typeLabels = new Set(driverStackedBarData.datasets.map((d) => d.label));
		const next = dashboardUi.hiddenDriverTypeLabels.filter((l) => typeLabels.has(l));
		if (
			next.length !== dashboardUi.hiddenDriverTypeLabels.length ||
			next.some((l, i) => l !== dashboardUi.hiddenDriverTypeLabels[i])
		) {
			dashboardUi.hiddenDriverTypeLabels = next;
		}
	});

	const driverChartAriaLabel = $derived.by(() => {
		const { labels, datasets } = driverStackedBarData;
		if (labels.length === 0) {
			return `Incidents by Driver (${timeRangeLabel}): no incident data available`;
		}
		const typeNames = datasets.map((d) => d.label).slice(0, 6).join(', ');
		const more =
			datasets.length > 6 ? `, plus ${datasets.length - 6} more types` : '';
		return `Incidents by driver (${timeRangeLabel}), stacked by type. ${labels.length} drivers. Types: ${typeNames}${more}.`;
	});

	/** Short month header, e.g. "Mar 2026" */
	function formatMonthShortLabel(ym: string): string {
		const m = /^(\d{4})-(\d{2})$/.exec(ym);
		if (!m) return ym;
		const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1);
		if (Number.isNaN(d.getTime())) return ym;
		return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
	}

	/**
	 * Pivot: each driver × calendar month count within the selected time window.
	 * Same `timeRange` filter as over-time / driver charts.
	 */
	const driverMonthTally = $derived.by(() => {
		const range = timeRange;
		type DriverRow = {
			key: string;
			label: string;
			byMonth: Map<string, number>;
			total: number;
		};
		const byDriver = new Map<string, DriverRow>();
		const monthSet = new Set<string>();

		for (const incident of dashboardIncidents) {
			if (!isDateReceivedInTimeRange(incident.dateReceived, range)) continue;
			const dateKey = dateReceivedKey(incident.dateReceived);
			if (!dateKey) continue;
			const ym = dateKey.slice(0, 7);
			monthSet.add(ym);

			const d = normalizeAggregationKey(incident.driver, 'Unassigned');
			let row = byDriver.get(d.key);
			if (!row) {
				row = { key: d.key, label: d.label, byMonth: new Map(), total: 0 };
				byDriver.set(d.key, row);
			}
			row.byMonth.set(ym, (row.byMonth.get(ym) ?? 0) + 1);
			row.total += 1;
		}

		// Chronological month columns (oldest → newest)
		const months = [...monthSet].sort((a, b) => a.localeCompare(b));
		// Drivers by total desc, then name
		const drivers = [...byDriver.values()].sort((a, b) => {
			if (b.total !== a.total) return b.total - a.total;
			return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
		});

		const monthTotals = months.map((ym) =>
			drivers.reduce((sum, row) => sum + (row.byMonth.get(ym) ?? 0), 0)
		);
		const grandTotal = drivers.reduce((sum, row) => sum + row.total, 0);

		return {
			periodLabel: timeRangeLabel,
			months,
			monthLabels: months.map(formatMonthShortLabel),
			monthTotals,
			grandTotal,
			rows: drivers.map((row) => ({
				key: row.key,
				label: row.label,
				total: row.total,
				counts: months.map((ym) => row.byMonth.get(ym) ?? 0)
			}))
		};
	});

	const hasDriverMonthTally = $derived(driverMonthTally.rows.length > 0);
	/** Row/footer Total column only when the view spans more than one month. */
	const showDriverMonthTotals = $derived(driverMonthTally.months.length > 1);

	const driverMonthTallyAriaLabel = $derived.by(() => {
		const { rows, months, grandTotal, periodLabel } = driverMonthTally;
		if (rows.length === 0) {
			return `Driver incidents by month (${periodLabel}): no incident data available`;
		}
		return `Driver incidents by month for ${periodLabel}. ${rows.length} drivers, ${months.length} months, ${grandTotal} total incidents.`;
	});

	/**
	 * Line chart datasets: one series per driver × calendar month
	 * (same pivot as the table). X-axis uses over-time month tick + year under-label style.
	 * Visibility (top 10 default) is applied via Chart.js `hidden` + the dropdown.
	 */
	const driverMonthLineData = $derived.by(() => {
		const tally = driverMonthTally;
		const dark = theme.isDark;
		const bucket: OverTimeBucket = 'month';
		const colorMap = assignDistinctCategoryColors(
			tally.rows.map((r) => r.label),
			dark
		);
		return {
			// Primary ticks = short month (en-AU), same as Incidents Over Time month view
			labels: tally.months.map((ym) => overTimeTickLabel(ym, bucket)),
			bucketKeys: tally.months,
			bucket,
			periodLabel: tally.periodLabel,
			datasets: tally.rows.map((row) => {
				const color =
					colorMap.get(row.label) ?? getChartCategoryColor(row.label, 0, dark);
				return {
					label: row.label,
					driverKey: row.key,
					total: row.total,
					data: row.counts,
					borderColor: color,
					backgroundColor: withAlpha(color, 0.06),
					pointBackgroundColor: color,
					borderWidth: 2.5,
					fill: false,
					tension: 0.35,
					pointRadius: LINE_CHART_POINTS.radius,
					pointBorderWidth: 2,
					pointHoverRadius: LINE_CHART_POINTS.hoverRadius
				};
			})
		};
	});

	/** How many driver series are currently shown on the line chart. */
	const driverMonthVisibleCount = $derived.by(() => {
		const labels = driverMonthTally.rows.map((r) => r.label);
		const hidden = new Set(driverMonthHiddenLabels);
		return labels.filter((l) => !hidden.has(l)).length;
	});

	/** Colour swatch map for the driver picker (stable with chart series). */
	const driverMonthColorByLabel = $derived.by(() => {
		return assignDistinctCategoryColors(
			driverMonthTally.rows.map((r) => r.label),
			theme.isDark
		);
	});

	// Default visibility = top N by volume; re-apply when period/driver set changes
	// until the user customises via the dropdown.
	$effect(() => {
		const rows = driverMonthTally.rows;
		const key = `${timeRange}|${rows.map((r) => `${r.key}:${r.total}`).join(',')}`;
		if (key !== driverMonthVisibilitySourceKey) {
			driverMonthVisibilitySourceKey = key;
			driverMonthVisibilityTouched = false;
		}
		if (driverMonthVisibilityTouched) return;
		const next = driverMonthTopNHidden(
			rows.map((r) => r.label),
			DRIVER_MONTH_TOP_N
		);
		if (
			next.length !== driverMonthHiddenLabels.length ||
			next.some((l, i) => l !== driverMonthHiddenLabels[i])
		) {
			driverMonthHiddenLabels = next;
		}
	});

	// Keep drill-down + axis-chrome mirrors aligned with chart categories
	$effect(() => {
		const data = driverMonthLineData;
		driverMonthChartBucketKeys = data.bucketKeys;
		driverMonthChartBucket = data.bucket;
		driverMonthChartDriverKeys = data.datasets.map((d) => d.driverKey);
		driverMonthChartDriverLabels = data.datasets.map((d) => d.label);
	});

	// Close driver picker on outside click / Escape
	$effect(() => {
		if (!driverMonthPickerOpen) return;
		const onPointer = (e: PointerEvent) => {
			const t = e.target;
			if (!(t instanceof Element)) return;
			if (t.closest('[data-driver-month-picker]')) return;
			driverMonthPickerOpen = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				driverMonthPickerOpen = false;
			}
		};
		// Defer so the opening click does not immediately close
		const id = window.setTimeout(() => {
			window.addEventListener('pointerdown', onPointer, true);
			window.addEventListener('keydown', onKey, true);
		}, 0);
		return () => {
			window.clearTimeout(id);
			window.removeEventListener('pointerdown', onPointer, true);
			window.removeEventListener('keydown', onKey, true);
		};
	});

	// Close resolution-status picker on outside click / Escape
	$effect(() => {
		if (!actionStatusPickerOpen) return;
		const onPointer = (e: PointerEvent) => {
			const t = e.target;
			if (!(t instanceof Element)) return;
			if (t.closest('[data-action-status-picker]')) return;
			actionStatusPickerOpen = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				actionStatusPickerOpen = false;
			}
		};
		const id = window.setTimeout(() => {
			window.addEventListener('pointerdown', onPointer, true);
			window.addEventListener('keydown', onKey, true);
		}, 0);
		return () => {
			window.clearTimeout(id);
			window.removeEventListener('pointerdown', onPointer, true);
			window.removeEventListener('keydown', onKey, true);
		};
	});

	/**
	 * Drill-down: incidents for one driver × time bucket.
	 * `periodKey` is YYYY-MM-DD | YYYY-MM | YYYY (chart) or YYYY-MM (table cell).
	 */
	type DriverMonthDetail = {
		driverKey: string;
		driverLabel: string;
		periodKey: string;
	};
	let driverMonthDetail = $state<DriverMonthDetail | null>(null);

	function openDriverMonthDetail(
		driverKey: string,
		driverLabel: string,
		periodKey: string | undefined,
		count: number
	) {
		if (count <= 0 || !periodKey) return;
		driverMonthDetail = { driverKey, driverLabel, periodKey };
	}

	/** Match dateReceived to a day / month / year period key. */
	function dateMatchesDriverPeriodKey(dateKey: string, periodKey: string): boolean {
		if (/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return dateKey === periodKey;
		if (/^\d{4}-\d{2}$/.test(periodKey)) return dateKey.slice(0, 7) === periodKey;
		if (/^\d{4}$/.test(periodKey)) return dateKey.slice(0, 4) === periodKey;
		return false;
	}

	function driverPeriodKeyLabel(periodKey: string): string {
		if (/^\d{4}-\d{2}-\d{2}$/.test(periodKey)) return formatDate(periodKey);
		if (/^\d{4}-\d{2}$/.test(periodKey)) return formatMonthYearLabel(periodKey);
		return periodKey;
	}

	function closeDriverMonthDetail() {
		driverMonthDetail = null;
	}

	function handleDriverMonthDetailBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) closeDriverMonthDetail();
	}

	// Escape must listen on window — the overlay is not focused after open.
	$effect(() => {
		if (!driverMonthDetail) return;
		const onKeydown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			closeDriverMonthDetail();
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	/** Same filters as the driver line/table selection for the selected cell. */
	const driverMonthDetailIncidents = $derived.by(() => {
		const sel = driverMonthDetail;
		if (!sel) return [] as Incident[];
		const range = timeRange;
		const list: Incident[] = [];
		for (const incident of dashboardIncidents) {
			if (!isDateReceivedInTimeRange(incident.dateReceived, range)) continue;
			const d = normalizeAggregationKey(incident.driver, 'Unassigned');
			if (d.key !== sel.driverKey) continue;
			const dateKey = dateReceivedKey(incident.dateReceived);
			if (!dateKey || !dateMatchesDriverPeriodKey(dateKey, sel.periodKey)) continue;
			list.push(incident);
		}
		// Newest date/time received first (match main incidents list)
		list.sort((a, b) =>
			`${b.dateReceived}T${b.time ?? ''}`.localeCompare(`${a.dateReceived}T${a.time ?? ''}`)
		);
		return list;
	});

	const driverMonthDetailTitle = $derived.by(() => {
		const sel = driverMonthDetail;
		if (!sel) return '';
		return `${sel.driverLabel} · ${driverPeriodKeyLabel(sel.periodKey)}`;
	});

	// Persist scroll when leaving dashboard (drill-down, nav links, etc.)
	beforeNavigate(({ from, to }) => {
		const fromDash = from?.url.pathname === '/dashboard' || from?.url.pathname === '/dashboard/';
		const toDash = to?.url.pathname === '/dashboard' || to?.url.pathname === '/dashboard/';
		if (fromDash && !toDash) {
			dashboardUi.captureScroll();
		}
	});

	// Restore scroll only after data is ready — restoring too early jumps into empty space
	// and the page looks blank for a long time while charts/map still mounting.
	let scrollRestorePending = $state(false);
	onMount(() => {
		scrollRestorePending = dashboardUi.consumeScrollRestore();
		resizeHandler = () => {
			chartInstance?.resize();
			typeOverTimeChart?.resize();
			actionStatusChart?.resize();
			driverChart?.resize();
			teamLeaderChart?.resize();
		};
		window.addEventListener('resize', resizeHandler);

		return () => {
			if (resizeHandler) {
				window.removeEventListener('resize', resizeHandler);
				resizeHandler = undefined;
			}
		};
	});

	$effect(() => {
		if (!scrollRestorePending) return;
		if (incidentStore.isLoading || data.loadError || incidentStore.error) return;
		scrollRestorePending = false;
		dashboardUi.restoreScroll();
	});

	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		const canvas = canvasElement;
		if (!canvas) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => chartData);
		let cancelled = false;
		let instance: ChartJS<'line'> | undefined;

		void ensureChartJs().then((Chart) => {
			if (cancelled || !Chart || !canvas.isConnected) return;
			instance = new Chart(canvas, {
				type: 'line',
				data: initialData,
				options: buildChartOptions(colors, initialData.labels),
				// Local only — month labels + dividers (not global register)
				plugins: [overTimeAxisChromePlugin, pairedLinePulsePlugin]
			});
			applyChartTheme(instance);
			untrack(() => {
				chartInstance = instance;
			});
			queueMicrotask(() => {
				if (cancelled) return;
				instance?.resize();
				instance?.update('none');
			});
		});

		return () => {
			cancelled = true;
			instance?.destroy();
			chartInstance = undefined;
		};
	});

	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		const canvas = typeOverTimeCanvas;
		if (!canvas || !hasTypeOverTimeData) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => {
			const hidden = dashboardUi.hiddenTypeOverTimeLabels;
			return {
				labels: typeOverTimeChartData.labels,
				datasets: typeOverTimeChartData.datasets.map((ds) => ({
					...ds,
					hidden: hidden.includes(ds.label)
				}))
			};
		});
		let cancelled = false;
		let instance: ChartJS<'line'> | undefined;

		void ensureChartJs().then((Chart) => {
			if (cancelled || !Chart || !canvas.isConnected) return;
			instance = new Chart(canvas, {
				type: 'line',
				data: initialData,
				options: buildTypeOverTimeChartOptions(colors)
			});
			applyTypeOverTimeChartTheme(instance);
			typeOverTimeChart = instance;
		});

		return () => {
			cancelled = true;
			instance?.destroy();
			typeOverTimeChart = undefined;
		};
	});

	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		const canvas = actionStatusCanvas;
		if (!canvas || !hasActionStatusData) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => actionStatusBarData);
		let cancelled = false;
		let instance: ChartJS<'bar'> | undefined;

		void ensureChartJs().then((Chart) => {
			if (cancelled || !Chart || !canvas.isConnected) return;
			instance = new Chart(canvas, {
				type: 'bar',
				data: initialData,
				options: buildActionStatusBarOptions(colors)
			});
			applyActionStatusBarTheme(instance);
			actionStatusChart = instance;
		});

		return () => {
			cancelled = true;
			instance?.destroy();
			actionStatusChart = undefined;
		};
	});

	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		const canvas = driverCanvas;
		if (!canvas || !hasDriverData) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => {
			const hidden = dashboardUi.hiddenDriverTypeLabels;
			return {
				labels: driverStackedBarData.labels,
				datasets: driverStackedBarData.datasets.map((ds) => ({
					...ds,
					hidden: hidden.includes(ds.label)
				}))
			};
		});
		let cancelled = false;
		let instance: ChartJS<'bar'> | undefined;

		void ensureChartJs().then((Chart) => {
			if (cancelled || !Chart || !canvas.isConnected) return;
			instance = new Chart(canvas, {
				type: 'bar',
				data: initialData,
				options: buildDriverBarOptions(colors)
			});
			applyDriverBarTheme(instance);
			driverChart = instance;
		});

		return () => {
			cancelled = true;
			instance?.destroy();
			driverChart = undefined;
		};
	});

	$effect(() => {
		const instance = chartInstance;
		if (!instance?.data.datasets[0]) return;
		const bucket = dashboardUi.overTimeBucket;
		instance.data.labels = chartData.labels;
		instance.data.datasets[0].data = chartData.datasets[0].data;
		// Bottom pad + tick padding so month ticks and year under-labels do not clip
		if (instance.options.layout) {
			const prev = instance.options.layout.padding;
			const pad =
				typeof prev === 'object' && prev !== null
					? { ...prev, bottom: overTimeAxisBottomPad(bucket) }
					: { top: 14, right: 6, left: 2, bottom: overTimeAxisBottomPad(bucket) };
			instance.options.layout.padding = pad;
		}
		if (instance.options.scales?.x?.ticks) {
			instance.options.scales.x.ticks.padding = overTimeTickPadding(bucket);
		}
		applyLineChartPoints(instance);
		instance.update('none');
	});

	// Data / hide-filter updates (not legend hover — that is a separate recolour)
	$effect(() => {
		const instance = typeOverTimeChart;
		if (!instance) return;
		const next = typeOverTimeChartData;
		const hidden = dashboardUi.hiddenTypeOverTimeLabels;
		instance.data.labels = next.labels;
		// Rebuild datasets so type set can grow/shrink; honour legend filter
		instance.data.datasets = next.datasets.map((ds) => ({
			...ds,
			hidden: hidden.includes(ds.label)
		}));
		// Apply current hover focus without depending on it here (untracked read)
		applyTypeOverTimeChartTheme(
			instance,
			untrack(() => hoveredTypeOverTimeLabel)
		);
	});

	// Legend hover: recolour lines only (avoid dataset array replace, which can
	// leave multi-series line strokes on their previous colours).
	$effect(() => {
		const instance = typeOverTimeChart;
		const focus = hoveredTypeOverTimeLabel;
		if (!instance) return;
		applyTypeOverTimeSeriesFocus(instance, focus);
		instance.update('none');
	});

	$effect(() => {
		const instance = actionStatusChart;
		const dataset = instance?.data.datasets[0];
		if (!instance || !dataset) return;
		instance.data.labels = actionStatusBarData.labels;
		dataset.data = actionStatusBarData.datasets[0].data;
		applyActionStatusBarTheme(instance);
		instance.update('none');
	});

	// Driver stacked bar: rebuild + theme on data/hide/hover together.
	// Tracking hover here (not untracked) is what made dimming work previously —
	// stacked bars need a fresh dataset array + applyDriverBarTheme on each focus change.
	$effect(() => {
		const instance = driverChart;
		if (!instance) return;
		const next = driverStackedBarData;
		const hidden = dashboardUi.hiddenDriverTypeLabels;
		const focus = hoveredDriverTypeLabel;
		// Depend on plot height so Chart.js reflows when driver count changes.
		void driverChartPlotHeightPx;
		instance.data.labels = next.labels;
		instance.data.datasets = next.datasets.map((ds) => ({
			...ds,
			hidden: hidden.includes(ds.label)
		}));
		applyDriverBarTheme(instance, focus);
		// Resize after DOM height update so fixed barThickness layouts correctly.
		queueMicrotask(() => {
			instance.resize();
			instance.update('none');
		});
	});

	// Team-leader stacked bar — same lifecycle as driver chart (no read/write of
	// teamLeaderChart inside create path that would re-trigger the effect).
	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		if (dashboardUi.teamLeaderView !== 'chart') return;
		const canvas = teamLeaderCanvas;
		if (!canvas || !hasTeamLeaderChartData) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => teamLeaderBarData);
		let cancelled = false;
		let instance: ChartJS<'bar'> | undefined;

		void ensureChartJs().then((Chart) => {
			if (cancelled || !Chart || !canvas.isConnected) return;
			instance = new Chart(canvas, {
				type: 'bar',
				data: {
					labels: initialData.labels,
					datasets: initialData.datasets.map((ds) => ({ ...ds }))
				},
				options: buildTeamLeaderBarOptions(colors)
			});
			applyTeamLeaderBarTheme(instance);
			// untrack: assigning $state must not re-subscribe this create effect
			untrack(() => {
				teamLeaderChart = instance;
			});
			queueMicrotask(() => {
				if (cancelled) return;
				instance?.resize();
				instance?.update('none');
			});
		});

		return () => {
			cancelled = true;
			instance?.destroy();
			untrack(() => {
				if (teamLeaderChart === instance) teamLeaderChart = undefined;
			});
		};
	});

	// Tear down chart when switching to Table view
	$effect(() => {
		if (dashboardUi.teamLeaderView === 'chart') return;
		untrack(() => {
			const chart = teamLeaderChart;
			if (!chart) return;
			chart.destroy();
			teamLeaderChart = undefined;
		});
	});

	$effect(() => {
		const instance = teamLeaderChart;
		if (!instance || dashboardUi.teamLeaderView !== 'chart') return;
		const next = teamLeaderBarData;
		void teamLeaderChartHeightPx;
		instance.data.labels = next.labels;
		instance.data.datasets = next.datasets.map((ds) => ({ ...ds }));
		applyTeamLeaderBarTheme(instance);
		queueMicrotask(() => {
			instance.resize();
			instance.update('none');
		});
	});

	// Driver×month multi-series line chart (create only in Chart view)
	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		if (dashboardUi.driverMonthView !== 'chart') return;
		const canvas = driverMonthCanvas;
		if (!canvas || !hasDriverMonthTally) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => {
			const hidden = driverMonthHiddenLabels;
			const next = driverMonthLineData;
			return {
				labels: next.labels,
				datasets: next.datasets.map((ds) => ({
					label: ds.label,
					data: ds.data,
					borderColor: ds.borderColor,
					backgroundColor: ds.backgroundColor,
					pointBackgroundColor: ds.pointBackgroundColor,
					borderWidth: ds.borderWidth,
					fill: ds.fill,
					tension: ds.tension,
					pointRadius: ds.pointRadius,
					pointBorderWidth: ds.pointBorderWidth,
					pointHoverRadius: ds.pointHoverRadius,
					hidden: hidden.includes(ds.label)
				}))
			};
		});
		let cancelled = false;
		let instance: ChartJS<'line'> | undefined;

		void ensureChartJs().then((Chart) => {
			if (cancelled || !Chart || !canvas.isConnected) return;
			instance = new Chart(canvas, {
				type: 'line',
				data: initialData,
				options: buildDriverMonthLineOptions(colors, initialData.labels),
				// Same day/month outer-group labels as Incidents Over Time
				plugins: [
					driverMonthAxisChromePlugin,
					pairedLinePulsePlugin,
					driverMonthTieAnnotatePlugin
				]
			});
			applyDriverMonthLineTheme(instance);
			untrack(() => {
				driverMonthChart = instance;
			});
			queueMicrotask(() => {
				if (cancelled) return;
				instance?.resize();
				instance?.update('none');
			});
		});

		return () => {
			cancelled = true;
			instance?.destroy();
			untrack(() => {
				if (driverMonthChart === instance) driverMonthChart = undefined;
			});
		};
	});

	// Tear down driver×month chart when switching to Table view
	$effect(() => {
		if (dashboardUi.driverMonthView === 'chart') return;
		driverMonthPickerOpen = false;
		hoveredDriverMonthLabel = null;
		untrack(() => {
			const chart = driverMonthChart;
			if (!chart) return;
			chart.destroy();
			driverMonthChart = undefined;
		});
	});

	// Update driver×month line data + visibility without recreating the chart
	$effect(() => {
		const instance = driverMonthChart;
		if (!instance || dashboardUi.driverMonthView !== 'chart') return;
		const next = driverMonthLineData;
		const hidden = driverMonthHiddenLabels;
		instance.data.labels = next.labels;
		instance.data.datasets = next.datasets.map((ds) => ({
			label: ds.label,
			data: ds.data,
			borderColor: ds.borderColor,
			backgroundColor: ds.backgroundColor,
			pointBackgroundColor: ds.pointBackgroundColor,
			borderWidth: ds.borderWidth,
			fill: ds.fill,
			tension: ds.tension,
			pointRadius: ds.pointRadius,
			pointBorderWidth: ds.pointBorderWidth,
			pointHoverRadius: ds.pointHoverRadius,
			hidden: hidden.includes(ds.label)
		}));
		applyDriverMonthLineTheme(
			instance,
			untrack(() => (showDriverMonthTotals ? hoveredDriverMonthLabel : null))
		);
		queueMicrotask(() => {
			instance.resize();
			instance.update('none');
		});
	});

	// Multi-month only: legend hover greys other driver lines (same idea as type-over-time)
	$effect(() => {
		const instance = driverMonthChart;
		if (!instance || dashboardUi.driverMonthView !== 'chart') return;
		const focus = showDriverMonthTotals ? hoveredDriverMonthLabel : null;
		applyDriverMonthSeriesFocus(instance, focus);
		instance.update('none');
	});

	$effect(() => {
		theme.isDark;
		if (chartInstance) {
			applyChartTheme(chartInstance);
		}
		if (typeOverTimeChart) {
			applyTypeOverTimeChartTheme(
				typeOverTimeChart,
				untrack(() => hoveredTypeOverTimeLabel)
			);
		}
		if (actionStatusChart) {
			applyActionStatusBarTheme(actionStatusChart);
		}
		if (teamLeaderChart) {
			applyTeamLeaderBarTheme(teamLeaderChart);
		}
		if (driverMonthChart) {
			applyDriverMonthLineTheme(
				driverMonthChart,
				untrack(() => (showDriverMonthTotals ? hoveredDriverMonthLabel : null))
			);
		}
		// Hover is applied by the driver data effect above; only re-theme on dark toggle
		if (driverChart) {
			applyDriverBarTheme(
				driverChart,
				untrack(() => hoveredDriverTypeLabel)
			);
		}
	});

	// Summary stats honour the selected period (header time picker)
	const totalIncidents = $derived(periodIncidents.length);

	/**
	 * Unresolved = resolution status is "Ongoing" or "New".
	 * Resolved = every other resolution status (LIT, LPO, Resolved, Ack, AP staff, etc.).
	 */
	function isIncidentUnresolved(incident: Incident): boolean {
		const actionStatus = (incident.action ?? '').trim().toUpperCase();
		return actionStatus === 'ONGOING' || actionStatus === 'NEW';
	}

	const unresolvedIncidents = $derived(periodIncidents.filter(isIncidentUnresolved).length);
	const resolvedIncidents = $derived(totalIncidents - unresolvedIncidents);
	const resolvedPct = $derived(
		totalIncidents > 0 ? Math.round((resolvedIncidents / totalIncidents) * 100) : 0
	);
	const unresolvedPct = $derived(
		totalIncidents > 0 ? Math.round((unresolvedIncidents / totalIncidents) * 100) : 0
	);
</script>

<svelte:head>
	<title>Dashboard | Incident Tracker</title>
</svelte:head>

<div class="flex flex-1 flex-col overflow-hidden bg-warm-50 text-warm-900">
	<div
		id="dashboard-pdf-root"
		class="scroll-touch flex min-h-0 flex-1 flex-col overflow-auto bg-warm-50"
	>
	<header
		class="page-app-header flex-shrink-0 border-b border-warm-200 bg-white/80 px-3 py-3 backdrop-blur sm:px-4"
	>
		<!-- Period sits immediately to the right of the title block (not page right-aligned) -->
		<div
			class="page-app-header__inner flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-5"
		>
			<div class="flex min-w-0 items-start gap-2">
				<CourierTruckIcon />
				<div class="page-app-header__text min-w-0">
					<h1 class="text-lg font-bold text-warm-800 sm:text-xl">Dashboard</h1>
					<p class="page-app-header__sub mt-0.5 text-sm text-warm-500">
						Overview of incident tracking metrics
					</p>
				</div>
			</div>
			{#if !data.loadError && !incidentStore.isLoading && !incidentStore.error}
				<span
					class="hidden h-9 w-px shrink-0 self-center bg-warm-300/70 dark:bg-warm-400/50 sm:block"
					aria-hidden="true"
				></span>
				<div class="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
					<label class="flex min-w-0 items-center gap-2 text-[0.9625rem] text-warm-600">
						<span class="shrink-0 font-medium text-warm-700">Period</span>
						<select
							value={timeRange}
							onchange={onPeriodSelectChange}
							class="touch-target-inline max-w-[min(17.6rem,100%)] rounded-lg border border-warm-200 bg-white px-3 py-2.5 text-[0.9625rem] text-warm-700 shadow-sm input-focus dark:bg-warm-200"
							aria-controls="over-time-chart-canvas"
							aria-label="Time period for dashboard summary and charts"
							title="Relative period or a calendar month (current month is the default)"
						>
							<optgroup label="Relative">
								{#each TIME_RANGE_OPTIONS as opt (opt.value)}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</optgroup>
							<optgroup label="Months">
								{#each periodMonthOptions as m (m.value)}
									<option value={m.value}
										>{formatMonthYearLabel(m.ym)} ({m.count})</option
									>
								{/each}
							</optgroup>
							{#if isMonthTimeRange(timeRange) && !periodMonthOptions.some((m) => m.value === timeRange)}
								<option value={timeRange}
									>{formatMonthYearLabel(monthKeyFromRange(timeRange))} (0)</option
								>
							{/if}
						</select>
					</label>
					<span class="text-[18px] font-bold text-accent-600">{timeRangeLabel}</span>
					<span
						class="h-7 w-px shrink-0 self-center bg-warm-300/60 dark:bg-warm-400/40"
						aria-hidden="true"
					></span>
					<p
						class="max-w-xl text-[0.825rem] leading-snug text-warm-500"
						title="Dashboard charts, tables, and map exclude these rows"
					>
						Dashboard data ignores records with no reference number and duplicate records.
					</p>
					<button
						type="button"
						data-pdf-hide
						onclick={exportDashboardPdf}
						disabled={pdfExporting}
						title="Download the dashboard as a PDF"
						aria-label="Save dashboard as PDF"
						class="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-warm-200 bg-white px-3 py-1.5 text-sm font-medium text-warm-700 shadow-sm transition hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:cursor-wait disabled:opacity-60 dark:bg-warm-100 dark:hover:bg-warm-200"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4 shrink-0 text-warm-600"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							/>
						</svg>
						{pdfExporting ? 'Saving…' : 'Save PDF'}
					</button>
				</div>
			{/if}
		</div>
		{#if pdfExportError}
			<p class="mt-2 text-xs text-red-600" role="alert" data-pdf-hide>{pdfExportError}</p>
		{/if}
	</header>

	{#if data.loadError}
		<div class="rounded-lg border border-red-200 bg-red-50 p-8 text-center m-6">
			<p class="text-red-600 mb-2 font-medium">⚠️ Unable to load dashboard</p>
			<p class="text-red-600 mb-4 text-sm">{data.loadError}</p>
			{#if data.loadError.includes('migration')}
				<p class="text-sm text-warm-600 mb-4">
					Apply the listed SQL migration file in your Supabase project's SQL editor, then retry.
				</p>
			{/if}
			{#if retryError}
				<p class="text-sm text-red-600 mb-4">{retryError}</p>
			{/if}
			<button
				type="button"
				onclick={handleRetry}
				disabled={isRetrying}
				aria-label="Retry loading dashboard data"
				class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
			>
				{isRetrying ? 'Retrying...' : 'Try Again'}
			</button>
		</div>
	{:else if incidentStore.isLoading}
		<div class="flex items-center justify-center py-12">
			<div class="flex flex-col items-center">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-warm-600"></div>
				<p class="mt-3 text-sm text-warm-500">Loading dashboard data...</p>
			</div>
		</div>
	{:else if incidentStore.error}
		<div class="rounded-lg border border-red-200 bg-red-50 p-8 text-center m-6">
			<p class="text-red-600 mb-4">⚠️ {incidentStore.error}</p>
			{#if retryError}
				<p class="text-sm text-red-600 mb-4">{retryError}</p>
			{/if}
			<button
				type="button"
				onclick={handleRetry}
				disabled={isRetrying}
				aria-label="Retry loading dashboard data"
				class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
			>
				{isRetrying ? 'Retrying...' : 'Try Again'}
			</button>
		</div>
	{:else}
		<div class="w-full flex-1 px-2 py-3 sm:px-4">
			<div id="dashboard-pdf-page-1">
				<p class="pdf-capture-only mb-2 text-lg font-bold text-warm-800">
					JCH Incident Dashboard · {timeRangeLabel}
				</p>
				<!-- Summary row: KPIs + status chart (plot 6.5rem × 1.1 ≈ 7.15rem) -->
				<section
					class="dashboard-summary mb-2"
					aria-label="Incident summary for {timeRangeLabel}"
				>
					<div
						class="grid grid-cols-2 gap-1.5 lg:grid-cols-12 lg:items-stretch"
						role="group"
						aria-label="Period KPIs and resolution breakdown"
					>
						<!-- Total KPI — click → list for period -->
						<button
							type="button"
							class="flex cursor-pointer flex-col justify-between gap-1.5 rounded-md border border-warm-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-accent-400 hover:ring-2 hover:ring-accent-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-100 lg:col-span-2"
							aria-labelledby="total-incidents-title"
							aria-describedby="total-incidents-tip"
							title="View all incidents in this period"
							onclick={() => drillDownToIncidents({ drill: 'kpi-total' })}
						>
							<div class="min-w-0">
								<p
									id="total-incidents-title"
									class="text-[12.65px] font-semibold uppercase tracking-wide text-warm-500"
								>
									Total
								</p>
								<p
									class="mt-0.5 text-[2.156rem] font-bold leading-none tabular-nums text-accent-600"
								>
									{totalIncidents}
								</p>
								{#if totalIncidents > 0}
									<p class="mt-1 text-[12.65px] font-medium text-warm-600">
										<span class="font-semibold text-emerald-700 dark:text-emerald-300"
											>{resolvedPct}% resolved</span
										>
										<span class="text-warm-400"> · </span>
										<span class="truncate">{timeRangeLabel}</span>
									</p>
								{:else}
									<p class="mt-1 truncate text-[12.65px] text-warm-500">{timeRangeLabel}</p>
								{/if}
							</div>
							<div id="total-incidents-tip" class="min-w-0">
								{#if totalIncidents > 0}
									<div
										class="h-1.5 w-full overflow-hidden rounded-full bg-warm-100 dark:bg-warm-200"
										role="presentation"
										title="{resolvedPct}% of period is resolved (any status except Ongoing and New)"
									>
										<div
											class="h-full rounded-full bg-emerald-500/90"
											style="width: {resolvedPct}%"
										></div>
									</div>
								{/if}
								<p class="mt-1 text-[10px] leading-snug text-warm-500">
									Incidents in the selected period. Bar = share
									<span class="font-semibold text-warm-600">resolved</span>.
									<span class="text-accent-600"> Tap to open list.</span>
								</p>
							</div>
						</button>

						<!-- Unresolved — click → Ongoing or New -->
						<button
							type="button"
							class="flex cursor-pointer flex-col justify-between gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-left shadow-sm transition hover:border-amber-500 hover:ring-2 hover:ring-amber-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-600/50 dark:bg-amber-950/30 lg:col-span-2"
							aria-labelledby="unresolved-callout-title"
							aria-describedby="unresolved-callout-tip"
							title="View unresolved incidents (Ongoing or New)"
							onclick={() =>
								drillDownToIncidents({
									drill: 'kpi-unresolved',
									action: '__unresolved__'
								})}
						>
							<div class="min-w-0">
								<p
									id="unresolved-callout-title"
									class="text-[12.65px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200"
								>
									Unresolved
								</p>
								<p
									class="mt-0.5 text-[2.156rem] font-bold leading-none tabular-nums text-amber-900 dark:text-amber-100"
								>
									{unresolvedIncidents}
								</p>
								{#if totalIncidents > 0}
									<p class="mt-1 text-[12.65px] font-medium text-amber-800/90 dark:text-amber-200/90">
										{unresolvedPct}% of period
									</p>
								{/if}
							</div>
							<p
								id="unresolved-callout-tip"
								class="text-[10px] leading-snug text-amber-800/85 dark:text-amber-200/85"
							>
								Resolution status is <span class="font-semibold">Ongoing</span> or
								<span class="font-semibold">New</span>.
								<span class="font-medium"> Tap to open list.</span>
							</p>
						</button>

						<!-- Resolved — click → not Ongoing/New -->
						<button
							type="button"
							class="flex cursor-pointer flex-col justify-between gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-3 text-left shadow-sm transition hover:border-emerald-500 hover:ring-2 hover:ring-emerald-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-600/50 dark:bg-emerald-950/30 lg:col-span-2"
							aria-labelledby="resolved-callout-title"
							aria-describedby="resolved-callout-tip"
							title="View resolved incidents (not Ongoing or New)"
							onclick={() =>
								drillDownToIncidents({
									drill: 'kpi-resolved',
									action: '__resolved__'
								})}
						>
							<div class="min-w-0">
								<p
									id="resolved-callout-title"
									class="text-[12.65px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200"
								>
									Resolved
								</p>
								<p
									class="mt-0.5 text-[2.156rem] font-bold leading-none tabular-nums text-emerald-900 dark:text-emerald-100"
								>
									{resolvedIncidents}
								</p>
								{#if totalIncidents > 0}
									<p
										class="mt-1 text-[12.65px] font-medium text-emerald-800/90 dark:text-emerald-200/90"
									>
										{resolvedPct}% of period
									</p>
								{/if}
							</div>
							<p
								id="resolved-callout-tip"
								class="text-[10px] leading-snug text-emerald-800/85 dark:text-emerald-200/85"
							>
								Any resolution status except <span class="font-semibold">Ongoing</span> and
								<span class="font-semibold">New</span>.
								<span class="font-medium"> Tap to open list.</span>
							</p>
						</button>

						<!-- Resolution status chart (6.5rem + 10% ≈ 7.15rem) — click bar to drill -->
						<section
							class="col-span-2 flex min-h-0 flex-col rounded-md border border-warm-200 bg-white px-2.5 py-2 shadow-sm dark:bg-warm-100 lg:col-span-6"
							aria-labelledby="action-status-bar-title"
							aria-describedby="action-status-bar-summary"
						>
							<div class="mb-0.5 flex flex-wrap items-center justify-between gap-1">
								<div class="min-w-0">
									<h2 id="action-status-bar-title" class="dashboard-section-title">
										By Resolution Status
									</h2>
									<p class="text-[10px] text-warm-500">
										{timeRangeLabel} · click a bar to open list
									</p>
								</div>
								{#if hasActionStatusSourceData}
									<div class="relative shrink-0" data-action-status-picker>
										<button
											type="button"
											class="inline-flex max-w-[12rem] items-center gap-1 rounded-md border border-warm-200 bg-white px-2 py-1 text-[10px] font-semibold text-warm-700 shadow-sm transition hover:border-warm-300 hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-100"
											aria-haspopup="listbox"
											aria-expanded={actionStatusPickerOpen}
											aria-controls="action-status-picker-panel"
											onclick={() => {
												actionStatusPickerOpen = !actionStatusPickerOpen;
											}}
										>
											<span class="truncate"
												>Statuses · {actionStatusVisibleCount} of {actionStatusTotalCount}</span
											>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-3 w-3 shrink-0 text-warm-500 transition {actionStatusPickerOpen
													? 'rotate-180'
													: ''}"
												viewBox="0 0 20 20"
												fill="currentColor"
												aria-hidden="true"
											>
												<path
													fill-rule="evenodd"
													d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
													clip-rule="evenodd"
												/>
											</svg>
										</button>
										{#if actionStatusPickerOpen}
											<div
												id="action-status-picker-panel"
												class="absolute right-0 z-30 mt-1 w-[min(16rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-warm-200 bg-white shadow-lg dark:bg-warm-100"
												role="listbox"
												aria-multiselectable="true"
												aria-label="Show or hide resolution statuses on the chart"
											>
												<div
													class="flex flex-wrap items-center gap-1 border-b border-warm-200 bg-warm-50 px-2 py-1.5 dark:bg-warm-200"
												>
													<button
														type="button"
														class="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-warm-100"
														onclick={() => applyActionStatusDefaultVisibility()}
														title="Hide Unspecified; show all other statuses"
													>
														Default
													</button>
													<button
														type="button"
														class="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-warm-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-warm-100"
														onclick={() => applyActionStatusShowAll()}
													>
														All
													</button>
													<button
														type="button"
														class="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-warm-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-warm-100"
														onclick={() => applyActionStatusHideAll()}
													>
														None
													</button>
												</div>
												<ul class="max-h-48 overflow-y-auto py-1">
													{#each incidentsByActionStatus as [label, count] (label)}
														{@const checked = isLegendVisible(
															actionStatusHiddenLabels,
															label
														)}
														{@const swatch = isUnassignedCategory(label)
															? getUnassignedChartColor(theme.isDark)
															: getActionStatusChartColor(label, theme.isDark)}
														<li>
															<label
																class="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-xs text-warm-800 hover:bg-warm-50 dark:hover:bg-warm-200"
															>
																<input
																	type="checkbox"
																	class="h-3.5 w-3.5 shrink-0 rounded border-warm-300 text-accent-600 focus:ring-accent-500"
																	checked={checked}
																	onchange={(e) =>
																		onActionStatusCheckboxChange(label, e)}
																/>
																<span
																	class="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
																	style="background: {swatch}"
																	aria-hidden="true"
																></span>
																<span class="min-w-0 flex-1 truncate" title={label}
																	>{label}</span
																>
																<span
																	class="shrink-0 tabular-nums text-[10px] font-semibold text-warm-500"
																	>({count})</span
																>
															</label>
														</li>
													{/each}
												</ul>
											</div>
										{/if}
									</div>
								{/if}
							</div>
							<p id="action-status-bar-summary" class="sr-only">
								{actionStatusAriaLabel} Click a bar to view those incidents in the list.
							</p>
							<div
								class="w-full min-h-0 overflow-visible"
								style="position: relative; height: 7.15rem; min-height: 7.15rem;"
							>
								{#if !hasActionStatusSourceData}
									<div class="flex h-full items-center justify-center">
										<p class="text-[10px] text-warm-500">No resolution status data.</p>
									</div>
								{:else if !hasActionStatusData}
									<div class="flex h-full items-center justify-center">
										<p class="text-[10px] text-warm-500">
											No statuses selected — open Statuses to include series.
										</p>
									</div>
								{/if}
								<canvas
									bind:this={actionStatusCanvas}
									class={!hasActionStatusData ? 'hidden' : 'block h-full w-full'}
									style="max-height: 100%;"
									aria-hidden="true"
								></canvas>
								<table class="sr-only" aria-labelledby="action-status-bar-title">
									<thead>
										<tr>
											<th scope="col">Resolution status</th>
											<th scope="col">Incidents</th>
										</tr>
									</thead>
									<tbody>
										{#each visibleIncidentsByActionStatus as [label, count] (label)}
											<tr>
												<td>{label}</td>
												<td>{count}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</section>
					</div>
				</section>

				<hr
					class="mb-3 border-0 border-t border-warm-200/70 dark:border-warm-300/40"
					aria-hidden="true"
				/>

				<!-- Charts & tables (same period as header picker) -->
				<section class="dashboard-charts" aria-label="Incident charts">
				<!--
					Top row: Stats by Team Leader | Over Time.
					Type-over-time markup kept behind SHOW_TYPE_OVER_TIME_CHART for future use.
				-->
				<div
					class="dashboard-chart-row grid grid-cols-1 gap-2 md:grid-cols-2 md:items-stretch"
				>
					<!-- Left: Stats by Team Leader -->
					<section
						class="dashboard-chart-card dashboard-team-leader-stats-card min-w-0 overflow-hidden rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4 dark:bg-warm-100"
						aria-labelledby="stats-by-team-leader-title"
						aria-describedby="stats-by-team-leader-summary"
					>
						<div class="dashboard-chart-header">
							<div class="flex flex-wrap items-start justify-between gap-2">
								<div class="min-w-0">
									<h2 class="dashboard-section-title" id="stats-by-team-leader-title">
										Stats by Team Leader
									</h2>
									<p class="dashboard-chart-meta text-xs text-warm-500">
										{statsByTeamLeader.periodLabel} · Ongoing &amp; Resolved
										{#if dashboardUi.teamLeaderView === 'chart'}
											· click a segment to open list
										{/if}
									</p>
								</div>
								<div
									class="team-leader-view-toggle inline-flex shrink-0 rounded-md border border-warm-200 bg-warm-50 p-0.5 dark:bg-warm-200"
									role="group"
									aria-label="Show team leader stats as table or chart"
								>
									<button
										type="button"
										class="rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 {dashboardUi.teamLeaderView ===
										'table'
											? 'bg-white text-accent-700 shadow-sm dark:bg-warm-100 dark:text-accent-600'
											: 'text-warm-600 hover:text-warm-800'}"
										aria-pressed={dashboardUi.teamLeaderView === 'table'}
										onclick={() => {
											dashboardUi.teamLeaderView = 'table';
										}}
									>
										Table
									</button>
									<button
										type="button"
										class="rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 {dashboardUi.teamLeaderView ===
										'chart'
											? 'bg-white text-accent-700 shadow-sm dark:bg-warm-100 dark:text-accent-600'
											: 'text-warm-600 hover:text-warm-800'}"
										aria-pressed={dashboardUi.teamLeaderView === 'chart'}
										onclick={() => {
											dashboardUi.teamLeaderView = 'chart';
										}}
									>
										Chart
									</button>
								</div>
							</div>
						</div>
						<p id="stats-by-team-leader-summary" class="sr-only">{statsByTeamLeaderAriaLabel}</p>
						<div class="dashboard-chart-plot dashboard-team-leader-stats-plot relative flex min-h-0 w-full flex-col">
							{#if !hasStatsByTeamLeader}
								<div class="flex h-full flex-1 items-center justify-center">
									<p class="text-sm text-warm-500">
										No ongoing or resolved incidents in this period.
									</p>
								</div>
							{:else if dashboardUi.teamLeaderView === 'chart'}
								{#if !hasTeamLeaderChartData}
									<div class="flex h-full flex-1 items-center justify-center">
										<p class="text-sm text-warm-500">
											No assigned team leaders in this period.
											{#if statsByTeamLeader.unassignedTotal > 0}
												({statsByTeamLeader.unassignedTotal} unassigned — see table)
											{/if}
										</p>
									</div>
								{:else}
									{@const tlsColors = teamLeaderStatusColors(theme.isDark)}
									<ul
										class="mb-1.5 flex flex-wrap gap-x-3 gap-y-1"
										aria-label="Ongoing and Resolved series for team leader chart"
									>
										<li class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-warm-700">
											<span
												class="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
												style="background: {tlsColors.ongoing}"
												aria-hidden="true"
											></span>
											Ongoing
										</li>
										<li class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-warm-700">
											<span
												class="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
												style="background: {tlsColors.resolved}"
												aria-hidden="true"
											></span>
											Resolved
										</li>
									</ul>
									<div
										class="team-leader-chart-plot relative w-full min-h-0 overflow-hidden"
										style:height="{teamLeaderChartHeightPx}px"
										style:min-height="{teamLeaderChartHeightPx}px"
										style:max-height="{teamLeaderChartHeightPx}px"
										style:flex="0 0 {teamLeaderChartHeightPx}px"
									>
										<canvas
											bind:this={teamLeaderCanvas}
											class="block h-full w-full"
											aria-hidden="true"
										></canvas>
									</div>
									{#if statsByTeamLeader.unassignedTotal > 0}
										<p class="mt-1.5 text-[11px] text-warm-500">
											Unassigned (empty Responded By): {statsByTeamLeader.unassignedTotal} —
											switch to Table for the full breakdown.
										</p>
									{/if}
								{/if}
							{:else}
								<!--
									All totals live *outside* the scroll box. Sticky <tfoot> on iOS/iPad
									WebKit often keeps a composited stale layer when period/data changes
									(body updates, footer numbers do not). Desktop is fine either way;
									this structure is correct everywhere.
								-->
								<div
									class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-warm-200"
								>
									{#key `${timeRange}-${statsByTeamLeader.grandTotal}-${statsByTeamLeader.totalOngoing}-${statsByTeamLeader.totalResolved}-${statsByTeamLeader.unassignedTotal}-${statsByTeamLeader.rows.length}`}
										<div
											class="dashboard-team-leader-stats-scroll min-h-0 flex-1 overflow-auto"
										>
											<table
												class="tls-stats-table w-full min-w-[20rem] border-collapse text-left text-sm"
											>
												<colgroup>
													<col class="tls-col-leader" />
													<col class="tls-col-num" />
													<col class="tls-col-pct" />
													<col class="tls-col-num" />
													<col class="tls-col-pct" />
													<col class="tls-col-num" />
												</colgroup>
												<thead
													class="sticky top-0 z-10 border-b border-warm-200 bg-warm-50 dark:bg-warm-200"
												>
													<tr>
														<th
															scope="col"
															class="tls-th-tip px-2 py-2 text-xs font-semibold uppercase tracking-wide text-warm-600 sm:px-3"
															tabindex="0"
														>
															<span class="tls-th-label">Team Leader</span>
															<span class="tls-th-popup" role="tooltip">
																One row per <strong>Responded By</strong> dropdown value.
																Counts only incidents with that Responded By. New is not
																included in Ongoing, Resolved, or Total.
															</span>
														</th>
														<th
															scope="col"
															class="tls-th-tip tls-col-group-start px-1.5 py-2 text-center text-xs font-semibold uppercase tracking-wide text-warm-600 sm:px-2"
															tabindex="0"
														>
															<span class="tls-th-label">Ongoing</span>
															<span class="tls-th-popup" role="tooltip">
																<strong>Inclusion:</strong> resolution status is
																<strong>Ongoing</strong> only, for that Responded By
																value. Excludes New and all other statuses.
															</span>
														</th>
														<th
															scope="col"
															class="tls-col-group-end px-1.5 py-2 text-center text-xs font-semibold uppercase tracking-wide text-warm-600 sm:px-2"
															title="Ongoing as a share of this team leader’s total (Ongoing + Resolved)"
														>
															%
														</th>
														<th
															scope="col"
															class="tls-th-tip tls-col-group-start px-1.5 py-2 text-center text-xs font-semibold uppercase tracking-wide text-warm-600 sm:px-2"
															tabindex="0"
														>
															<span class="tls-th-label">Resolved</span>
															<span class="tls-th-popup" role="tooltip">
																<strong>Inclusion:</strong> resolution status is
																<strong>not Ongoing</strong> and
																<strong>not New</strong> (e.g. Resolved, LIT, LPO, Ack, AP
																staff, and other closed statuses), for that Responded By
																value.
															</span>
														</th>
														<th
															scope="col"
															class="tls-col-group-end px-1.5 py-2 text-center text-xs font-semibold uppercase tracking-wide text-warm-600 sm:px-2"
															title="Resolved as a share of this team leader’s total (Ongoing + Resolved)"
														>
															%
														</th>
														<th
															scope="col"
															class="tls-col-group-start px-1.5 py-2 text-center text-xs font-semibold uppercase tracking-wide text-warm-700 sm:px-2"
															title="Ongoing + Resolved for the row"
														>
															Total
														</th>
													</tr>
												</thead>
												<tbody class="divide-y divide-warm-100">
													{#each statsByTeamLeader.rows as row (row.key)}
														<tr class="dashboard-data-row">
															<th
																scope="row"
																class="px-2 py-1.5 font-medium text-warm-800 sm:px-3"
															>
																{row.label}
															</th>
															<td
																class="tls-col-group-start px-1.5 py-1.5 text-center tabular-nums font-semibold text-warm-900 sm:px-2"
															>
																{row.ongoing}
															</td>
															<td
																class="tls-col-group-end px-1.5 py-1.5 text-center tabular-nums text-warm-700 sm:px-2"
															>
																{row.ongoingPct.toFixed(1)}%
															</td>
															<td
																class="tls-col-group-start px-1.5 py-1.5 text-center tabular-nums font-semibold text-warm-900 sm:px-2"
															>
																{row.resolved}
															</td>
															<td
																class="tls-col-group-end px-1.5 py-1.5 text-center tabular-nums text-warm-700 sm:px-2"
															>
																{row.resolvedPct.toFixed(1)}%
															</td>
															<td
																class="tls-col-group-start px-1.5 py-1.5 text-center tabular-nums font-bold text-warm-900 sm:px-2"
															>
																{row.total}
															</td>
														</tr>
													{/each}
													{#if statsByTeamLeader.unassignedTotal > 0}
														<tr
															class="dashboard-data-row border-t border-warm-200 bg-warm-50/60 dark:bg-warm-200/30"
														>
															<th
																scope="row"
																class="px-2 py-1.5 font-medium italic text-warm-600 sm:px-3"
															>
																Unassigned
															</th>
															<td
																class="tls-col-group-start px-1.5 py-1.5 text-center tabular-nums text-warm-400 sm:px-2"
																aria-hidden="true"
															>
																—
															</td>
															<td
																class="tls-col-group-end px-1.5 py-1.5 text-center tabular-nums text-warm-400 sm:px-2"
																aria-hidden="true"
															>
																—
															</td>
															<td
																class="tls-col-group-start px-1.5 py-1.5 text-center tabular-nums text-warm-400 sm:px-2"
																aria-hidden="true"
															>
																—
															</td>
															<td
																class="tls-col-group-end px-1.5 py-1.5 text-center tabular-nums text-warm-400 sm:px-2"
																aria-hidden="true"
															>
																—
															</td>
															<td
																class="tls-col-group-start px-1.5 py-1.5 text-center tabular-nums font-bold text-warm-900 sm:px-2"
																title="All period incidents with empty Responded By (any status)"
															>
																{statsByTeamLeader.unassignedTotal}
															</td>
														</tr>
													{/if}
												</tbody>
											</table>
										</div>
										<!--
											All row: separate table (avoids sticky tfoot iPad repaint bugs).
											Same colgroup + table-layout as body so values line up with leader rows.
										-->
										<table
											class="tls-stats-table tls-stats-table--footer w-full min-w-[20rem] shrink-0 border-collapse border-t border-warm-200 bg-warm-50 text-left text-sm dark:bg-warm-200"
											aria-label="Stats by Team Leader totals for {statsByTeamLeader.periodLabel}"
										>
											<colgroup>
												<col class="tls-col-leader" />
												<col class="tls-col-num" />
												<col class="tls-col-pct" />
												<col class="tls-col-num" />
												<col class="tls-col-pct" />
												<col class="tls-col-num" />
											</colgroup>
											<tbody>
												<tr>
													<th
														scope="row"
														class="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-warm-700 sm:px-3"
													>
														All
													</th>
													<td
														class="tls-col-group-start px-1.5 py-1.5 text-center tabular-nums font-bold text-warm-900 sm:px-2"
													>
														{statsByTeamLeader.totalOngoing}
													</td>
													<td
														class="tls-col-group-end px-1.5 py-1.5 text-center tabular-nums text-warm-400 sm:px-2"
														aria-hidden="true"
													>
														—
													</td>
													<td
														class="tls-col-group-start px-1.5 py-1.5 text-center tabular-nums font-bold text-warm-900 sm:px-2"
													>
														{statsByTeamLeader.totalResolved}
													</td>
													<td
														class="tls-col-group-end px-1.5 py-1.5 text-center tabular-nums text-warm-400 sm:px-2"
														aria-hidden="true"
													>
														—
													</td>
													<td
														class="tls-col-group-start px-1.5 py-1.5 text-center tabular-nums font-bold text-warm-900 sm:px-2"
														title="Team leaders + Unassigned"
													>
														{statsByTeamLeader.grandTotal}
													</td>
												</tr>
											</tbody>
										</table>
									{/key}
								</div>
							{/if}
						</div>
						<div class="dashboard-chart-footer" aria-hidden="true"></div>
					</section>

					<!-- Right: Incidents Over Time -->
					<section
						class="dashboard-chart-card min-w-0 rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4"
						aria-labelledby="over-time-chart-title"
						aria-describedby="over-time-chart-summary"
					>
						<div class="dashboard-chart-header">
							<div class="flex flex-wrap items-start justify-between gap-2">
								<div class="min-w-0">
									<h2 class="dashboard-section-title" id="over-time-chart-title">
										Incidents Over Time
									</h2>
									<p class="dashboard-chart-meta text-xs text-warm-500">
										{timeRangeLabel} · by {dashboardUi.overTimeBucket} · click to open incidents
									</p>
								</div>
								<div
									class="over-time-bucket-toggle inline-flex shrink-0 rounded-md border border-warm-200 bg-warm-50 p-0.5 dark:bg-warm-200"
									role="group"
									aria-label="Aggregate incidents over time by day, month, or year"
								>
									{#each OVER_TIME_BUCKET_OPTIONS as opt (opt.value)}
										<button
											type="button"
											class="rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 {dashboardUi.overTimeBucket ===
											opt.value
												? 'bg-white text-accent-700 shadow-sm dark:bg-warm-100 dark:text-accent-600'
												: 'text-warm-600 hover:text-warm-800'}"
											aria-pressed={dashboardUi.overTimeBucket === opt.value}
											onclick={() => {
												dashboardUi.overTimeBucket = opt.value;
											}}
										>
											{opt.label}
										</button>
									{/each}
								</div>
							</div>
						</div>
						<p id="over-time-chart-summary" class="sr-only">
							Line chart of incident counts by {dashboardUi.overTimeBucket} for {timeRangeLabel}. Click a data
							point or axis label to open the incidents list for that {dashboardUi.overTimeBucket}.
						</p>
						<div class="dashboard-chart-plot relative w-full">
							{#if overTimeSeries.length === 0}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-warm-500">No incidents in this period.</p>
								</div>
							{/if}
							<canvas
								id="over-time-chart-canvas"
								bind:this={canvasElement}
								class={overTimeSeries.length === 0 ? 'hidden' : 'block h-full w-full'}
							></canvas>
						</div>
						<div class="dashboard-chart-footer" aria-hidden="true"></div>
					</section>

					{#if SHOW_TYPE_OVER_TIME_CHART}
					<!-- Kept for future: type-over-time chart (off by default) -->
					<section
						class="dashboard-chart-card min-w-0 rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4"
						aria-labelledby="type-over-time-chart-title"
						aria-describedby="type-over-time-chart-summary"
					>
						<div class="dashboard-chart-header">
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<h2 class="dashboard-section-title" id="type-over-time-chart-title">
									Incidents by Type Over Time
								</h2>
							</div>
							<p class="dashboard-chart-meta text-xs text-warm-500">{timeRangeLabel}</p>
						</div>
						<p id="type-over-time-chart-summary" class="sr-only">{typeOverTimeAriaLabel}</p>
						<div class="dashboard-chart-plot relative w-full">
							{#if !hasTypeOverTimeData}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-warm-500">No incident type data available.</p>
								</div>
							{/if}
							<canvas
								bind:this={typeOverTimeCanvas}
								class={!hasTypeOverTimeData ? 'hidden' : 'block h-full w-full'}
								aria-hidden="true"
							></canvas>
							<table class="sr-only" aria-labelledby="type-over-time-chart-title">
								<thead>
									<tr>
										<th scope="col">Incident type</th>
										{#each typeOverTimeChartData.labels as label, i (typeOverTimeChartData.dateKeys[i] ?? label)}
											<th scope="col">{label}</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each typeOverTimeChartData.tableRows as row (row.label)}
										<tr>
											<th scope="row">{row.label}</th>
											{#each row.counts as count, i (`${row.label}-${typeOverTimeChartData.dateKeys[i] ?? i}`)}
												<td>{count}</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<div class="dashboard-chart-footer">
							{#if hasTypeOverTimeData}
								<ul
									class="flex flex-wrap gap-x-1.5 gap-y-1"
									aria-label="Incident type legend for {typeOverTimeChartData.periodLabel}. Click to show or hide a series. Hover to highlight a series."
									onpointerleave={() => {
										hoveredTypeOverTimeLabel = null;
									}}
								>
									{#each typeOverTimeChartData.datasets as ds (`${ds.label}-${ds.total}-${timeRange}`)}
										{@const visible = isLegendVisible(dashboardUi.hiddenTypeOverTimeLabels, ds.label)}
										{@const focus = hoveredTypeOverTimeLabel}
										{@const dimLegend =
											visible && focus != null && focus !== ds.label}
										{@const activeLegend = visible && focus === ds.label}
										<li>
											<button
												type="button"
												class="dashboard-legend-btn flex max-w-full items-center gap-1 text-[12px] leading-tight text-warm-600 {visible
													? dimLegend
														? 'opacity-35'
														: activeLegend
															? 'bg-warm-100 text-warm-800 opacity-100 ring-1 ring-warm-300/80 dark:bg-warm-200'
															: ''
													: 'opacity-40 line-through'}"
												aria-pressed={visible}
												title={visible
													? `Hide ${ds.label} on chart`
													: `Show ${ds.label} on chart`}
												onpointerenter={() => {
													hoveredTypeOverTimeLabel = ds.label;
												}}
												onclick={() => toggleTypeOverTimeLegend(ds.label)}
											>
												<span
													class="inline-block h-2.5 w-2.5 shrink-0 rounded-full {dimLegend
														? 'opacity-50'
														: ''}"
													style="background: {typeof ds.borderColor === 'string'
														? ds.borderColor
														: '#666'}"
													aria-hidden="true"
												></span>
												<span class="truncate">{ds.label} ({ds.total})</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					</section>
					{/if}
				</div>
				</section>
			</div>

			<div id="dashboard-pdf-page-2">
				<!-- Driver table + bar chart side by side -->
				<div
					class="dashboard-driver-row mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 md:items-stretch"
				>
					<section
						class="dashboard-driver-table-card flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4 dark:bg-warm-100"
						aria-labelledby="driver-month-tally-title"
						aria-describedby="driver-month-tally-summary"
					>
						<div class="dashboard-driver-table-header mb-2 flex shrink-0 flex-wrap items-start justify-between gap-2">
							<div class="min-w-0">
								<h2 id="driver-month-tally-title" class="dashboard-section-title">
									Incidents by Driver per Month
								</h2>
								<p class="mt-0.5 text-xs text-warm-500">
									{driverMonthTally.periodLabel}
									{#if dashboardUi.driverMonthView === 'table'}
										· click a count to view those incidents
									{:else}
										· top {DRIVER_MONTH_TOP_N} by default · click a point for that driver × month
									{/if}
								</p>
							</div>
							<div class="flex shrink-0 flex-wrap items-center gap-2">
								{#if dashboardUi.driverMonthView === 'chart' && hasDriverMonthTally}
									<div class="relative" data-driver-month-picker>
										<button
											type="button"
											class="inline-flex max-w-[14rem] items-center gap-1.5 rounded-md border border-warm-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-warm-700 shadow-sm transition hover:border-warm-300 hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-100"
											aria-haspopup="listbox"
											aria-expanded={driverMonthPickerOpen}
											aria-controls="driver-month-picker-panel"
											onclick={() => {
												driverMonthPickerOpen = !driverMonthPickerOpen;
											}}
										>
											<span class="truncate"
												>Drivers · {driverMonthVisibleCount} of {driverMonthTally.rows
													.length}</span
											>
											<svg
												xmlns="http://www.w3.org/2000/svg"
												class="h-3.5 w-3.5 shrink-0 text-warm-500 transition {driverMonthPickerOpen
													? 'rotate-180'
													: ''}"
												viewBox="0 0 20 20"
												fill="currentColor"
												aria-hidden="true"
											>
												<path
													fill-rule="evenodd"
													d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
													clip-rule="evenodd"
												/>
											</svg>
										</button>
										{#if driverMonthPickerOpen}
											<div
												id="driver-month-picker-panel"
												class="absolute right-0 z-30 mt-1 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-warm-200 bg-white shadow-lg dark:bg-warm-100"
												role="listbox"
												aria-multiselectable="true"
												aria-label="Show or hide drivers on the line chart"
											>
												<div
													class="flex flex-wrap items-center gap-1 border-b border-warm-200 bg-warm-50 px-2 py-1.5 dark:bg-warm-200"
												>
													<button
														type="button"
														class="rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-warm-100"
														onclick={() =>
															applyDriverMonthTopNVisibility(DRIVER_MONTH_TOP_5)}
													>
														Top {DRIVER_MONTH_TOP_5}
													</button>
													<button
														type="button"
														class="rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-warm-100"
														onclick={() =>
															applyDriverMonthTopNVisibility(DRIVER_MONTH_TOP_N)}
													>
														Top {DRIVER_MONTH_TOP_N}
													</button>
													<button
														type="button"
														class="rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-warm-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-warm-100"
														onclick={() => applyDriverMonthShowAll()}
													>
														All
													</button>
													<button
														type="button"
														class="rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-warm-700 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-warm-100"
														onclick={() => applyDriverMonthHideAll()}
													>
														None
													</button>
												</div>
												<ul class="max-h-56 overflow-y-auto py-1">
													{#each driverMonthTally.rows as row (row.key)}
														{@const checked = isLegendVisible(
															driverMonthHiddenLabels,
															row.label
														)}
														{@const swatch =
															driverMonthColorByLabel.get(row.label) ??
															getChartCategoryColor(row.label, 0, theme.isDark)}
														<li>
															<label
																class="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm text-warm-800 hover:bg-warm-50 dark:hover:bg-warm-200"
															>
																<input
																	type="checkbox"
																	class="h-4 w-4 shrink-0 rounded border-warm-300 text-accent-600 focus:ring-accent-500"
																	checked={checked}
																	onchange={(e) =>
																		onDriverMonthCheckboxChange(row.label, e)}
																/>
																<span
																	class="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
																	style="background: {swatch}"
																	aria-hidden="true"
																></span>
																<span class="min-w-0 flex-1 truncate" title={row.label}
																	>{row.label}</span
																>
																<span
																	class="shrink-0 tabular-nums text-xs font-semibold text-warm-500"
																	>({row.total})</span
																>
															</label>
														</li>
													{/each}
												</ul>
											</div>
										{/if}
									</div>
								{/if}
								<div
									class="team-leader-view-toggle inline-flex shrink-0 rounded-md border border-warm-200 bg-warm-50 p-0.5 dark:bg-warm-200"
									role="group"
									aria-label="Show driver per month as table or chart"
								>
									<button
										type="button"
										class="rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 {dashboardUi.driverMonthView ===
										'table'
											? 'bg-white text-accent-700 shadow-sm dark:bg-warm-100 dark:text-accent-600'
											: 'text-warm-600 hover:text-warm-800'}"
										aria-pressed={dashboardUi.driverMonthView === 'table'}
										onclick={() => {
											dashboardUi.driverMonthView = 'table';
										}}
									>
										Table
									</button>
									<button
										type="button"
										class="rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 {dashboardUi.driverMonthView ===
										'chart'
											? 'bg-white text-accent-700 shadow-sm dark:bg-warm-100 dark:text-accent-600'
											: 'text-warm-600 hover:text-warm-800'}"
										aria-pressed={dashboardUi.driverMonthView === 'chart'}
										onclick={() => {
											dashboardUi.driverMonthView = 'chart';
										}}
									>
										Chart
									</button>
								</div>
							</div>
						</div>
						<p id="driver-month-tally-summary" class="sr-only">{driverMonthTallyAriaLabel}</p>

						{#if !hasDriverMonthTally}
							<p class="flex min-h-0 flex-1 items-center justify-center py-6 text-center text-sm text-warm-500">
								No incidents in this period.
							</p>
						{:else if dashboardUi.driverMonthView === 'chart'}
							<!-- Legend above plot: visible series (colour · name · total); click to hide -->
							<div class="dashboard-chart-legend dashboard-chart-legend--top mb-1.5 shrink-0">
								{#if driverMonthVisibleCount > 0}
									<ul
										class="flex flex-wrap gap-x-1.5 gap-y-1"
										aria-label="Driver series legend for {driverMonthTally.periodLabel}. Click to hide a series from the chart.{showDriverMonthTotals
											? ' Hover to highlight a series.'
											: ''}"
										onpointerleave={() => {
											hoveredDriverMonthLabel = null;
										}}
									>
										{#each driverMonthTally.rows as row (row.key)}
											{@const visible = isLegendVisible(
												driverMonthHiddenLabels,
												row.label
											)}
											{#if visible}
												{@const swatch =
													driverMonthColorByLabel.get(row.label) ??
													getChartCategoryColor(row.label, 0, theme.isDark)}
												{@const focus = showDriverMonthTotals
													? hoveredDriverMonthLabel
													: null}
												{@const dimLegend =
													visible && focus != null && focus !== row.label}
												{@const activeLegend = visible && focus === row.label}
												<li>
													<button
														type="button"
														class="dashboard-legend-btn flex max-w-full items-center gap-1 text-[12px] leading-tight text-warm-600 {dimLegend
															? 'opacity-35'
															: activeLegend
																? 'bg-warm-100 text-warm-800 opacity-100 ring-1 ring-warm-300/80 dark:bg-warm-200'
																: ''}"
														aria-pressed={true}
														title="Hide {row.label} on chart"
														onpointerenter={() => {
															if (showDriverMonthTotals) {
																hoveredDriverMonthLabel = row.label;
															}
														}}
														onclick={() => toggleDriverMonthLegend(row.label)}
													>
														<span
															class="inline-block h-2.5 w-2.5 shrink-0 rounded-full {dimLegend
																? 'opacity-50'
																: ''}"
															style="background: {swatch}"
															aria-hidden="true"
														></span>
														<span class="truncate">{row.label} ({row.total})</span>
													</button>
												</li>
											{/if}
										{/each}
									</ul>
								{:else}
									<p class="text-xs text-warm-500">
										No drivers selected — use the Drivers menu to include series.
									</p>
								{/if}
							</div>
							<div
								class="dashboard-chart-plot dashboard-chart-plot--fill relative min-h-0 w-full flex-1"
								style="min-height: 16rem;"
							>
								{#if driverMonthVisibleCount === 0}
									<div class="flex h-full min-h-[16rem] items-center justify-center">
										<p class="text-sm text-warm-500">
											No drivers selected — open the Drivers menu to include series.
										</p>
									</div>
								{/if}
								<canvas
									bind:this={driverMonthCanvas}
									class="block h-full w-full {driverMonthVisibleCount === 0
										? 'hidden'
										: ''}"
									aria-label="Line chart of incidents by driver per month"
								></canvas>
							</div>
						{:else}
							<div
								class="dashboard-driver-table-scroll min-h-0 flex-1 overflow-auto rounded-md border border-warm-200"
							>
								<table
									class="dashboard-driver-month-table w-full min-w-[20rem] border-collapse text-left text-sm"
									style="--driver-row-slot: {DRIVER_BAR_SLOT_PX}px; --driver-bar-thickness: {DRIVER_BAR_THICKNESS_PX}px; --driver-bar-gap: {DRIVER_BAR_GAP_PX}px;"
								>
									<thead class="sticky top-0 z-10 border-b border-warm-200 bg-warm-50 dark:bg-warm-200">
										<tr>
											<th
												scope="col"
												class="sticky left-0 z-20 bg-warm-50 px-3 text-xs font-semibold uppercase tracking-wide text-warm-600 dark:bg-warm-200"
											>
												Driver
											</th>
											{#each driverMonthTally.monthLabels as label, i (driverMonthTally.months[i])}
												<th
													scope="col"
													class="px-2 text-center text-xs font-semibold tabular-nums text-warm-600 whitespace-nowrap"
													title={formatMonthYearLabel(driverMonthTally.months[i] ?? '')}
												>
													{label}
												</th>
											{/each}
											{#if showDriverMonthTotals}
												<th
													scope="col"
													class="px-3 text-center text-xs font-semibold uppercase tracking-wide text-warm-700"
												>
													Total
												</th>
											{/if}
										</tr>
									</thead>
									<tbody class="divide-y divide-warm-100">
										{#each driverMonthTally.rows as row (row.key)}
											<tr class="dashboard-data-row dashboard-driver-month-row">
												<th
													scope="row"
													class="dashboard-driver-month-sticky sticky left-0 z-[1] bg-white px-3 text-xs font-medium text-warm-800 dark:bg-warm-100"
												>
													{row.label}
												</th>
												{#each row.counts as count, i (`${row.key}-${driverMonthTally.months[i] ?? i}`)}
													<td
														class="px-1.5 text-center tabular-nums {count === 0
															? 'text-warm-400'
															: ''}"
													>
														{#if count === 0}
															<span class="inline-block min-w-[2.25rem] text-warm-400"
																>—</span
															>
														{:else}
															<button
																type="button"
																class="dashboard-driver-month-cell-btn inline-flex min-w-[2.5rem] items-center justify-center rounded-md border border-accent-200 bg-accent-100 px-2.5 text-sm font-semibold tabular-nums text-accent-700 shadow-sm transition hover:border-accent-500 hover:bg-accent-200 hover:text-accent-700 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 active:scale-[0.97] dark:border-accent-200 dark:bg-accent-200 dark:text-accent-600 dark:hover:border-accent-500 dark:hover:bg-accent-200"
																title="View {count} incident{count === 1
																	? ''
																	: 's'} for {row.label} in {formatMonthYearLabel(
																	driverMonthTally.months[i] ?? ''
																)}"
																aria-label="View {count} incident{count === 1
																	? ''
																	: 's'} for {row.label}, {formatMonthYearLabel(
																	driverMonthTally.months[i] ?? ''
																)}"
																onclick={() =>
																	openDriverMonthDetail(
																		row.key,
																		row.label,
																		driverMonthTally.months[i],
																		count
																	)}
															>
																{count}
															</button>
														{/if}
													</td>
												{/each}
												{#if showDriverMonthTotals}
													<td
														class="px-3 text-center font-semibold tabular-nums text-warm-900"
													>
														{row.total}
													</td>
												{/if}
											</tr>
										{/each}
									</tbody>
									<tfoot
										class="sticky bottom-0 border-t border-warm-200 bg-warm-50 dark:bg-warm-200"
									>
										<tr>
											<th
												scope="row"
												class="sticky left-0 z-[1] bg-warm-50 px-3 text-xs font-semibold uppercase tracking-wide text-warm-700 dark:bg-warm-200"
											>
												All drivers
											</th>
											{#each driverMonthTally.monthTotals as total, i (driverMonthTally.months[i])}
												<td
													class="px-2 text-center text-xs font-semibold tabular-nums text-warm-800"
												>
													{total === 0 ? '—' : total}
												</td>
											{/each}
											{#if showDriverMonthTotals}
												<td
													class="px-3 text-center text-sm font-bold tabular-nums text-warm-900"
												>
													{driverMonthTally.grandTotal}
												</td>
											{/if}
										</tr>
									</tfoot>
								</table>
							</div>
						{/if}
					</section>

					<section
						class="dashboard-chart-card min-w-0 overflow-hidden rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4"
						data-pdf-driver-chart
						aria-labelledby="driver-chart-title"
						aria-describedby="driver-chart-summary"
					>
						<div class="dashboard-chart-header">
							<h2 class="dashboard-section-title" id="driver-chart-title">
								Incidents by Driver
							</h2>
							<p class="dashboard-chart-meta text-xs text-warm-500">
								{timeRangeLabel} · stacked by type · click a segment to open incidents
							</p>
						</div>
						<p id="driver-chart-summary" class="sr-only">
							{driverChartAriaLabel} Click a bar segment to view those incidents in the
							list.
						</p>
						<!-- Type legend above the plot (click to toggle, hover to highlight) -->
						<div class="dashboard-chart-legend dashboard-chart-legend--top">
							{#if hasDriverData}
								<ul
									class="flex flex-wrap gap-x-1.5 gap-y-1"
									aria-label="Incident type legend for {driverStackedBarData.periodLabel}. Click to show or hide a series. Hover to highlight a series."
									onpointerleave={() => {
										hoveredDriverTypeLabel = null;
									}}
								>
									{#each driverStackedBarData.datasets as ds (`${ds.label}-${ds.total}-${timeRange}`)}
										{@const visible = isLegendVisible(dashboardUi.hiddenDriverTypeLabels, ds.label)}
										{@const focus = hoveredDriverTypeLabel}
										{@const dimLegend =
											visible && focus != null && focus !== ds.label}
										{@const activeLegend = visible && focus === ds.label}
										<li>
											<button
												type="button"
												class="dashboard-legend-btn flex max-w-full items-center gap-1 text-[12px] leading-tight text-warm-600 {visible
													? dimLegend
														? 'opacity-35'
														: activeLegend
															? 'bg-warm-100 text-warm-800 opacity-100 ring-1 ring-warm-300/80 dark:bg-warm-200'
															: ''
													: 'opacity-40 line-through'}"
												aria-pressed={visible}
												title={visible
													? `Hide ${ds.label} on chart`
													: `Show ${ds.label} on chart`}
												onpointerenter={() => {
													hoveredDriverTypeLabel = ds.label;
												}}
												onclick={() => toggleDriverTypeLegend(ds.label)}
											>
												<span
													class="inline-block h-2.5 w-2.5 shrink-0 rounded-full {dimLegend
														? 'opacity-50'
														: ''}"
													style="background: {typeof ds.borderColor === 'string'
														? ds.borderColor
														: '#666'}"
													aria-hidden="true"
												></span>
												<span class="truncate">{ds.label} ({ds.total})</span>
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
						<div
							class="dashboard-chart-plot dashboard-chart-plot--fill relative w-full min-h-0"
							style:height="{driverChartPlotHeightPx}px"
							style:min-height="{driverChartPlotHeightPx}px"
							style:max-height="{driverChartPlotHeightPx}px"
							style:flex="0 0 {driverChartPlotHeightPx}px"
						>
							{#if !hasDriverData}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-warm-500">No incidents in this period.</p>
								</div>
							{/if}
							<canvas
								bind:this={driverCanvas}
								class={!hasDriverData ? 'hidden' : 'block h-full w-full'}
								aria-hidden="true"
							></canvas>
							<table class="sr-only" aria-labelledby="driver-chart-title">
								<thead>
									<tr>
										<th scope="col">Driver</th>
										{#each driverStackedBarData.typeLabels as typeLabel (typeLabel)}
											<th scope="col">{typeLabel}</th>
										{/each}
										<th scope="col">Total</th>
									</tr>
								</thead>
								<tbody>
									{#each driverStackedBarData.driverRows as row (row.label)}
										<tr>
											<th scope="row">{row.label}</th>
											{#each row.byType as count, i (`${row.label}-${driverStackedBarData.typeLabels[i] ?? i}`)}
												<td>{count}</td>
											{/each}
											<td>{row.total}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</section>
				</div>

				<!-- NSW map — hidden in PDF so page 2 stays a dense driver pair -->
				<div class="dashboard-map-row mt-2" data-pdf-hide>
					<div class="min-h-[min(28rem,55vh)] w-full [&_.map-chart-shell]:h-full [&_.map-chart-shell]:min-h-[min(28rem,55vh)]">
						<NswIncidentMap
							bind:this={nswMap}
							incidents={periodIncidents}
							periodLabel={timeRangeLabel}
							onPersistCoords={async (updates) => {
								await incidentStore.persistLocationCoords(updates);
							}}
							onSuburbDrillDown={(suburb) => {
								drillDownToIncidents({ drill: 'map-chart', suburb });
							}}
						/>
					</div>
				</div>
			</div>
		</div>
	{/if}
	</div>

	<!-- Driver × month cell drill-down: list incidents for that data point -->
	{#if driverMonthDetail}
		<div
			class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
			onclick={handleDriverMonthDetailBackdrop}
			role="presentation"
		>
			<div
				class="flex max-h-[min(90vh,56rem)] w-[70%] flex-col overflow-hidden rounded-lg border border-warm-200 bg-white shadow-2xl dark:bg-warm-100"
				role="dialog"
				aria-modal="true"
				aria-labelledby="driver-month-detail-title"
				tabindex="-1"
			>
				<header
					class="flex shrink-0 items-start justify-between gap-4 border-b border-warm-200 bg-warm-50 px-5 py-3 dark:bg-warm-200"
				>
					<div class="min-w-0">
						<h2
							id="driver-month-detail-title"
							class="truncate text-lg font-semibold text-warm-800"
						>
							{driverMonthDetailTitle}
						</h2>
						<p class="mt-0.5 text-sm text-warm-500">
							{driverMonthDetailIncidents.length}
							incident{driverMonthDetailIncidents.length === 1 ? '' : 's'}
							· {timeRangeLabel}
						</p>
					</div>
					<button
						type="button"
						onclick={closeDriverMonthDetail}
						aria-label="Close incident list"
						title="Close"
						class="shrink-0 rounded-md border border-warm-200 bg-white p-2 text-warm-600 hover:bg-warm-100 hover:text-warm-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-100"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</header>

				<div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 sm:px-5">
					{#if driverMonthDetailIncidents.length === 0}
						<p class="py-8 text-center text-sm text-warm-500">No incidents for this cell.</p>
					{:else}
						<table
							class="w-full table-fixed border-collapse text-left text-sm"
						>
							<colgroup>
								<col class="w-[12%]" />
								<col class="w-[14%]" />
								<col class="w-[12%]" />
								<col class="w-[9%]" />
								<col class="w-[14%]" />
								<col class="w-[16%]" />
								<col class="w-[23%]" />
							</colgroup>
							<thead class="sticky top-0 z-10 border-b border-warm-200 bg-white dark:bg-warm-100">
								<tr>
									<th
										scope="col"
										class="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-warm-600"
										>Reference</th
									>
									<th
										scope="col"
										class="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-warm-600"
										>Date / time received</th
									>
									<th
										scope="col"
										class="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-warm-600"
										>Resolution</th
									>
									<th
										scope="col"
										class="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-warm-600"
										>Priority</th
									>
									<th
										scope="col"
										class="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-warm-600"
										>Type</th
									>
									<th
										scope="col"
										class="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-warm-600"
										>Email sender</th
									>
									<th
										scope="col"
										class="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-warm-600"
										>Subject</th
									>
								</tr>
							</thead>
							<tbody class="divide-y divide-warm-100">
								{#each driverMonthDetailIncidents as incident (incident.id)}
									<tr class="align-top hover:bg-warm-50/80 dark:hover:bg-warm-200/30">
										<td class="break-words px-2 py-2 font-mono text-xs text-warm-800">
											{incident.referenceNo?.trim() || '—'}
										</td>
										<td class="break-words px-2 py-2 text-xs tabular-nums text-warm-700">
											{formatDateTimeFields(incident.dateReceived, incident.time) || '—'}
										</td>
										<td class="px-2 py-2">
											{#if incident.action?.trim()}
												<span
													class="inline-block max-w-full break-words rounded-full border px-2 py-0.5 text-xs font-medium {getActionPillClass(
														incident.action
													)}"
												>
													{incident.action}
												</span>
											{:else}
												<span class="text-xs text-warm-400">—</span>
											{/if}
										</td>
										<td class="px-2 py-2">
											{#if incident.marked?.trim()}
												<span
													class="inline-block max-w-full break-words rounded-full border px-2 py-0.5 text-xs font-medium {getPriorityPillClass(
														normalizePriority(incident.marked)
													)}"
												>
													{normalizePriority(incident.marked)}
												</span>
											{:else}
												<span class="text-xs text-warm-400">—</span>
											{/if}
										</td>
										<td class="px-2 py-2">
											{#if incident.type?.trim()}
												<span
													class="inline-block max-w-full break-words text-xs font-semibold {getTypeTextClass(
														incident.type
													)}"
												>
													{incident.type}
												</span>
											{:else}
												<span class="text-xs text-warm-400">—</span>
											{/if}
										</td>
										<td class="break-words px-2 py-2 text-xs text-warm-700">
											{incident.emailSender?.trim() || '—'}
										</td>
										<td class="break-words px-2 py-2 text-xs text-warm-700">
											{incident.emailSubject?.trim() || '—'}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>

				<footer
					class="flex shrink-0 justify-end border-t border-warm-200 bg-warm-50 px-5 py-3 dark:bg-warm-200"
				>
					<button
						type="button"
						onclick={closeDriverMonthDetail}
						class="rounded-md border border-warm-300 bg-white px-5 py-2 text-sm font-medium text-warm-700 hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-100"
					>
						Close
					</button>
				</footer>
			</div>
		</div>
	{/if}
</div>

<style>
	.pdf-capture-only {
		display: none;
	}

	:global(#dashboard-pdf-root.pdf-capture) {
		overflow: visible !important;
		background: #f7f4ef !important;
	}

	:global(#dashboard-pdf-root.pdf-capture .pdf-capture-only) {
		display: block;
	}

	:global(#dashboard-pdf-root.pdf-capture [data-pdf-hide]),
	:global(#dashboard-pdf-root.pdf-capture .sr-only) {
		display: none !important;
	}

	:global(#dashboard-pdf-root.pdf-capture [data-pdf-page]),
	:global(#dashboard-pdf-root.pdf-capture #dashboard-pdf-page-1),
	:global(#dashboard-pdf-root.pdf-capture #dashboard-pdf-page-2) {
		min-width: 1400px;
		max-width: 1400px;
		background: #f7f4ef;
		padding: 0.35rem 0.5rem 0.5rem;
	}

	:global(#dashboard-pdf-root.pdf-capture .dashboard-summary > div) {
		display: grid !important;
		grid-template-columns: repeat(12, minmax(0, 1fr)) !important;
	}

	:global(#dashboard-pdf-root.pdf-capture .dashboard-summary) {
		margin-bottom: 0.4rem !important;
	}

	:global(#dashboard-pdf-root.pdf-capture hr) {
		margin-bottom: 0.45rem !important;
	}

	:global(#dashboard-pdf-root.pdf-capture .dashboard-chart-row),
	:global(#dashboard-pdf-root.pdf-capture .dashboard-driver-row) {
		display: grid !important;
		grid-template-columns: 1fr 1fr !important;
		align-items: stretch !important;
		gap: 0.5rem !important;
		margin-top: 0 !important;
	}

	:global(#dashboard-pdf-root.pdf-capture .team-leader-view-toggle),
	:global(#dashboard-pdf-root.pdf-capture [data-action-status-picker]),
	:global(#dashboard-pdf-root.pdf-capture [data-driver-month-picker]) {
		display: none !important;
	}

	:global(#dashboard-pdf-root.pdf-capture .dashboard-map-row) {
		max-height: 16rem;
		overflow: hidden;
	}

	:global(#dashboard-pdf-root.pdf-capture .dashboard-map-row .map-chart-shell),
	:global(#dashboard-pdf-root.pdf-capture .dashboard-map-row .nsw-incident-map) {
		min-height: 14rem !important;
		height: 14rem !important;
	}

	/*
	 * Equal-height chart cards:
	 * - Grid stretches cards to the same total height
	 * - Header / plot / footer use fixed slots so plot areas match
	 * - Type legend lives in the footer (outside canvas) so it does not shrink the plot
	 */
	:global(.dashboard-chart-row) {
		align-items: stretch;
	}

	:global(.dashboard-chart-card) {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 100%;
		box-sizing: border-box;
	}

	:global(.dashboard-chart-header) {
		flex: 0 0 auto;
		min-height: 3.25rem;
		margin-bottom: 0.35rem;
	}

	:global(.dashboard-chart-meta) {
		min-height: 1.1rem;
		margin-top: 0.2rem;
		line-height: 1.1rem;
	}

	/* Plot height: 21.06rem + 10% = 23.166rem (top-row equal cards) */
	:global(.dashboard-chart-plot) {
		flex: 0 0 23.17rem;
		height: 23.17rem;
		min-height: 23.17rem;
		max-height: 23.17rem;
		position: relative;
		overflow: hidden;
		width: 100%;
	}

	:global(.dashboard-chart-plot canvas) {
		width: 100% !important;
		height: 100% !important;
		max-height: 23.17rem !important;
	}

	/*
	 * Driver row: equal-height cards. Table scroll body and chart plot both
	 * flex-grow so they share the same vertical space.
	 * Floor ≈ 75% of top-row plot (23.17rem × 0.75).
	 */
	:global(.dashboard-driver-row) {
		/* Table can be tall; chart card sizes to bar stack (align-self on card). */
		align-items: start;
	}

	:global(.dashboard-driver-row > *) {
		min-height: 0;
	}

	:global(.dashboard-driver-row > .dashboard-driver-table-card) {
		/* Keep table using available width; allow natural height with min from CSS */
		min-height: calc(3.25rem + 17.38rem + 2.85rem + 10px + 0.7rem);
	}

	:global(.dashboard-driver-table-card) {
		display: flex;
		flex-direction: column;
		min-height: calc(3.25rem + 17.38rem + 2.85rem + 10px + 0.7rem);
	}

	:global(.dashboard-driver-table-scroll) {
		flex: 1 1 auto;
		min-height: 17.38rem;
	}

	/*
	 * Driver×month tally rows match the bar chart category slot
	 * (--driver-row-slot = bar thickness + gap, same constants as Chart.js).
	 * Header/footer stay a touch taller for labels; body rows are fixed height.
	 */
	:global(.dashboard-driver-month-table thead th),
	:global(.dashboard-driver-month-table tfoot th),
	:global(.dashboard-driver-month-table tfoot td) {
		/* ~slot height so chrome feels related to the data rows */
		height: var(--driver-row-slot, 26px);
		padding-top: 0;
		padding-bottom: 0;
		vertical-align: middle;
		line-height: 1.15;
		box-sizing: border-box;
	}

	:global(.dashboard-driver-month-table tbody th),
	:global(.dashboard-driver-month-table tbody td) {
		height: var(--driver-row-slot, 26px);
		max-height: var(--driver-row-slot, 26px);
		padding-top: 0;
		padding-bottom: 0;
		vertical-align: middle;
		line-height: 1.15;
		box-sizing: border-box;
	}

	/* Count pills ≈ bar thickness so rows read like chart categories */
	:global(.dashboard-driver-month-table .dashboard-driver-month-cell-btn) {
		height: var(--driver-bar-thickness, 20px);
		min-height: var(--driver-bar-thickness, 20px);
		max-height: var(--driver-bar-thickness, 20px);
		padding-top: 0;
		padding-bottom: 0;
		line-height: 1;
		font-size: 0.75rem; /* 12px — fits inside 20px pill */
	}

	/*
	 * Chart / table card titles — one size, always uppercase.
	 * Matches former text-sm + semibold; tracking keeps caps readable.
	 */
	:global(.dashboard-section-title) {
		font-size: 0.875rem; /* 14px — text-sm */
		line-height: 1.25rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-warm-800, #292524);
	}

	/* Full-row hover: faint teal (driver-per-month + stats by team leader) */
	:global(tr.dashboard-data-row:hover),
	:global(tr.dashboard-data-row:hover > th),
	:global(tr.dashboard-data-row:hover > td) {
		background-color: var(--color-accent-50);
	}

	:global(.dark tr.dashboard-data-row:hover),
	:global(.dark tr.dashboard-data-row:hover > th),
	:global(.dark tr.dashboard-data-row:hover > td) {
		/* Slightly stronger than accent-50 so the row reads on dark cards */
		background-color: var(--color-accent-100);
	}

	/* Chart card sizes to its content (tight bar stack); table may be taller. */
	:global(.dashboard-driver-row .dashboard-chart-card) {
		height: auto;
		min-height: 0;
		align-self: start;
	}

	/*
	 * Driver plot: height is set inline from driver count (n × slot + pad) so
	 * each bar stays 20px with a fixed 4px gap. Must NOT flex-grow — stretching
	 * the canvas re-spaces categories and makes gaps ignore the slot constant.
	 */
	:global(.dashboard-chart-plot.dashboard-chart-plot--fill) {
		flex: 0 0 auto;
		flex-grow: 0;
		flex-shrink: 0;
		overflow: hidden;
	}

	:global(.dashboard-chart-plot.dashboard-chart-plot--fill canvas) {
		max-height: none !important;
	}

	/* Stats by Team Leader: table fills the top-row plot slot */
	:global(.dashboard-team-leader-stats-card) {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 100%;
	}

	:global(.dashboard-team-leader-stats-plot) {
		overflow: hidden;
	}

	:global(.dashboard-team-leader-stats-scroll) {
		min-height: 0;
		height: 100%;
		/* Keep body/footer column widths aligned when a vertical scrollbar appears */
		scrollbar-gutter: stable;
	}

	/*
	 * Shared column template for body + All footer tables (two tables, one grid).
	 * Fixed layout so Ongoing / % / Resolved / % / Total line up with leader rows.
	 */
	:global(.tls-stats-table) {
		table-layout: fixed;
	}

	:global(.tls-stats-table .tls-col-leader) {
		width: 34%;
	}

	:global(.tls-stats-table .tls-col-num) {
		width: 14%;
	}

	:global(.tls-stats-table .tls-col-pct) {
		width: 12%;
	}

	/*
	 * Feint vertical rules group Ongoing+% and Resolved+% pairs
	 * (and separate Total). Soft gray so it reads as structure, not grid.
	 */
	:global(.tls-stats-table .tls-col-group-start) {
		border-left: 1px solid rgba(0, 0, 0, 0.08);
	}

	:global(.tls-stats-table .tls-col-group-end) {
		border-right: 1px solid rgba(0, 0, 0, 0.08);
	}

	:global(.dark .tls-stats-table .tls-col-group-start) {
		border-left-color: rgba(255, 255, 255, 0.1);
	}

	:global(.dark .tls-stats-table .tls-col-group-end) {
		border-right-color: rgba(255, 255, 255, 0.1);
	}

	/* Header definition popups (Team Leader / Ongoing / Resolved) */
	:global(.tls-stats-table .tls-th-tip) {
		position: relative;
		cursor: help;
	}

	:global(.tls-stats-table .tls-th-label) {
		border-bottom: 1px dotted currentColor;
		padding-bottom: 0.05rem;
	}

	:global(.tls-stats-table .tls-th-popup) {
		position: absolute;
		left: 50%;
		top: calc(100% + 0.35rem);
		z-index: 40;
		width: max-content;
		max-width: min(16rem, 70vw);
		padding: 0.5rem 0.65rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-warm-200, #e5e5e5);
		background: var(--color-warm-50, #ffffff);
		color: var(--color-warm-800, #1f1f1f);
		font-size: 0.7rem;
		font-weight: 400;
		line-height: 1.35;
		letter-spacing: normal;
		text-transform: none;
		text-align: left;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transform: translateX(-50%) translateY(-2px);
		transition:
			opacity 0.12s ease,
			visibility 0.12s ease,
			transform 0.12s ease;
	}

	:global(.tls-stats-table .tls-th-tip:hover .tls-th-popup),
	:global(.tls-stats-table .tls-th-tip:focus-visible .tls-th-popup),
	:global(.tls-stats-table .tls-th-tip:focus-within .tls-th-popup) {
		opacity: 1;
		visibility: visible;
		transform: translateX(-50%) translateY(0);
	}

	:global(.dark .tls-stats-table .tls-th-popup) {
		background: var(--color-warm-100, #1a1a1a);
		border-color: var(--color-warm-300, #3a3a3a);
		color: var(--color-warm-800, #f0f0f0);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
	}

	/* +10px so multi-line type legends are not clipped */
	:global(.dashboard-chart-footer) {
		flex: 0 0 calc(2.85rem + 10px);
		min-height: calc(2.85rem + 10px);
		max-height: calc(2.85rem + 10px);
		margin-top: 0.35rem;
		overflow: hidden;
	}

	/* Driver chart: type legend above the plot */
	:global(.dashboard-chart-legend) {
		flex: 0 0 auto;
		min-height: calc(2.85rem + 10px);
		overflow: hidden;
	}

	:global(.dashboard-chart-legend--top) {
		margin-top: 0.15rem;
		margin-bottom: 0.35rem;
	}

	:global(.dashboard-legend-btn) {
		border-radius: 0.25rem;
		padding: 0.05rem 0.2rem;
		cursor: pointer;
		transition: opacity 0.12s ease, background-color 0.12s ease;
	}
	:global(.dashboard-legend-btn:hover) {
		background: color-mix(in srgb, var(--color-warm-200, #e7e5e4) 55%, transparent);
	}
	:global(.dashboard-legend-btn:focus-visible) {
		outline: 2px solid var(--color-accent-500, #0d9488);
		outline-offset: 1px;
	}
</style>
