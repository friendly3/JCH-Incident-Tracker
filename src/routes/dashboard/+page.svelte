<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { incidentStore } from '$lib/data/store.svelte';
	import { formatDate, formatDateTimeFields, normalizeDateOnly } from '$lib/formatDate';
	import type { Incident } from '$lib/data/incidents';
	import {
		getActionPillClass,
		getActionStatusChartColor,
		getPriorityPillClass,
		getTypePillClass,
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
		dashboardPeriod,
		TIME_RANGE_OPTIONS,
		formatMonthYearLabel,
		isDateReceivedInTimeRange,
		isMonthTimeRange,
		monthKeyFromRange,
		type MonthTimeRangeKey,
		type TimeRangeKey
	} from '$lib/dashboardPeriod.svelte';
	import { theme } from '$lib/theme.svelte';
	import type { Chart as ChartJS, ChartOptions, Plugin } from 'chart.js';
	import { Chart, registerables } from 'chart.js';
	import ChartDataLabels from 'chartjs-plugin-datalabels';
	import { onMount, untrack } from 'svelte';

	// Register Chart.js plugins (datalabels for always-visible pie slice stats)
	Chart.register(...registerables, ChartDataLabels);

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
			return pick('#EA580C', '#FB923C'); // orange
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

	function buildChartOptions(colors: ReturnType<typeof getChartTheme>): ChartOptions<'line'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			layout: {
				// Compact top room for point labels inside a short plot box
				padding: { top: 14, right: 6, left: 2, bottom: 2 }
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
					ticks: {
						color: colors.ticks,
						font: { size: 11, weight: 500 }
					},
					grid: {
						display: false
					}
				}
			}
		};
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

	function applyChartTheme(chart: ChartJS<'line'>) {
		const colors = getChartTheme(theme.isDark);
		const dataset = chart.data.datasets[0];
		if (!dataset) return;
		dataset.borderColor = colors.accent;
		dataset.backgroundColor = colors.fill;
		dataset.pointBackgroundColor = colors.accent;
		dataset.pointBorderColor = colors.pointBorder;
		dataset.borderWidth = 3;
		dataset.pointRadius = 5;
		dataset.pointHoverRadius = 7;
		dataset.pointBorderWidth = 2;
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

	/** Color each type series and refresh axis/legend theme tokens. */
	function applyTypeOverTimeChartTheme(chart: ChartJS<'line'>) {
		const colors = getChartTheme(theme.isDark);
		const isDark = theme.isDark;
		const colorMap = assignDistinctCategoryColors(
			chart.data.datasets.map((d) => String(d.label ?? '')),
			isDark
		);
		chart.data.datasets.forEach((dataset) => {
			// Unspecified / blank types always use medium gray (same as Unassigned)
			const stroke =
				colorMap.get(String(dataset.label ?? '')) ??
				getChartCategoryColor(dataset.label, 0, isDark);
			dataset.borderColor = stroke;
			dataset.backgroundColor = withAlpha(stroke, 0.06);
			dataset.pointBackgroundColor = stroke;
			dataset.pointBorderColor = colors.pointBorder;
			dataset.borderWidth = 2.5;
			dataset.pointRadius = 4;
			dataset.pointHoverRadius = 6;
			dataset.pointBorderWidth = 2;
		});
		if (chart.options?.plugins?.legend) {
			// Keep legend off-canvas so plot height matches the other two cards
			chart.options.plugins.legend.display = false;
		}
		if (chart.options?.plugins?.datalabels) {
			Object.assign(
				chart.options.plugins.datalabels,
				buildLineDataLabels(colors, { fontSize: 10, multiSeries: true })
			);
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

	/** Vertical bar: incidents per resolution status. */
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
							return `${value} ${value === 1 ? 'incident' : 'incidents'}`;
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

	/**
	 * Horizontal stacked bar: drivers on Y, segments = incident type.
	 * Legend is HTML (footer) so plot height stays equal with siblings.
	 */
	function buildDriverBarOptions(
		colors: ReturnType<typeof getChartTheme>
	): ChartOptions<'bar'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			indexAxis: 'y',
			layout: {
				// Extra right pad so external total labels are not clipped
				padding: { top: 2, right: 32, left: 2, bottom: 2 }
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
							font: { size: 9, weight: 'bold' as const },
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
										data: { datasets: { data?: unknown[]; hidden?: boolean }[] };
										isDatasetVisible?: (index: number) => boolean;
									};
								}
							) => {
								const sum = sumVisibleDriverStack(context.chart, context.dataIndex);
								return sum > 0 ? String(sum) : '';
							},
							// Horizontal bar: end of bar = right side of stack
							anchor: 'end',
							align: 'end',
							offset: 6,
							clamp: false,
							clip: false,
							color: colors.legend,
							font: { size: 11, weight: 'bold' as const },
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
					// Room for external total labels past the bar end
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

	function applyDriverBarTheme(chart: ChartJS<'bar'>) {
		const colors = getChartTheme(theme.isDark);
		const isDark = theme.isDark;
		const colorMap = assignDistinctCategoryColors(
			chart.data.datasets.map((d) => String(d.label ?? '')),
			isDark
		);

		chart.data.datasets.forEach((dataset) => {
			const typeLabel = String(dataset.label ?? '');
			const solid =
				colorMap.get(typeLabel) ?? getChartCategoryColor(typeLabel, 0, isDark);
			dataset.backgroundColor = withAlpha(solid, 0.82);
			dataset.borderColor = solid;
			dataset.borderWidth = 1;
			dataset.borderRadius = 2;
			dataset.barPercentage = 0.8;
			dataset.categoryPercentage = 0.85;
			// Ensure stacking key is stable across updates
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
	let chartInstance = $state<ChartJS<'line'> | undefined>();
	let typeOverTimeChart = $state<ChartJS<'line'> | undefined>();
	let actionStatusChart = $state<ChartJS<'bar'> | undefined>();
	let driverChart = $state<ChartJS<'bar'> | undefined>();
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
		if (next !== 'all' && next !== '7' && next !== '30' && next !== '90' && !isMonthTimeRange(next)) {
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
	 * Legend filters for multi-series charts (row 3): labels listed here are hidden.
	 * Click legend items to toggle. Reassigned as new arrays for Svelte reactivity.
	 */
	let hiddenTypeOverTimeLabels = $state<string[]>([]);
	let hiddenDriverTypeLabels = $state<string[]>([]);

	function isLegendVisible(hidden: string[], label: string): boolean {
		return !hidden.includes(label);
	}

	function toggleLegendLabel(hidden: string[], label: string): string[] {
		return hidden.includes(label)
			? hidden.filter((l) => l !== label)
			: [...hidden, label];
	}

	function toggleTypeOverTimeLegend(label: string) {
		hiddenTypeOverTimeLabels = toggleLegendLabel(hiddenTypeOverTimeLabels, label);
	}

	function toggleDriverTypeLegend(label: string) {
		hiddenDriverTypeLabels = toggleLegendLabel(hiddenDriverTypeLabels, label);
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

	const timeRangeLabel = $derived.by(() => {
		const relative = TIME_RANGE_OPTIONS.find((o) => o.value === timeRange);
		if (relative) return relative.label;
		if (isMonthTimeRange(timeRange)) {
			const ym = monthKeyFromRange(timeRange);
			const hit = availableMonths.find((m) => m.ym === ym);
			const base = formatMonthYearLabel(ym);
			return hit ? `${base} (${hit.count})` : base;
		}
		return 'All time';
	});

	// If selected month disappears after data reload, fall back to all time.
	// Wait until months are known (or load finished) so we don't wipe a valid pick mid-load.
	$effect(() => {
		const loading = incidentStore.isLoading || Boolean(data.loadError);
		const yms = availableMonths.map((m) => m.ym);
		if (loading && yms.length === 0) return;
		dashboardPeriod.resetIfMissingMonth(yms);
		const stored = dashboardPeriod.value;
		if (timeRange !== stored) {
			timeRange = stored;
		}
	});

	// Group incidents by date and count them (filtered by selected relative period)
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

	const chartData = $derived.by(() => ({
		labels: incidentsByDate.map(([date]) => formatDate(date)),
		datasets: [
			{
				label: 'Incidents',
				data: incidentsByDate.map(([, count]) => count),
				borderWidth: 3,
				fill: true,
				tension: 0.35,
				pointRadius: 5,
				pointBorderWidth: 2,
				pointHoverRadius: 7
			}
		]
	}));

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
						pointRadius: 3,
						pointBorderWidth: 2,
						pointHoverRadius: 5
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

	/** Counts by resolution status in the selected period — sorted high → low. */
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
		return Array.from(grouped.values())
			.map(({ label, count }) => [label, count] as [string, number])
			.sort(([, a], [, b]) => b - a);
	});

	const actionStatusBarData = $derived.by(() => ({
		labels: incidentsByActionStatus.map(([label]) => label),
		datasets: [
			{
				label: 'Incidents',
				data: incidentsByActionStatus.map(([, count]) => count),
				borderWidth: 1
			}
		]
	}));

	const hasActionStatusData = $derived(incidentsByActionStatus.length > 0);
	const actionStatusAriaLabel = $derived(
		buildChartAriaLabel(
			`Incidents by Resolution Status (${timeRangeLabel})`,
			incidentsByActionStatus
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
				borderRadius: 2,
				stack: 'types',
				barPercentage: 0.8,
				categoryPercentage: 0.85
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

	// Drop legend filters for series that no longer exist after period/data change
	$effect(() => {
		const typeLabels = new Set(typeOverTimeChartData.datasets.map((d) => d.label));
		const next = hiddenTypeOverTimeLabels.filter((l) => typeLabels.has(l));
		if (
			next.length !== hiddenTypeOverTimeLabels.length ||
			next.some((l, i) => l !== hiddenTypeOverTimeLabels[i])
		) {
			hiddenTypeOverTimeLabels = next;
		}
	});

	$effect(() => {
		const typeLabels = new Set(driverStackedBarData.datasets.map((d) => d.label));
		const next = hiddenDriverTypeLabels.filter((l) => typeLabels.has(l));
		if (
			next.length !== hiddenDriverTypeLabels.length ||
			next.some((l, i) => l !== hiddenDriverTypeLabels[i])
		) {
			hiddenDriverTypeLabels = next;
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

	/** Drill-down: incidents for one driver × calendar month cell. */
	type DriverMonthDetail = {
		driverKey: string;
		driverLabel: string;
		monthYm: string;
	};
	let driverMonthDetail = $state<DriverMonthDetail | null>(null);

	function openDriverMonthDetail(
		driverKey: string,
		driverLabel: string,
		monthYm: string | undefined,
		count: number
	) {
		if (count <= 0 || !monthYm) return;
		driverMonthDetail = { driverKey, driverLabel, monthYm };
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

	/** Same filters as the driver×month tally for the selected cell. */
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
			if (!dateKey || dateKey.slice(0, 7) !== sel.monthYm) continue;
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
		return `${sel.driverLabel} · ${formatMonthYearLabel(sel.monthYm)}`;
	});

	onMount(() => {
		resizeHandler = () => {
			chartInstance?.resize();
			typeOverTimeChart?.resize();
			actionStatusChart?.resize();
			driverChart?.resize();
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
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		const canvas = canvasElement;
		if (!canvas) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => chartData);
		const instance = new Chart(canvas, {
			type: 'line',
			data: initialData,
			options: buildChartOptions(colors)
		});
		applyChartTheme(instance);
		chartInstance = instance;

		return () => {
			instance.destroy();
			chartInstance = undefined;
		};
	});

	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		const canvas = typeOverTimeCanvas;
		if (!canvas || !hasTypeOverTimeData) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => {
			const hidden = hiddenTypeOverTimeLabels;
			return {
				labels: typeOverTimeChartData.labels,
				datasets: typeOverTimeChartData.datasets.map((ds) => ({
					...ds,
					hidden: hidden.includes(ds.label)
				}))
			};
		});
		const instance = new Chart(canvas, {
			type: 'line',
			data: initialData,
			options: buildTypeOverTimeChartOptions(colors)
		});
		applyTypeOverTimeChartTheme(instance);
		typeOverTimeChart = instance;

		return () => {
			instance.destroy();
			typeOverTimeChart = undefined;
		};
	});

	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		const canvas = actionStatusCanvas;
		if (!canvas || !hasActionStatusData) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => actionStatusBarData);
		const instance = new Chart(canvas, {
			type: 'bar',
			data: initialData,
			options: buildActionStatusBarOptions(colors)
		});
		applyActionStatusBarTheme(instance);
		actionStatusChart = instance;

		return () => {
			instance.destroy();
			actionStatusChart = undefined;
		};
	});

	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		const canvas = driverCanvas;
		if (!canvas || !hasDriverData) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => {
			const hidden = hiddenDriverTypeLabels;
			return {
				labels: driverStackedBarData.labels,
				datasets: driverStackedBarData.datasets.map((ds) => ({
					...ds,
					hidden: hidden.includes(ds.label)
				}))
			};
		});
		const instance = new Chart(canvas, {
			type: 'bar',
			data: initialData,
			options: buildDriverBarOptions(colors)
		});
		applyDriverBarTheme(instance);
		driverChart = instance;

		return () => {
			instance.destroy();
			driverChart = undefined;
		};
	});

	$effect(() => {
		const instance = chartInstance;
		if (!instance?.data.datasets[0]) return;
		instance.data.labels = chartData.labels;
		instance.data.datasets[0].data = chartData.datasets[0].data;
		instance.update('none');
	});

	$effect(() => {
		const instance = typeOverTimeChart;
		if (!instance) return;
		const next = typeOverTimeChartData;
		const hidden = hiddenTypeOverTimeLabels;
		instance.data.labels = next.labels;
		// Rebuild datasets so type set can grow/shrink; honour legend filter
		instance.data.datasets = next.datasets.map((ds) => ({
			...ds,
			hidden: hidden.includes(ds.label)
		}));
		applyTypeOverTimeChartTheme(instance);
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

	$effect(() => {
		const instance = driverChart;
		if (!instance) return;
		const next = driverStackedBarData;
		const hidden = hiddenDriverTypeLabels;
		instance.data.labels = next.labels;
		// Rebuild stacked type series; honour legend filter
		instance.data.datasets = next.datasets.map((ds) => ({
			...ds,
			hidden: hidden.includes(ds.label)
		}));
		applyDriverBarTheme(instance);
		instance.update('none');
	});

	$effect(() => {
		theme.isDark;
		if (chartInstance) {
			applyChartTheme(chartInstance);
		}
		if (typeOverTimeChart) {
			applyTypeOverTimeChartTheme(typeOverTimeChart);
		}
		if (actionStatusChart) {
			applyActionStatusBarTheme(actionStatusChart);
		}
		if (driverChart) {
			applyDriverBarTheme(driverChart);
		}
	});

	// Summary stats honour the selected period (header time picker)
	const totalIncidents = $derived(periodIncidents.length);

	/**
	 * Resolved = resolution status is "Resolved" AND a responded date is set.
	 * Unresolved = anything that does not meet both conditions.
	 */
	function isIncidentResolved(incident: Incident): boolean {
		const actionStatus = (incident.action ?? '').trim().toUpperCase();
		const actionStatusIsResolved = actionStatus === 'RESOLVED';
		const hasRespondedDate = Boolean(normalizeDateOnly(incident.dateResponse));
		return actionStatusIsResolved && hasRespondedDate;
	}

	const resolvedIncidents = $derived(periodIncidents.filter(isIncidentResolved).length);
	const unresolvedIncidents = $derived(totalIncidents - resolvedIncidents);
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

<div class="flex-1 flex flex-col bg-warm-50 text-warm-900 overflow-hidden">
	<header class="border-b border-warm-200 bg-white/80 px-4 py-3 backdrop-blur flex-shrink-0">
		<!-- Period sits immediately to the right of the title block (not page right-aligned) -->
		<div class="flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
			<div class="flex min-w-0 items-start gap-2">
				<CourierTruckIcon />
				<div class="min-w-0">
					<h1 class="text-xl font-bold text-warm-800">Dashboard</h1>
					<p class="mt-0.5 text-sm text-warm-500">Overview of incident tracking metrics</p>
				</div>
			</div>
			{#if !data.loadError && !incidentStore.isLoading && !incidentStore.error}
				<span
					class="hidden h-9 w-px shrink-0 self-center bg-warm-300/70 dark:bg-warm-400/50 sm:block"
					aria-hidden="true"
				></span>
				<div class="flex flex-wrap items-center gap-2.5">
					<label class="flex items-center gap-2 text-[0.9625rem] text-warm-600">
						<span class="font-medium text-warm-700">Period</span>
						<select
							value={timeRange}
							onchange={onPeriodSelectChange}
							class="max-w-[17.6rem] rounded-lg border border-warm-200 bg-white px-[0.6875rem] py-[0.4125rem] text-[0.9625rem] text-warm-700 shadow-sm input-focus dark:bg-warm-200"
							aria-controls="over-time-chart-canvas"
							aria-label="Time period for dashboard summary and charts"
							title="Relative period or a calendar month with incident data"
						>
							<optgroup label="Relative">
								{#each TIME_RANGE_OPTIONS as opt (opt.value)}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</optgroup>
							{#if availableMonths.length > 0}
								<optgroup label="Months with data">
									{#each availableMonths as m (m.value)}
										<option value={m.value}
											>{formatMonthYearLabel(m.ym)} ({m.count})</option
										>
									{/each}
								</optgroup>
							{/if}
						</select>
					</label>
					<span class="text-[0.825rem] text-warm-500">{timeRangeLabel}</span>
					<p
						class="max-w-xl text-[0.825rem] leading-snug text-warm-500"
						title="Dashboard charts, tables, and map exclude these rows"
					>
						Dashboard data ignores records with no reference number and duplicates.
					</p>
				</div>
			{/if}
		</div>
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
		<div class="flex-1 overflow-auto">
			<div class="w-full px-3 py-3 sm:px-4">
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
						<!-- Total KPI — same vertical stack as Unresolved / Resolved -->
						<section
							class="flex flex-col justify-between gap-1.5 rounded-md border border-warm-200 bg-white px-3 py-3 shadow-sm dark:bg-warm-100 lg:col-span-2"
							aria-labelledby="total-incidents-title"
							aria-describedby="total-incidents-tip"
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
										title="{resolvedPct}% of period is resolved (status Resolved + Date Responded)"
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
								</p>
							</div>
						</section>

						<!-- Unresolved -->
						<section
							class="flex flex-col justify-between gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 shadow-sm dark:border-amber-600/50 dark:bg-amber-950/30 lg:col-span-2"
							aria-labelledby="unresolved-callout-title"
							aria-describedby="unresolved-callout-tip"
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
								Not fully closed — status is not <span class="font-semibold">Resolved</span>, or
								<span class="font-semibold">Date Responded</span> is missing.
							</p>
						</section>

						<!-- Resolved -->
						<section
							class="flex flex-col justify-between gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-3 shadow-sm dark:border-emerald-600/50 dark:bg-emerald-950/30 lg:col-span-2"
							aria-labelledby="resolved-callout-title"
							aria-describedby="resolved-callout-tip"
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
								Status is <span class="font-semibold">Resolved</span> and a
								<span class="font-semibold">Date Responded</span> is set.
							</p>
						</section>

						<!-- Resolution status chart (6.5rem + 10% ≈ 7.15rem) -->
						<section
							class="col-span-2 flex min-h-0 flex-col rounded-md border border-warm-200 bg-white px-2.5 py-2 shadow-sm dark:bg-warm-100 lg:col-span-6"
							aria-labelledby="action-status-bar-title"
							aria-describedby="action-status-bar-summary"
						>
							<div class="mb-0.5 flex flex-wrap items-baseline justify-between gap-1">
								<h2
									id="action-status-bar-title"
									class="text-[11px] font-semibold uppercase tracking-wide text-warm-700"
								>
									By Resolution Status
								</h2>
								<p class="text-[10px] text-warm-500">{timeRangeLabel}</p>
							</div>
							<p id="action-status-bar-summary" class="sr-only">{actionStatusAriaLabel}</p>
							<div
								class="w-full min-h-0 overflow-visible"
								style="position: relative; height: 7.15rem; min-height: 7.15rem;"
							>
								{#if !hasActionStatusData}
									<div class="flex h-full items-center justify-center">
										<p class="text-[10px] text-warm-500">No resolution status data.</p>
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
										{#each incidentsByActionStatus as [label, count] (label)}
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
				<!-- Three equal cards: shared header/plot/footer heights so the row lines up. -->
				<div class="dashboard-chart-row grid grid-cols-1 gap-2 lg:grid-cols-3 lg:items-stretch">
					<section
						class="dashboard-chart-card min-w-0 rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4"
						aria-labelledby="over-time-chart-title"
					>
						<div class="dashboard-chart-header">
							<h2 class="text-sm font-semibold text-warm-800" id="over-time-chart-title">
								Incidents Over Time
							</h2>
							<p class="dashboard-chart-meta text-xs text-warm-500">{timeRangeLabel}</p>
						</div>
						<div class="dashboard-chart-plot relative w-full">
							{#if incidentsByDate.length === 0}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-warm-500">No incidents in this period.</p>
								</div>
							{/if}
							<canvas
								id="over-time-chart-canvas"
								bind:this={canvasElement}
								class={incidentsByDate.length === 0 ? 'hidden' : 'block h-full w-full'}
							></canvas>
						</div>
						<div class="dashboard-chart-footer" aria-hidden="true"></div>
					</section>

					<section
						class="dashboard-chart-card min-w-0 rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4"
						aria-labelledby="type-over-time-chart-title"
						aria-describedby="type-over-time-chart-summary"
					>
						<div class="dashboard-chart-header">
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<h2 class="text-sm font-semibold text-warm-800" id="type-over-time-chart-title">
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
									aria-label="Incident type legend for {typeOverTimeChartData.periodLabel}. Click to show or hide a series."
								>
									{#each typeOverTimeChartData.datasets as ds (`${ds.label}-${ds.total}-${timeRange}`)}
										{@const visible = isLegendVisible(hiddenTypeOverTimeLabels, ds.label)}
										<li>
											<button
												type="button"
												class="dashboard-legend-btn flex max-w-full items-center gap-1 text-[12px] leading-tight text-warm-600 {visible
													? ''
													: 'opacity-40 line-through'}"
												aria-pressed={visible}
												title={visible
													? `Hide ${ds.label} on chart`
													: `Show ${ds.label} on chart`}
												onclick={() => toggleTypeOverTimeLegend(ds.label)}
											>
												<span
													class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
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

					<section
						class="dashboard-chart-card min-w-0 overflow-hidden rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4"
						aria-labelledby="driver-chart-title"
						aria-describedby="driver-chart-summary"
					>
						<div class="dashboard-chart-header">
							<h2 class="text-sm font-semibold text-warm-800" id="driver-chart-title">
								Incidents by Driver
							</h2>
							<p class="dashboard-chart-meta text-xs text-warm-500">
								{timeRangeLabel} · stacked by type
							</p>
						</div>
						<p id="driver-chart-summary" class="sr-only">{driverChartAriaLabel}</p>
						<div class="dashboard-chart-plot relative w-full">
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
						<div class="dashboard-chart-footer">
							{#if hasDriverData}
								<ul
									class="flex flex-wrap gap-x-1.5 gap-y-1"
									aria-label="Incident type legend for {driverStackedBarData.periodLabel}. Click to show or hide a series."
								>
									{#each driverStackedBarData.datasets as ds (`${ds.label}-${ds.total}-${timeRange}`)}
										{@const visible = isLegendVisible(hiddenDriverTypeLabels, ds.label)}
										<li>
											<button
												type="button"
												class="dashboard-legend-btn flex max-w-full items-center gap-1 text-[12px] leading-tight text-warm-600 {visible
													? ''
													: 'opacity-40 line-through'}"
												aria-pressed={visible}
												title={visible
													? `Hide ${ds.label} on chart`
													: `Show ${ds.label} on chart`}
												onclick={() => toggleDriverTypeLegend(ds.label)}
											>
												<span
													class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
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
				</div>

				<!-- Driver × month tally + NSW map side by side (period filter applies to table) -->
				<div
					class="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:items-stretch"
				>
					<section
						class="flex min-h-0 min-w-0 flex-col rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4 dark:bg-warm-100"
						aria-labelledby="driver-month-tally-title"
						aria-describedby="driver-month-tally-summary"
					>
						<div class="mb-2 flex flex-wrap items-start justify-between gap-2">
							<div class="min-w-0">
								<h2
									id="driver-month-tally-title"
									class="text-sm font-semibold text-warm-800"
								>
									Incidents by Driver per Month
								</h2>
								<p class="mt-0.5 text-xs text-warm-500">
									<span class="inline-flex items-center gap-1">
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-3.5 w-3.5 shrink-0 text-accent-600"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
											/>
										</svg>
										Click a count to view those incidents
									</span>
								</p>
							</div>
							<p class="text-xs text-warm-500">{driverMonthTally.periodLabel}</p>
						</div>
						<p id="driver-month-tally-summary" class="sr-only">{driverMonthTallyAriaLabel}</p>

						{#if !hasDriverMonthTally}
							<p class="flex flex-1 items-center justify-center py-6 text-center text-sm text-warm-500">
								No incidents in this period.
							</p>
						{:else}
							<div
								class="min-h-0 flex-1 overflow-auto rounded-md border border-warm-200 max-h-[min(32.5rem,60vh)] lg:max-h-none lg:min-h-[25rem]"
							>
								<table class="w-full min-w-[20rem] border-collapse text-left text-sm">
									<thead class="sticky top-0 z-10 border-b border-warm-200 bg-warm-50 dark:bg-warm-200">
										<tr>
											<th
												scope="col"
												class="sticky left-0 z-20 bg-warm-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-warm-600 dark:bg-warm-200"
											>
												Driver
											</th>
											{#each driverMonthTally.monthLabels as label, i (driverMonthTally.months[i])}
												<th
													scope="col"
													class="px-2 py-2 text-center text-xs font-semibold tabular-nums text-warm-600 whitespace-nowrap"
													title={formatMonthYearLabel(driverMonthTally.months[i] ?? '')}
												>
													{label}
												</th>
											{/each}
											{#if showDriverMonthTotals}
												<th
													scope="col"
													class="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-warm-700"
												>
													Total
												</th>
											{/if}
										</tr>
									</thead>
									<tbody class="divide-y divide-warm-100">
										{#each driverMonthTally.rows as row (row.key)}
											<tr class="hover:bg-warm-50/80 dark:hover:bg-warm-200/40">
												<th
													scope="row"
													class="sticky left-0 z-[1] bg-white px-3 py-1.5 font-medium text-warm-800 dark:bg-warm-100"
												>
													{row.label}
												</th>
												{#each row.counts as count, i (`${row.key}-${driverMonthTally.months[i] ?? i}`)}
													<td
														class="px-1.5 py-1.5 text-center tabular-nums {count === 0
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
																class="inline-flex min-h-8 min-w-[2.5rem] items-center justify-center rounded-full border border-accent-200 bg-accent-100 px-2.5 py-1 text-sm font-semibold tabular-nums text-accent-700 shadow-sm transition hover:border-accent-500 hover:bg-accent-200 hover:text-accent-700 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 active:scale-[0.97] dark:border-accent-200 dark:bg-accent-200 dark:text-accent-600 dark:hover:border-accent-500 dark:hover:bg-accent-200"
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
														class="px-3 py-1.5 text-center font-semibold tabular-nums text-warm-900"
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
												class="sticky left-0 z-[1] bg-warm-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-warm-700 dark:bg-warm-200"
											>
												All drivers
											</th>
											{#each driverMonthTally.monthTotals as total, i (driverMonthTally.months[i])}
												<td
													class="px-2 py-2 text-center text-xs font-semibold tabular-nums text-warm-800"
												>
													{total === 0 ? '—' : total}
												</td>
											{/each}
											{#if showDriverMonthTotals}
												<td
													class="px-3 py-2 text-center text-sm font-bold tabular-nums text-warm-900"
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

					<div class="flex min-h-0 min-w-0 flex-col">
						<div class="min-h-0 flex-1 [&_.map-chart-shell]:h-full">
							<NswIncidentMap
								incidents={periodIncidents}
								periodLabel={timeRangeLabel}
								onPersistCoords={async (updates) => {
									await incidentStore.persistLocationCoords(updates);
								}}
							/>
						</div>
					</div>
				</div>
				</section>
			</div>
		</div>
	{/if}

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
													class="inline-block max-w-full break-words rounded-full border px-2 py-0.5 text-xs font-medium {getTypePillClass(
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

	/* Plot height: 21.06rem + 10% = 23.166rem */
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

	/* +10px so multi-line type legends are not clipped */
	:global(.dashboard-chart-footer) {
		flex: 0 0 calc(2.85rem + 10px);
		min-height: calc(2.85rem + 10px);
		max-height: calc(2.85rem + 10px);
		margin-top: 0.35rem;
		overflow: hidden;
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
