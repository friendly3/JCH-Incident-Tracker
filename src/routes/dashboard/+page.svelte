<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { incidentStore } from '$lib/data/store.svelte';
	import { formatDate, normalizeDateOnly } from '$lib/formatDate';
	import type { Incident } from '$lib/data/incidents';
	import { getActionStatusChartColor } from '$lib/pillClasses';
	import {
		incidentsFromPageData,
		syncIncidentStoreFromPageData
	} from '$lib/syncIncidentStore';
	import CourierTruckIcon from '$lib/components/CourierTruckIcon.svelte';
	import NswIncidentMap from '$lib/components/NswIncidentMap.svelte';
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

	/** Series colour by category label when special; otherwise palette by index. */
	function getChartCategoryColor(
		label: string | undefined | null,
		index: number,
		isDark = isDarkMode()
	): string {
		if (isUnassignedCategory(label)) return getUnassignedChartColor(isDark);
		return getSeriesColor(index, isDark);
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
		chart.data.datasets.forEach((dataset, index) => {
			// Unspecified / blank types always use medium gray (same as Unassigned)
			const stroke = getChartCategoryColor(dataset.label, index, isDark);
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
						font: { size: 10, weight: 500 },
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

		dataset.backgroundColor =
			chart.data.labels?.map((label, index) =>
				getChartCategoryColor(String(label), index, theme.isDark)
			) ?? [];
		dataset.borderColor = chart.data.labels?.map(() => sliceBorder) ?? sliceBorder;
		dataset.borderWidth = 3;

		if (chart.options?.plugins?.legend) {
			chart.options.plugins.legend.position = 'bottom';
			if (chart.options.plugins.legend.labels) {
				chart.options.plugins.legend.labels.color = colors.legend;
				chart.options.plugins.legend.labels.font = { size: 10, weight: 500 };
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

	/** Horizontal bar: incidents per action status. */
	function buildActionStatusBarOptions(
		colors: ReturnType<typeof getChartTheme>
	): ChartOptions<'bar'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			indexAxis: 'y',
			layout: {
				padding: { top: 4, right: 36, left: 4, bottom: 4 }
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
					titleFont: { size: 13, weight: 'bold' },
					bodyFont: { size: 12 },
					padding: 10,
					cornerRadius: 8,
					displayColors: true,
					callbacks: {
						label: (context) => {
							const value = context.parsed.x ?? 0;
							return `${value} ${value === 1 ? 'incident' : 'incidents'}`;
						}
					}
				},
				datalabels: {
					anchor: 'end',
					align: 'right',
					offset: 4,
					clamp: false,
					clip: false,
					display: (context) => {
						const raw = context.dataset.data[context.dataIndex];
						return typeof raw === 'number' && raw > 0;
					},
					formatter: (value: unknown) =>
						typeof value === 'number' && Number.isFinite(value) ? String(value) : '',
					color: colors.legend,
					font: { size: 12, weight: 'bold' },
					textStrokeColor: isDarkMode() ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)',
					textStrokeWidth: 3
				}
			},
			scales: {
				x: {
					beginAtZero: true,
					grace: '12%',
					ticks: {
						color: colors.ticks,
						stepSize: 1,
						precision: 0,
						font: { size: 11, weight: 500 }
					},
					grid: {
						color: colors.grid
					}
				},
				y: {
					ticks: {
						color: colors.ticks,
						font: { size: 12, weight: 600 }
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
		// 70% fill opacity; solid border keeps status colour readable
		dataset.backgroundColor = solid.map((c) => withAlpha(c, 0.7));
		dataset.borderColor = solid;
		dataset.borderWidth = 1.5;
		dataset.borderRadius = 4;
		dataset.barPercentage = 0.75;
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
		if (chart.options?.scales?.x?.ticks) {
			chart.options.scales.x.ticks.color = colors.ticks;
		}
		if (chart.options?.scales?.x?.grid) {
			chart.options.scales.x.grid.color = colors.grid;
		}
		if (chart.options?.scales?.y?.ticks) {
			chart.options.scales.y.ticks.color = colors.ticks;
		}
		chart.update('none');
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
							const total = items.reduce((sum, item) => {
								const v = item.parsed.x ?? 0;
								return sum + (typeof v === 'number' ? v : 0);
							}, 0);
							return total > 0 ? `Total: ${total}` : '';
						}
					}
				},
				// Dual labels via chartjs-plugin-datalabels v2 `labels` map:
				// - segment: type count inside each stack slice
				// - total: driver total outside the right end of the full bar
				datalabels: {
					labels: {
						segment: {
							anchor: 'center',
							align: 'center',
							clamp: true,
							clip: true,
							display: (context: { dataset: { data: unknown[] }; dataIndex: number }) => {
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
							// Only the topmost stack dataset draws the end total (once per bar)
							display: (context: {
								datasetIndex: number;
								chart: { data: { datasets: unknown[] } };
								dataset: { data: unknown[] };
								dataIndex: number;
							}) => {
								const last = context.chart.data.datasets.length - 1;
								if (context.datasetIndex !== last) return false;
								// Sum stack for this driver; hide if zero
								let sum = 0;
								for (const ds of context.chart.data.datasets as { data: unknown[] }[]) {
									const v = ds.data[context.dataIndex];
									if (typeof v === 'number' && Number.isFinite(v)) sum += v;
								}
								return sum > 0;
							},
							formatter: (
								_value: unknown,
								context: {
									dataIndex: number;
									chart: { data: { datasets: { data: unknown[] }[] } };
								}
							) => {
								let sum = 0;
								for (const ds of context.chart.data.datasets) {
									const v = ds.data[context.dataIndex];
									if (typeof v === 'number' && Number.isFinite(v)) sum += v;
								}
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

		chart.data.datasets.forEach((dataset, index) => {
			const typeLabel = String(dataset.label ?? '');
			const solid = getChartCategoryColor(typeLabel, index, isDark);
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

	/** Relative window for the over-time line charts (user-selectable). */
	type TimeRangeKey = 'all' | '7' | '30' | '90';

	const TIME_RANGE_OPTIONS: { value: TimeRangeKey; label: string }[] = [
		{ value: 'all', label: 'All time' },
		{ value: '90', label: 'Last 90 days' },
		{ value: '30', label: 'Last 30 days' },
		{ value: '7', label: 'Last 7 days' }
	];

	let timeRange = $state<TimeRangeKey>('all');

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
	 * Missing/blank types are bucketed as "Unspecified" (medium-gray series colour).
	 */
	const typeOverTimeChartData = $derived.by(() => {
		const dateKeys = incidentsByDate.map(([date]) => date);
		const dateSet = new Set(dateKeys);
		const dark = theme.isDark;

		// Stable type keys → display labels (types seen on those dates)
		const typeMeta = new Map<string, string>();
		/** typeKey → date → count */
		const counts = new Map<string, Map<string, number>>();

		for (const incident of incidents) {
			const date = incident.dateReceived;
			if (!dateSet.has(date)) continue;
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
			datasets: sortedTypes.map(([key, label], index) => {
				const color = getChartCategoryColor(label, index, dark);
				return {
					label,
					data: dateKeys.map((d) => counts.get(key)?.get(d) ?? 0),
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
			})
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

	/** Counts by action status (New, Resolved, LIT, …) — sorted high → low. */
	const incidentsByActionStatus = $derived.by(() => {
		const grouped = new Map<string, { label: string; count: number }>();
		for (const incident of incidents) {
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
		buildChartAriaLabel('Incidents by Action Status', incidentsByActionStatus)
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

		for (const incident of incidents) {
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
		const datasets = typeKeys.map((typeKey, index) => {
			const typeLabel = typeMeta.get(typeKey) ?? typeKey;
			const solid = getChartCategoryColor(typeLabel, index, dark);
			return {
				label: typeLabel,
				data: drivers.map((d) => d.types.get(typeKey) ?? 0),
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
		const initialData = untrack(() => ({
			labels: driverStackedBarData.labels,
			datasets: driverStackedBarData.datasets.map((ds) => ({ ...ds }))
		}));
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
		instance.data.labels = next.labels;
		// Rebuild datasets so type set can grow/shrink without stale series
		instance.data.datasets = next.datasets.map((ds) => ({ ...ds }));
		applyTypeOverTimeChartTheme(instance);
	});

	$effect(() => {
		const instance = actionStatusChart;
		const dataset = instance?.data.datasets[0];
		if (!instance || !dataset) return;
		instance.data.labels = actionStatusBarData.labels;
		dataset.data = actionStatusBarData.datasets[0].data;
		applyActionStatusBarTheme(instance);
	});

	$effect(() => {
		const instance = driverChart;
		if (!instance) return;
		const next = driverStackedBarData;
		instance.data.labels = next.labels;
		// Rebuild stacked type series when type set changes
		instance.data.datasets = next.datasets.map((ds) => ({ ...ds }));
		applyDriverBarTheme(instance);
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

	/**
	 * Resolved = action status is "Resolved" AND a responded date is set.
	 * Unresolved = anything that does not meet both conditions.
	 */
	function isIncidentResolved(incident: Incident): boolean {
		const actionStatus = (incident.action ?? '').trim().toUpperCase();
		const actionStatusIsResolved = actionStatus === 'RESOLVED';
		const hasRespondedDate = Boolean(normalizeDateOnly(incident.dateResponse));
		return actionStatusIsResolved && hasRespondedDate;
	}

	const resolvedIncidents = $derived(incidents.filter(isIncidentResolved).length);
	const unresolvedIncidents = $derived(incidents.length - resolvedIncidents);
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
		<div class="flex w-full min-w-0 items-start gap-2">
			<CourierTruckIcon />
			<div class="min-w-0">
				<h1 class="text-xl font-bold text-warm-800">Dashboard</h1>
				<p class="mt-0.5 text-sm text-warm-500">Overview of incident tracking metrics</p>
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
			<div class="w-full px-3 py-3 sm:px-4">
				<!-- Secondary stats (compact — less important than resolution callouts) -->
				<div class="mb-2 grid grid-cols-3 gap-1.5">
					<div class="rounded-md border border-warm-200 bg-white px-2.5 py-2 shadow-sm">
						<p class="text-[11px] font-medium uppercase tracking-wide text-warm-500">Total Incidents</p>
						<p class="mt-0.5 text-xl font-semibold tabular-nums text-accent-600">{totalIncidents}</p>
						<p class="mt-0.5 text-[10px] leading-tight text-warm-400">All records</p>
					</div>
					<div class="rounded-md border border-warm-200 bg-white px-2.5 py-2 shadow-sm">
						<p class="text-[11px] font-medium uppercase tracking-wide text-warm-500">This Month</p>
						<p class="mt-0.5 text-xl font-semibold tabular-nums text-warm-800">{incidentsThisMonth}</p>
						<p class="mt-0.5 text-[10px] leading-tight text-warm-400">Calendar month</p>
					</div>
					<div class="rounded-md border border-warm-200 bg-white px-2.5 py-2 shadow-sm">
						<p class="text-[11px] font-medium uppercase tracking-wide text-warm-500">This Week</p>
						<p class="mt-0.5 text-xl font-semibold tabular-nums text-warm-700">{incidentsThisWeek}</p>
						<p class="mt-0.5 text-[10px] leading-tight text-warm-400">Last 7 days</p>
					</div>
				</div>

				<!-- Resolution callouts + action status bar -->
				<div
					class="mb-3 grid grid-cols-1 gap-2 lg:grid-cols-12"
					role="group"
					aria-label="Incident resolution and action status summary"
				>
					<section
						class="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 shadow-sm dark:border-amber-600/50 dark:bg-amber-950/30 lg:col-span-3"
						aria-labelledby="unresolved-callout-title"
					>
						<div class="flex items-start justify-between gap-2">
							<div>
								<p
									id="unresolved-callout-title"
									class="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200"
								>
									Unresolved
								</p>
								<p class="mt-1 text-3xl font-bold tabular-nums text-amber-900 dark:text-amber-100">
									{unresolvedIncidents}
								</p>
								<p class="mt-1 text-xs leading-snug text-amber-800/90 dark:text-amber-200/90">
									Not fully closed — action status is not <span class="font-semibold">Resolved</span>,
									or responded date is missing
									{#if totalIncidents > 0}
										<span class="mt-0.5 block font-medium">{unresolvedPct}% of all incidents</span>
									{/if}
								</p>
							</div>
							<span
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100"
								aria-hidden="true"
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							</span>
						</div>
					</section>

					<section
						class="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3 shadow-sm dark:border-emerald-600/50 dark:bg-emerald-950/30 lg:col-span-3"
						aria-labelledby="resolved-callout-title"
					>
						<div class="flex items-start justify-between gap-2">
							<div>
								<p
									id="resolved-callout-title"
									class="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200"
								>
									Resolved
								</p>
								<p class="mt-1 text-3xl font-bold tabular-nums text-emerald-900 dark:text-emerald-100">
									{resolvedIncidents}
								</p>
								<p class="mt-1 text-xs leading-snug text-emerald-800/90 dark:text-emerald-200/90">
									Action status is <span class="font-semibold">Resolved</span> and a responded date is set
									{#if totalIncidents > 0}
										<span class="mt-0.5 block font-medium">{resolvedPct}% of all incidents</span>
									{/if}
								</p>
							</div>
							<span
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100"
								aria-hidden="true"
							>
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							</span>
						</div>
					</section>

					<section
						class="rounded-lg border border-warm-200 bg-white p-3 shadow-sm dark:bg-warm-100 lg:col-span-6"
						aria-labelledby="action-status-bar-title"
						aria-describedby="action-status-bar-summary"
					>
						<h2
							id="action-status-bar-title"
							class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-warm-700"
						>
							Incidents by Action Status
						</h2>
						<p id="action-status-bar-summary" class="sr-only">{actionStatusAriaLabel}</p>
						<div
							class="w-full overflow-visible"
							style="position: relative; height: {Math.max(140, incidentsByActionStatus.length * 36 + 48)}px; min-height: 140px;"
						>
							{#if !hasActionStatusData}
								<div class="flex h-full items-center justify-center">
									<p class="text-sm text-warm-500">No action status data available.</p>
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
										<th scope="col">Action status</th>
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

				<!-- Three equal cards: shared header/plot/footer heights so the row lines up. -->
				<div class="dashboard-chart-row grid grid-cols-1 gap-2 lg:grid-cols-3 lg:items-stretch">
					<section
						class="dashboard-chart-card min-w-0 rounded-lg border border-warm-200 bg-white p-3 shadow-sm sm:p-4"
						aria-labelledby="over-time-chart-title"
					>
						<div class="dashboard-chart-header">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<h2 class="text-sm font-semibold text-warm-800" id="over-time-chart-title">
									Incidents Over Time
								</h2>
								<label class="flex items-center gap-2 text-sm text-warm-600">
									<span class="sr-only">Time period for incidents over time</span>
									<select
										bind:value={timeRange}
										class="rounded-lg border border-warm-200 bg-warm-50 px-2.5 py-1 text-sm text-warm-700 input-focus dark:bg-warm-200"
										aria-controls="over-time-chart-canvas"
									>
										{#each TIME_RANGE_OPTIONS as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								</label>
							</div>
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
								<ul class="flex flex-wrap gap-x-2.5 gap-y-1" aria-label="Incident type legend">
									{#each typeOverTimeChartData.datasets as ds (ds.label)}
										<li class="flex items-center gap-1 text-[10px] leading-tight text-warm-600">
											<span
												class="inline-block h-2 w-2 shrink-0 rounded-full"
												style="background: {typeof ds.borderColor === 'string'
													? ds.borderColor
													: '#666'}"
												aria-hidden="true"
											></span>
											<span class="truncate">{ds.label}</span>
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
								<ul class="flex flex-wrap gap-x-2.5 gap-y-1" aria-label="Incident type legend">
									{#each driverStackedBarData.datasets as ds (ds.label)}
										<li class="flex items-center gap-1 text-[10px] leading-tight text-warm-600">
											<span
												class="inline-block h-2 w-2 shrink-0 rounded-full"
												style="background: {typeof ds.borderColor === 'string'
													? ds.borderColor
													: '#666'}"
												aria-hidden="true"
											></span>
											<span class="truncate">{ds.label}</span>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					</section>
				</div>

				<!-- NSW map: full row, taller panel -->
				<div class="mt-2 w-full min-w-0 col-span-full">
					<NswIncidentMap {incidents} />
				</div>
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

	/* 13.5rem + 30% = 17.55rem */
	:global(.dashboard-chart-plot) {
		flex: 0 0 17.55rem;
		height: 17.55rem;
		min-height: 17.55rem;
		max-height: 17.55rem;
		position: relative;
		overflow: hidden;
		width: 100%;
	}

	:global(.dashboard-chart-plot canvas) {
		width: 100% !important;
		height: 100% !important;
		max-height: 17.55rem !important;
	}

	:global(.dashboard-chart-footer) {
		flex: 0 0 2.5rem;
		min-height: 2.5rem;
		max-height: 2.5rem;
		margin-top: 0.35rem;
		overflow: hidden;
	}
</style>
