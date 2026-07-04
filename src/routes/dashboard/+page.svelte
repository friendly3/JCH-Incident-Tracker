<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { incidentStore } from '$lib/data/store.svelte';
	import { formatDate } from '$lib/formatDate';
	import { theme } from '$lib/theme.svelte';
	import type { Chart as ChartJS, ChartOptions } from 'chart.js';
	import { Chart, registerables } from 'chart.js';
	import { onMount, untrack } from 'svelte';

	// Register Chart.js plugins
	Chart.register(...registerables);

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

	const CHART_FALLBACKS = {
		light: {
			accent: '#05ac98',
			ticks: '#6a6c6e',
			legend: '#3a3b3d',
			grid: '#bbbfc0',
			pointBorder: '#e2e4e4'
		},
		dark: {
			accent: '#0cac99',
			ticks: '#9a9c9e',
			legend: '#e0e2e2',
			grid: '#2e3032',
			pointBorder: '#2e3032'
		}
	} as const;

	function getChartTheme(isDark = isDarkMode()) {
		const fallbacks = isDark ? CHART_FALLBACKS.dark : CHART_FALLBACKS.light;
		return {
			accent: cssVar('--color-accent-500', fallbacks.accent),
			ticks: cssVar('--color-warm-600', fallbacks.ticks),
			legend: cssVar('--color-warm-800', fallbacks.legend),
			grid: withAlpha(cssVar('--color-warm-300', fallbacks.grid), 0.25),
			fill: withAlpha(cssVar('--color-accent-500', fallbacks.accent), 0.12),
			pointBorder: cssVar('--color-warm-300', fallbacks.pointBorder),
			tooltipBg: isDark
				? withAlpha(cssVar('--color-warm-200', '#1e1f21'), 0.95)
				: withAlpha(cssVar('--color-warm-800', fallbacks.legend), 0.92)
		};
	}

	function buildChartOptions(colors: ReturnType<typeof getChartTheme>): ChartOptions<'line'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					display: true,
					labels: {
						usePointStyle: true,
						font: { size: 12 },
						color: colors.legend
					}
				},
				tooltip: {
					backgroundColor: colors.tooltipBg,
					titleFont: { size: 14 },
					bodyFont: { size: 12 },
					padding: 12,
					cornerRadius: 8,
					displayColors: false,
					callbacks: {
						label: (context) => `${context.parsed.y} incidents`
					}
				}
			},
			scales: {
				y: {
					beginAtZero: true,
					ticks: {
						color: colors.ticks,
						stepSize: 1
					},
					grid: {
						color: colors.grid
					}
				},
				x: {
					ticks: {
						color: colors.ticks
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
		}
		chart.update('none');
	}

	const PIE_PALETTE_FALLBACKS = {
		light: [
			'#05ac98', '#038676', '#026b5c', '#8fdcd2', '#c5ede8', '#6a6c6e', '#878787', '#525456',
			'#9a9d9e', '#bbbfc0', '#3a3b3d', '#e8f8f6'
		],
		dark: [
			'#0cac99', '#1dd4be', '#5ee8d4', '#1b4a44', '#0f2a26', '#9a9c9e', '#6e7072', '#bbbfc0',
			'#4a4c4e', '#2e3032', '#e0e2e2', '#0a1a18'
		]
	} as const;

	const PIE_PALETTE_VARS = [
		'--color-accent-500',
		'--color-accent-600',
		'--color-accent-700',
		'--color-accent-200',
		'--color-accent-100',
		'--color-warm-600',
		'--color-warm-500',
		'--color-warm-700',
		'--color-warm-400',
		'--color-warm-300',
		'--color-warm-800',
		'--color-accent-50'
	] as const;

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

	function getPieChartPalette(isDark = isDarkMode()) {
		const fallbacks = isDark ? PIE_PALETTE_FALLBACKS.dark : PIE_PALETTE_FALLBACKS.light;
		return PIE_PALETTE_VARS.map((name, index) => cssVar(name, fallbacks[index]));
	}

	function getPieChartColor(index: number, isDark = isDarkMode()) {
		const palette = getPieChartPalette(isDark);
		if (index < palette.length) return palette[index];

		const accentFallback = isDark ? '#0cac99' : '#05ac98';
		const accent = cssVar('--color-accent-500', accentFallback);
		const rgb = parseHex(accent) ?? (isDark ? [12, 172, 153] : [5, 172, 152]);
		const [baseHue, saturation, lightness] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
		const hue = (baseHue + (index - palette.length + 1) * 47) % 360;
		const [r, g, b] = hslToRgb(hue, Math.min(0.72, Math.max(0.38, saturation)), lightness);
		return rgbToHex(r, g, b);
	}

	function getPieSliceBorder(isDark = isDarkMode()) {
		if (isDark) {
			return cssVar('--color-warm-400', '#4a4c4e');
		}
		return cssVar('--color-warm-200', '#e2e4e4');
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

		incidentStore.list.forEach((incident) => {
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

	function buildPieChartOptions(
		colors: ReturnType<typeof getChartTheme>,
		sliceCount = 0
	): ChartOptions<'pie'> {
		return {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					display: true,
					position: getPieLegendPosition(sliceCount),
					labels: {
						usePointStyle: true,
						font: { size: 12 },
						color: colors.legend,
						padding: 16,
						boxWidth: 10
					}
				},
				tooltip: {
					backgroundColor: colors.tooltipBg,
					titleFont: { size: 14 },
					bodyFont: { size: 12 },
					padding: 12,
					cornerRadius: 8,
					callbacks: {
						label: (context) => {
							const total = context.dataset.data.reduce(
								(sum, value) => sum + (typeof value === 'number' ? value : 0),
								0
							);
							const value = typeof context.parsed === 'number' ? context.parsed : 0;
							const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
							return `${value} incidents (${percentage}%)`;
						}
					}
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
			chart.data.labels?.map((_, index) => getPieChartColor(index, theme.isDark)) ?? [];
		dataset.borderColor = chart.data.labels?.map(() => sliceBorder) ?? sliceBorder;

		if (chart.options?.plugins?.legend) {
			chart.options.plugins.legend.position = getPieLegendPosition(sliceCount);
			if (chart.options.plugins.legend.labels) {
				chart.options.plugins.legend.labels.color = colors.legend;
			}
		}
		if (chart.options?.plugins?.tooltip) {
			chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
		}

		chart.update('none');
	}

	let { data } = $props();
	let canvasElement: HTMLCanvasElement | undefined = $state();
	let teamLeaderCanvas: HTMLCanvasElement | undefined = $state();
	let driverCanvas: HTMLCanvasElement | undefined = $state();
	let chartInstance = $state<ChartJS<'line'> | undefined>();
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

	// Sync store whenever server data changes (initial load + after invalidateAll)
	$effect(() => {
		if (data.supabase) {
			incidentStore.syncFromServer(data.supabase, data.incidents ?? []);
		}
	});

	// Group incidents by date and count them
	const incidentsByDate = $derived.by(() => {
		const grouped: Record<string, number> = {};

		incidentStore.list.forEach((incident) => {
			const date = incident.dateReceived;
			grouped[date] = (grouped[date] || 0) + 1;
		});

		// Sort by date and return
		return Object.entries(grouped)
			.sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
			.slice(-30); // Last 30 days
	});

	const chartData = $derived.by(() => ({
		labels: incidentsByDate.map(([date]) => formatDate(date)),
		datasets: [
			{
				label: 'Incidents',
				data: incidentsByDate.map(([, count]) => count),
				borderWidth: 2,
				fill: true,
				tension: 0.4,
				pointRadius: 4,
				pointBorderWidth: 2,
				pointHoverRadius: 6
			}
		]
	}));

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
		if (teamLeaderChart) {
			applyPieChartTheme(teamLeaderChart, incidentsByTeamLeader.length);
		}
		if (driverChart) {
			applyPieChartTheme(driverChart, incidentsByDriver.length);
		}
	});

	// Calculate stats
	const totalIncidents = $derived(incidentStore.list.length);
	const incidentsThisMonth = $derived(
		incidentStore.list.filter((i) => {
			const date = new Date(i.dateReceived);
			const now = new Date();
			return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
		}).length
	);
	const incidentsThisWeek = $derived(
		incidentStore.list.filter((i) => {
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
		<div class="mx-auto max-w-[1600px]">
			<h1 class="text-2xl font-bold text-warm-800">Dashboard</h1>
			<p class="mt-1 text-sm text-warm-500">Overview of incident tracking metrics</p>
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
	{:else if !incidentStore.isInitialized || incidentStore.isLoading}
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
			<div class="mx-auto max-w-[1600px] px-6 py-6">
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

				<!-- Chart -->
				<div class="rounded-lg border border-warm-200 bg-white p-6 shadow-sm">
					<h2 class="mb-4 text-lg font-semibold text-warm-800">Incidents Over Time (Last 30 Days)</h2>
					<div class="w-full h-96" style="position: relative; min-height: 400px;">
						<canvas bind:this={canvasElement} style="max-height: 100%;"></canvas>
					</div>
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
							<table class="sr-only" aria-labelledby="team-leader-chart-title">
								<caption>Incidents by Team Leader</caption>
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
							<table class="sr-only" aria-labelledby="driver-chart-title">
								<caption>Incidents by Driver</caption>
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

				<!-- Recent Incidents -->
				<div class="mt-8 rounded-lg border border-warm-200 bg-white shadow-sm overflow-hidden">
					<div class="px-6 py-4 border-b border-warm-200 bg-warm-50">
						<h2 class="text-lg font-semibold text-warm-800">Recent Incidents</h2>
					</div>
					{#if incidentStore.list.length === 0}
						<div class="p-8 text-center">
							<p class="text-warm-500">No incidents recorded yet.</p>
						</div>
					{:else}
						<table class="w-full text-left text-sm">
							<thead class="border-b border-warm-200 bg-warm-50">
								<tr>
									<th class="px-6 py-3 font-medium text-warm-600">Date</th>
									<th class="px-6 py-3 font-medium text-warm-600">Type</th>
									<th class="px-6 py-3 font-medium text-warm-600">Ref No.</th>
									<th class="px-6 py-3 font-medium text-warm-600">Team Leader</th>
									<th class="px-6 py-3 font-medium text-warm-600">Driver</th>
									<th class="px-6 py-3 font-medium text-warm-600">Status</th>
								</tr>
							</thead>
							<tbody>
								{#each incidentStore.list.slice(0, 10) as incident (incident.id)}
									<tr class="border-b border-warm-100 last:border-0 hover:bg-warm-50/50">
										<td class="px-6 py-3 whitespace-nowrap text-warm-700">{formatDate(incident.dateReceived)}</td>
										<td class="px-6 py-3 whitespace-nowrap">
											<span class="inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium bg-warm-100 text-warm-700">
												{incident.type}
											</span>
										</td>
										<td class="px-6 py-3 whitespace-nowrap font-mono text-xs text-warm-600">{incident.referenceNo}</td>
										<td class="px-6 py-3 whitespace-nowrap text-warm-600 uppercase">
											{#if incident.teamLeader?.trim()}
												{incident.teamLeader.trim()}
											{:else}
												<span class="text-warm-300">-</span>
											{/if}
										</td>
										<td class="px-6 py-3 whitespace-nowrap text-warm-600">
											{#if incident.driver?.trim()}
												{incident.driver.trim()}
											{:else}
												<span class="text-warm-300">-</span>
											{/if}
										</td>
										<td class="px-6 py-3 whitespace-nowrap">
											{#if incident.action === 'Resolved'}
												<span class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Resolved</span>
											{:else if incident.action}
												<span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">{incident.action}</span>
											{:else}
												<span class="text-warm-300">-</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
