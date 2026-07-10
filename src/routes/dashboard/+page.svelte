<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { incidentStore } from '$lib/data/store.svelte';
	import { formatDate } from '$lib/formatDate';
	import {
		incidentsFromPageData,
		syncIncidentStoreFromPageData
	} from '$lib/syncIncidentStore';
	import CourierTruckIcon from '$lib/components/CourierTruckIcon.svelte';
	import { theme } from '$lib/theme.svelte';
	import type { Chart as ChartJS, ChartOptions } from 'chart.js';
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
	const CHART_FALLBACKS = {
		light: {
			accent: '#0072B2',
			ticks: '#3a3b3d',
			legend: '#181818',
			grid: '#9a9d9e',
			pointBorder: '#ffffff'
		},
		dark: {
			accent: '#56B4E9',
			ticks: '#e0e2e2',
			legend: '#f8f8f8',
			grid: '#6e7072',
			pointBorder: '#1e1f21'
		}
	} as const;

	/**
	 * Categorical series palette (Okabe–Ito + Paul Tol extensions).
	 * Distinct hues for pie slices and multi-line type series — avoids the old
	 * teal/grey ramp that was hard to tell apart.
	 */
	const SERIES_PALETTE_LIGHT = [
		'#0072B2', // blue
		'#D55E00', // vermillion
		'#009E73', // bluish green
		'#CC79A7', // reddish purple
		'#E69F00', // orange
		'#56B4E9', // sky blue
		'#882255', // wine
		'#117733', // forest
		'#332288', // indigo
		'#AA4499', // purple
		'#44AA99', // teal (separated from greys)
		'#999933', // olive
		'#661100', // brown
		'#6699CC', // soft blue
		'#AA4466' // rose
	] as const;

	/** Brighter variants for dark cards (same hue order as light). */
	const SERIES_PALETTE_DARK = [
		'#56B4E9', // sky
		'#FF7A45', // bright vermillion
		'#33D4A0', // bright green
		'#F0A0D0', // pink
		'#FFC14D', // gold
		'#7DD3FC', // light blue
		'#F472B6', // hot pink
		'#4ADE80', // lime green
		'#A5B4FC', // periwinkle
		'#E879F9', // fuchsia
		'#2DD4BF', // cyan
		'#FDE047', // yellow
		'#FB923C', // orange
		'#93C5FD', // pale blue
		'#FDA4AF' // rose
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
			// Clearer grid than the previous 25% wash
			grid: withAlpha(fallbacks.grid, isDark ? 0.45 : 0.55),
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

	/** High-contrast colour for the n-th series / pie slice (0-based). */
	function getSeriesColor(index: number, isDark = isDarkMode()): string {
		const palette = isDark ? SERIES_PALETTE_DARK : SERIES_PALETTE_LIGHT;
		if (index < palette.length) return palette[index];

		// Beyond palette: spaced hues at strong saturation (still readable)
		const hue = (index * 47 + 12) % 360;
		const sat = isDark ? 0.72 : 0.68;
		const light = isDark ? 0.62 : 0.42;
		const [r, g, b] = hslToRgb(hue, sat, light);
		return rgbToHex(r, g, b);
	}

	function buildChartOptions(colors: ReturnType<typeof getChartTheme>): ChartOptions<'line'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
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
				// Global datalabels plugin is for pie charts only
				datalabels: {
					display: false
				}
			},
			scales: {
				y: {
					beginAtZero: true,
					ticks: {
						color: colors.ticks,
						stepSize: 1,
						font: { size: 12, weight: 500 }
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
			interaction: {
				mode: 'index',
				intersect: false
			},
			plugins: {
				legend: {
					display: true,
					position: 'bottom',
					labels: {
						usePointStyle: true,
						font: { size: 12, weight: 500 },
						color: colors.legend,
						boxWidth: 10,
						padding: 14
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
							const name = context.dataset.label ?? 'Type';
							const y = context.parsed.y ?? 0;
							return `${name}: ${y} ${y === 1 ? 'incident' : 'incidents'}`;
						}
					}
				},
				datalabels: {
					display: false
				}
			},
			scales: {
				y: {
					beginAtZero: true,
					stacked: false,
					ticks: {
						color: colors.ticks,
						stepSize: 1,
						font: { size: 12, weight: 500 }
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
		chart.data.datasets.forEach((dataset, index) => {
			const stroke = getSeriesColor(index, isDark);
			dataset.borderColor = stroke;
			dataset.backgroundColor = withAlpha(stroke, 0.06);
			dataset.pointBackgroundColor = stroke;
			dataset.pointBorderColor = colors.pointBorder;
			dataset.borderWidth = 2.5;
			dataset.pointRadius = 4;
			dataset.pointHoverRadius = 6;
			dataset.pointBorderWidth = 2;
		});
		if (chart.options?.plugins?.legend?.labels) {
			chart.options.plugins.legend.labels.color = colors.legend;
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

	function aggregateIncidentsBy(field: 'teamLeader' | 'driver', emptyLabel = 'Unassigned') {
		const grouped = new Map<string, { label: string; count: number }>();

		incidents.forEach((incident) => {
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

	function getPieLegendPosition(sliceCount: number): 'bottom' | 'right' {
		return sliceCount > 6 ? 'right' : 'bottom';
	}

	function getPieChartHeightClass(sliceCount: number): string {
		if (sliceCount > 10) return 'h-[28rem]';
		if (sliceCount > 6) return 'h-96';
		return 'h-72';
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

	function buildPieChartOptions(
		colors: ReturnType<typeof getChartTheme>,
		sliceCount = 0
	): ChartOptions<'pie'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			layout: {
				// Room for in-slice labels without crowding the legend
				padding: 8
			},
			plugins: {
				// HTML card heading is the only chart title — never draw a Chart.js title
				title: {
					display: false
				},
				legend: {
					display: true,
					position: getPieLegendPosition(sliceCount),
					labels: {
						usePointStyle: true,
						font: { size: 13, weight: 500 },
						color: colors.legend,
						padding: 16,
						boxWidth: 12
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
				// Always-visible count + % on every non-zero slice (no hover required)
				datalabels: {
					display: (context) => {
						const raw = context.dataset.data[context.dataIndex];
						const value = typeof raw === 'number' ? raw : 0;
						// Skip empty slices only; all positive slices get labels
						return value > 0;
					},
					// Prefer center of slice; plugin may auto-adjust when clamp is on
					anchor: 'center',
					align: 'center',
					offset: 0,
					formatter: (value, context) => {
						const num = typeof value === 'number' ? value : 0;
						const total = sumNumericData(context.dataset.data as unknown[]);
						const percentage = total > 0 ? Math.round((num / total) * 100) : 0;
						return `${num}\n(${percentage}%)`;
					},
					color: (context) => {
						const bg = Array.isArray(context.dataset.backgroundColor)
							? context.dataset.backgroundColor[context.dataIndex]
							: context.dataset.backgroundColor;
						return contrastOnHex(typeof bg === 'string' ? bg : '#0072B2', isDarkMode());
					},
					font: (context) => {
						// Slightly smaller type when many slices share the ring
						const sliceCount = context.dataset.data?.length ?? 0;
						return {
							size: sliceCount > 8 ? 11 : 12,
							weight: 'bold' as const
						};
					},
					textAlign: 'center',
					// Stronger halo so labels stay readable on saturated slices
					textStrokeColor: (context) => {
						const bg = Array.isArray(context.dataset.backgroundColor)
							? context.dataset.backgroundColor[context.dataIndex]
							: context.dataset.backgroundColor;
						const fg = contrastOnHex(typeof bg === 'string' ? bg : '#0072B2', isDarkMode());
						return fg === '#f8f8f8' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)';
					},
					textStrokeWidth: 3,
					clamp: true,
					clip: false
				}
			}
		};
	}

	function applyPieChartTheme(chart: ChartJS<'pie'>, sliceCount = chart.data.labels?.length ?? 0) {
		const colors = getChartTheme(theme.isDark);
		const sliceBorder = getPieSliceBorder(theme.isDark);
		const dataset = chart.data.datasets[0];
		if (!dataset) return;

		dataset.backgroundColor =
			chart.data.labels?.map((_, index) => getSeriesColor(index, theme.isDark)) ?? [];
		dataset.borderColor = chart.data.labels?.map(() => sliceBorder) ?? sliceBorder;
		dataset.borderWidth = 3;

		if (chart.options?.plugins?.legend) {
			chart.options.plugins.legend.position = getPieLegendPosition(sliceCount);
			if (chart.options.plugins.legend.labels) {
				chart.options.plugins.legend.labels.color = colors.legend;
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
		}

		chart.update('none');
	}

	let { data } = $props();

	const incidents = $derived(incidentsFromPageData(incidentStore.list, data.incidents));

	let canvasElement: HTMLCanvasElement | undefined = $state();
	let typeOverTimeCanvas: HTMLCanvasElement | undefined = $state();
	let teamLeaderCanvas: HTMLCanvasElement | undefined = $state();
	let driverCanvas: HTMLCanvasElement | undefined = $state();
	let chartInstance = $state<ChartJS<'line'> | undefined>();
	let typeOverTimeChart = $state<ChartJS<'line'> | undefined>();
	let teamLeaderChart = $state<ChartJS<'pie'> | undefined>();
	let driverChart = $state<ChartJS<'pie'> | undefined>();
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

	/** Relative window for the over-time line charts (user-selectable). */
	type TimeRangeKey = 'all' | '7' | '30' | '90';

	const TIME_RANGE_OPTIONS: { value: TimeRangeKey; label: string }[] = [
		{ value: 'all', label: 'All time' },
		{ value: '90', label: 'Last 90 days' },
		{ value: '30', label: 'Last 30 days' },
		{ value: '7', label: 'Last 7 days' }
	];

	let timeRange = $state<TimeRangeKey>('30');

	const timeRangeLabel = $derived(
		TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label ?? 'Last 30 days'
	);

	/**
	 * Inclusive calendar window ending today (local).
	 * e.g. last 7 days = today and the previous 6 calendar days.
	 * `all` → no lower bound.
	 */
	function isDateReceivedInTimeRange(dateStr: string, range: TimeRangeKey, now = new Date()): boolean {
		const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr?.trim() ?? '');
		if (!match) return false;
		const year = parseInt(match[1], 10);
		const month = parseInt(match[2], 10);
		const day = parseInt(match[3], 10);
		const received = new Date(year, month - 1, day);
		if (Number.isNaN(received.getTime())) return false;

		const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
		if (received > end) return false;

		if (range === 'all') return true;

		const days = parseInt(range, 10);
		if (!Number.isFinite(days) || days < 1) return true;

		const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		start.setDate(start.getDate() - (days - 1));
		start.setHours(0, 0, 0, 0);
		return received >= start;
	}

	// Group incidents by date and count them (filtered by selected relative period)
	const incidentsByDate = $derived.by(() => {
		const grouped: Record<string, number> = {};
		const range = timeRange;

		incidents.forEach((incident) => {
			const date = incident.dateReceived;
			if (!isDateReceivedInTimeRange(date, range)) return;
			grouped[date] = (grouped[date] || 0) + 1;
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
	 */
	const typeOverTimeChartData = $derived.by(() => {
		const dateKeys = incidentsByDate.map(([date]) => date);
		const dateSet = new Set(dateKeys);

		// Stable type keys → display labels (types seen on those dates)
		const typeMeta = new Map<string, string>();
		/** typeKey → date → count */
		const counts = new Map<string, Map<string, number>>();

		for (const incident of incidents) {
			const date = incident.dateReceived;
			if (!dateSet.has(date)) continue;
			const { key, label } = normalizeAggregationKey(incident.type, 'Unspecified');
			if (!typeMeta.has(key)) {
				typeMeta.set(key, label);
				counts.set(key, new Map(dateKeys.map((d) => [d, 0])));
			}
			const byDate = counts.get(key)!;
			byDate.set(date, (byDate.get(date) ?? 0) + 1);
		}

		const sortedTypes = [...typeMeta.entries()].sort((a, b) =>
			a[1].localeCompare(b[1], undefined, { sensitivity: 'base' })
		);

		return {
			labels: dateKeys.map((date) => formatDate(date)),
			/** Raw rows for sr-only table: [typeLabel, counts per date...] */
			tableRows: sortedTypes.map(([key, label]) => ({
				label,
				counts: dateKeys.map((d) => counts.get(key)?.get(d) ?? 0)
			})),
			dateKeys,
			datasets: sortedTypes.map(([key, label]) => ({
				label,
				data: dateKeys.map((d) => counts.get(key)?.get(d) ?? 0),
				borderWidth: 2,
				fill: false,
				tension: 0.35,
				pointRadius: 3,
				pointBorderWidth: 2,
				pointHoverRadius: 5
			}))
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

	const incidentsByTeamLeader = $derived.by(() => aggregateIncidentsBy('teamLeader'));
	const incidentsByDriver = $derived.by(() => aggregateIncidentsBy('driver'));

	const teamLeaderChartData = $derived.by(() => buildPieChartData(incidentsByTeamLeader));
	const driverChartData = $derived.by(() => buildPieChartData(incidentsByDriver));

	const hasTeamLeaderData = $derived(incidentsByTeamLeader.length > 0);
	const hasDriverData = $derived(incidentsByDriver.length > 0);

	const teamLeaderChartAriaLabel = $derived(buildChartAriaLabel('Incidents by Team Leader', incidentsByTeamLeader));
	const driverChartAriaLabel = $derived(buildChartAriaLabel('Incidents by Driver', incidentsByDriver));

	const teamLeaderChartHeightClass = $derived(getPieChartHeightClass(incidentsByTeamLeader.length));
	const driverChartHeightClass = $derived(getPieChartHeightClass(incidentsByDriver.length));

	onMount(() => {
		resizeHandler = () => {
			chartInstance?.resize();
			typeOverTimeChart?.resize();
			teamLeaderChart?.resize();
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
		const initialData = untrack(() => ({
			labels: typeOverTimeChartData.labels,
			datasets: typeOverTimeChartData.datasets.map((ds) => ({ ...ds }))
		}));
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
		const canvas = teamLeaderCanvas;
		if (!canvas || !hasTeamLeaderData) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => teamLeaderChartData);
		const sliceCount = untrack(() => incidentsByTeamLeader.length);
		const instance = new Chart(canvas, {
			type: 'pie',
			data: initialData,
			options: buildPieChartOptions(colors, sliceCount)
		});
		applyPieChartTheme(instance, sliceCount);
		teamLeaderChart = instance;

		return () => {
			instance.destroy();
			teamLeaderChart = undefined;
		};
	});

	$effect(() => {
		if (incidentStore.isLoading || incidentStore.error || data.loadError) return;
		const canvas = driverCanvas;
		if (!canvas || !hasDriverData) return;

		const colors = untrack(() => getChartTheme(theme.isDark));
		const initialData = untrack(() => driverChartData);
		const sliceCount = untrack(() => incidentsByDriver.length);
		const instance = new Chart(canvas, {
			type: 'pie',
			data: initialData,
			options: buildPieChartOptions(colors, sliceCount)
		});
		applyPieChartTheme(instance, sliceCount);
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
		instance.data.labels = next.labels;
		// Rebuild datasets so type set can grow/shrink without stale series
		instance.data.datasets = next.datasets.map((ds) => ({ ...ds }));
		applyTypeOverTimeChartTheme(instance);
	});

	$effect(() => {
		const instance = teamLeaderChart;
		const dataset = instance?.data.datasets[0];
		if (!instance || !dataset) return;
		instance.data.labels = teamLeaderChartData.labels;
		dataset.data = teamLeaderChartData.datasets[0].data;
		applyPieChartTheme(instance, incidentsByTeamLeader.length);
	});

	$effect(() => {
		const instance = driverChart;
		const dataset = instance?.data.datasets[0];
		if (!instance || !dataset) return;
		instance.data.labels = driverChartData.labels;
		dataset.data = driverChartData.datasets[0].data;
		applyPieChartTheme(instance, incidentsByDriver.length);
	});

	$effect(() => {
		teamLeaderChartHeightClass;
		teamLeaderChart?.resize();
	});

	$effect(() => {
		driverChartHeightClass;
		driverChart?.resize();
	});

	$effect(() => {
		theme.isDark;
		if (chartInstance) {
			applyChartTheme(chartInstance);
		}
		if (typeOverTimeChart) {
			applyTypeOverTimeChartTheme(typeOverTimeChart);
		}
		if (teamLeaderChart) {
			applyPieChartTheme(teamLeaderChart, incidentsByTeamLeader.length);
		}
		if (driverChart) {
			applyPieChartTheme(driverChart, incidentsByDriver.length);
		}
	});

	// Calculate stats
	const totalIncidents = $derived(incidents.length);
	const incidentsThisMonth = $derived(
		incidents.filter((i) => {
			const date = new Date(i.dateReceived);
			const now = new Date();
			return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
		}).length
	);
	const incidentsThisWeek = $derived(
		incidents.filter((i) => {
			const date = new Date(i.dateReceived);
			const now = new Date();
			const weekAgo = new Date(now);
			weekAgo.setDate(weekAgo.getDate() - 7);
			return date >= weekAgo;
		}).length
	);
</script>

<svelte:head>
	<title>Dashboard | Incident Tracker</title>
</svelte:head>

<div class="flex-1 flex flex-col bg-warm-50 text-warm-900 overflow-hidden">
	<header class="border-b border-warm-200 bg-white/80 px-6 py-5 backdrop-blur flex-shrink-0">
		<div class="flex w-full min-w-0 items-start gap-3">
			<CourierTruckIcon />
			<div class="min-w-0">
				<h1 class="text-2xl font-bold text-warm-800">Dashboard</h1>
				<p class="mt-1 text-sm text-warm-500">Overview of incident tracking metrics</p>
			</div>
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
			<div class="w-full px-6 py-6">
				<!-- Stats Cards -->
				<div class="grid grid-cols-3 gap-4 mb-8">
					<div class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
						<p class="text-sm font-medium text-warm-600 mb-2">Total Incidents</p>
						<p class="text-3xl font-bold text-accent-600">{totalIncidents}</p>
						<p class="mt-2 text-xs text-warm-500">All records in database</p>
					</div>
					<div class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
						<p class="text-sm font-medium text-warm-600 mb-2">This Month</p>
						<p class="text-3xl font-bold text-warm-800">{incidentsThisMonth}</p>
						<p class="mt-2 text-xs text-warm-500">Current calendar month</p>
					</div>
					<div class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
						<p class="text-sm font-medium text-warm-600 mb-2">This Week</p>
						<p class="text-3xl font-bold text-warm-700">{incidentsThisWeek}</p>
						<p class="mt-2 text-xs text-warm-500">Last 7 days</p>
					</div>
				</div>

				<!-- Time-series charts: total volume + type breakdown -->
				<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
					<section
						class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm"
						aria-labelledby="over-time-chart-title"
					>
						<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
							<h2 class="text-lg font-semibold text-warm-800" id="over-time-chart-title">
								Incidents Over Time
							</h2>
							<label class="flex items-center gap-2 text-sm text-warm-600">
								<span class="sr-only">Time period for incidents over time</span>
								<select
									bind:value={timeRange}
									class="rounded-lg border border-warm-200 bg-warm-50 px-3 py-1.5 text-sm text-warm-700 input-focus dark:bg-warm-200"
									aria-controls="over-time-chart-canvas"
								>
									{#each TIME_RANGE_OPTIONS as opt (opt.value)}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</label>
						</div>
						<p class="mb-3 text-xs text-warm-500">{timeRangeLabel}</p>
						<div class="h-96 w-full" style="position: relative; min-height: 400px;">
							{#if incidentsByDate.length === 0}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-warm-500">No incidents in this period.</p>
								</div>
							{/if}
							<canvas
								id="over-time-chart-canvas"
								bind:this={canvasElement}
								class={incidentsByDate.length === 0 ? 'hidden' : 'block h-full w-full'}
								style="max-height: 100%;"
							></canvas>
						</div>
					</section>

					<section
						class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm"
						aria-labelledby="type-over-time-chart-title"
						aria-describedby="type-over-time-chart-summary"
					>
						<div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
							<h2 class="text-lg font-semibold text-warm-800" id="type-over-time-chart-title">
								Incidents by Type Over Time
							</h2>
							<p class="text-xs text-warm-500">{timeRangeLabel}</p>
						</div>
						<p id="type-over-time-chart-summary" class="sr-only">{typeOverTimeAriaLabel}</p>
						<div class="h-96 w-full" style="position: relative; min-height: 400px;">
							{#if !hasTypeOverTimeData}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-warm-500">No incident type data available.</p>
								</div>
							{/if}
							<canvas
								bind:this={typeOverTimeCanvas}
								class={!hasTypeOverTimeData ? 'hidden' : 'block h-full w-full'}
								style="max-height: 100%;"
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
					</section>
				</div>

				<!-- Pie Charts -->
				<div class="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
					<section
						class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm"
						aria-labelledby="team-leader-chart-title"
						aria-describedby="team-leader-chart-summary"
					>
						<h2 class="mb-4 text-lg font-semibold text-warm-800" id="team-leader-chart-title">
							Incidents by Team Leader
						</h2>
						<p id="team-leader-chart-summary" class="sr-only">{teamLeaderChartAriaLabel}</p>
						<div class="{teamLeaderChartHeightClass} w-full" style="position: relative;">
							{#if incidentsByTeamLeader.length === 0}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-warm-500">No incident data available.</p>
								</div>
							{/if}
							<canvas
								bind:this={teamLeaderCanvas}
								class={incidentsByTeamLeader.length === 0 ? 'hidden' : 'block h-full w-full'}
								style="max-height: 100%;"
								aria-hidden="true"
							></canvas>
							<!-- Accessible data table (visually hidden); card h2 is the only visible title -->
							<table class="sr-only" aria-labelledby="team-leader-chart-title">
								<thead>
									<tr>
										<th scope="col">Team Leader</th>
										<th scope="col">Incidents</th>
									</tr>
								</thead>
								<tbody>
									{#each incidentsByTeamLeader as [label, count] (label)}
										<tr>
											<td>{label}</td>
											<td>{count}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</section>
					<section
						class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm"
						aria-labelledby="driver-chart-title"
						aria-describedby="driver-chart-summary"
					>
						<h2 class="mb-4 text-lg font-semibold text-warm-800" id="driver-chart-title">
							Incidents by Driver
						</h2>
						<p id="driver-chart-summary" class="sr-only">{driverChartAriaLabel}</p>
						<div class="{driverChartHeightClass} w-full" style="position: relative;">
							{#if incidentsByDriver.length === 0}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-warm-500">No incident data available.</p>
								</div>
							{/if}
							<canvas
								bind:this={driverCanvas}
								class={incidentsByDriver.length === 0 ? 'hidden' : 'block h-full w-full'}
								style="max-height: 100%;"
								aria-hidden="true"
							></canvas>
							<!-- Accessible data table (visually hidden); card h2 is the only visible title -->
							<table class="sr-only" aria-labelledby="driver-chart-title">
								<thead>
									<tr>
										<th scope="col">Driver</th>
										<th scope="col">Incidents</th>
									</tr>
								</thead>
								<tbody>
									{#each incidentsByDriver as [label, count] (label)}
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
			</div>
		</div>
	{/if}
</div>
