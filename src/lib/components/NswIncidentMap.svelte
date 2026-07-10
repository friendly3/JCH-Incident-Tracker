<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import type { Incident } from '$lib/data/incidents';
	import {
		SYDNEY_CENTER,
		SYDNEY_DEFAULT_ZOOM,
		geocodeNswLocation,
		spreadCoincidentPoints,
		type GeoPoint
	} from '$lib/geocodeNsw';
	import {
		summarizeLocationsFromSubjects,
		type LocationAggregate
	} from '$lib/parseEmailSubjectLocation';

	interface Props {
		incidents: Incident[];
	}

	let { incidents }: Props = $props();

	let mapEl = $state<HTMLDivElement | undefined>(undefined);
	let statusText = $state('Preparing map…');
	/** Distinct places plotted on the map. */
	let mappedPlaceCount = $state(0);
	/** Distinct places that parsed but failed geocoding. */
	let failedPlaceCount = $state(0);
	/** Incident totals after geocoding finishes. */
	let mappedIncidentCount = $state(0);
	let geocodeFailedIncidentCount = $state(0);
	let geocoding = $state(false);
	let ready = $state(false);
	let expanded = $state(false);

	// Leaflet map instance (typed loosely to avoid SSR issues)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let map: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let markersLayer: any = null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let Lref: any = null;
	let cancelled = false;
	let resizeObserver: ResizeObserver | null = null;
	let plotGeneration = 0;
	let previousBodyOverflow = '';
	/** Placed markers — used to re-layout name labels so they don’t stack. */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let placedMarkers: MapMarkerEntry[] = [];
	let labelLayoutBound = false;
	let labelLayoutTimer: ReturnType<typeof setTimeout> | null = null;

	/** Fixed icon box centred on the pulse; room for fanned-out labels. */
	const MARKER_ICON_W = 260;
	const MARKER_ICON_H = 140;
	const MARKER_ANCHOR_X = MARKER_ICON_W / 2;
	const MARKER_ANCHOR_Y = MARKER_ICON_H / 2;
	const LABEL_BOX_W = 112;
	const LABEL_BOX_H = 32;
	const LABEL_GAP = 8;
	const LABEL_PAD = 2;
	/** Extra px to fan labels out when all four sides are occupied. */
	const LABEL_OFFSET_STEPS = [0, 14, 28, 42, 56];

	type LabelSide = 'right' | 'left' | 'above' | 'below';

	type MapMarkerEntry = {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		marker: any;
		lat: number;
		lng: number;
		count: number;
		corePx: number;
		nameLine: string;
		suburbLine: string;
		placeLabel: string;
		side: LabelSide;
		/** Extra distance from the pulse along the chosen side (px). */
		sideOffset: number;
	};

	type LabelBox = { left: number; right: number; top: number; bottom: number };

	const summary = $derived(summarizeLocationsFromSubjects(incidents));
	const locations = $derived(summary.locations);

	/** All incidents that do not appear as a pin (unparseable + geocode failure). */
	const undeterminedIncidentCount = $derived(
		summary.unparseableIncidentCount + geocodeFailedIncidentCount
	);

	function applySydneyView(animate = false) {
		if (!map) return;
		if (animate) {
			map.setView(SYDNEY_CENTER, SYDNEY_DEFAULT_ZOOM, { animate: true });
		} else {
			map.setView(SYDNEY_CENTER, SYDNEY_DEFAULT_ZOOM, { animate: false });
		}
	}

	async function initMap() {
		if (!mapEl || typeof window === 'undefined') return;

		const L = await import('leaflet');
		Lref = L;
		await import('leaflet/dist/leaflet.css');

		if (map) {
			map.remove();
			map = null;
		}

		// Full interactive map — default centred on Sydney
		map = L.map(mapEl, {
			center: SYDNEY_CENTER,
			zoom: SYDNEY_DEFAULT_ZOOM,
			minZoom: 5,
			maxZoom: 18,
			zoomControl: true,
			attributionControl: true,
			scrollWheelZoom: true,
			doubleClickZoom: true,
			boxZoom: true,
			keyboard: true,
			dragging: true,
			touchZoom: true,
			// Soft clamp: stay near Australia/NSW, still room to pan
			maxBounds: [
				[-45, 110],
				[-8, 160]
			],
			maxBoundsViscosity: 0.6,
			worldCopyJump: false
		});

		// Light basemap + CSS grayscale = black-and-white map style
		L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
			attribution:
				'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
			subdomains: 'abcd',
			maxZoom: 20
		}).addTo(map);

		applySydneyView(false);

		markersLayer = L.layerGroup().addTo(map);

		// Leaflet needs a size refresh after layout (flex/hidden parents)
		requestAnimationFrame(() => {
			map?.invalidateSize({ animate: false });
		});
		setTimeout(() => map?.invalidateSize({ animate: false }), 200);

		if (typeof ResizeObserver !== 'undefined' && mapEl) {
			resizeObserver = new ResizeObserver(() => {
				map?.invalidateSize({ animate: false });
				scheduleLabelLayout();
			});
			resizeObserver.observe(mapEl);
		}

		if (!labelLayoutBound) {
			map.on('zoomend moveend', scheduleLabelLayout);
			labelLayoutBound = true;
		}

		ready = true;
		await plotLocations(L, locations);
	}

	function scheduleLabelLayout() {
		if (labelLayoutTimer) clearTimeout(labelLayoutTimer);
		labelLayoutTimer = setTimeout(() => {
			labelLayoutTimer = null;
			resolveLabelLayout();
		}, 60);
	}

	function labelBoxFor(
		cx: number,
		cy: number,
		side: LabelSide,
		extra = 0
	): LabelBox {
		const w = LABEL_BOX_W;
		const h = LABEL_BOX_H;
		const g = LABEL_GAP + extra;
		switch (side) {
			case 'right':
				return {
					left: cx + g,
					right: cx + g + w,
					top: cy - h / 2,
					bottom: cy + h / 2
				};
			case 'left':
				return {
					left: cx - g - w,
					right: cx - g,
					top: cy - h / 2,
					bottom: cy + h / 2
				};
			case 'above':
				return {
					left: cx - w / 2,
					right: cx + w / 2,
					top: cy - g - h,
					bottom: cy - g
				};
			case 'below':
				return {
					left: cx - w / 2,
					right: cx + w / 2,
					top: cy + g,
					bottom: cy + g + h
				};
		}
	}

	function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
		return !(
			a.right + LABEL_PAD < b.left ||
			a.left - LABEL_PAD > b.right ||
			a.bottom + LABEL_PAD < b.top ||
			a.top - LABEL_PAD > b.bottom
		);
	}

	function buildMarkerIcon(entry: MapMarkerEntry, L: { divIcon: (opts: object) => unknown }) {
		const sideClass = `incident-marker--${entry.side}`;
		const labelHtml = `<span class="incident-marker-label" style="--label-offset:${entry.sideOffset}px">
						<span class="incident-marker-name">${escapeHtml(entry.nameLine)}</span>
						<span class="incident-marker-suburb">${escapeHtml(entry.suburbLine)}</span>
					</span>`;

		return L.divIcon({
			className: 'incident-pulse-icon',
			html: `<div class="incident-marker ${sideClass}" style="--core:${entry.corePx}px">
				<span class="incident-pulse-dot" aria-hidden="true"></span>
				${labelHtml}
			</div>`,
			iconSize: [MARKER_ICON_W, MARKER_ICON_H],
			iconAnchor: [MARKER_ANCHOR_X, MARKER_ANCHOR_Y],
			popupAnchor: [0, -entry.corePx / 2 - 4],
			tooltipAnchor: [0, -entry.corePx / 2 - 4]
		});
	}

	/**
	 * Place a name label on every pulse. Prefer free sides; fan out with extra
	 * offset when crowded. Never drop a label entirely.
	 */
	function resolveLabelLayout() {
		if (!map || !Lref || placedMarkers.length === 0) return;

		// Priority: more incidents first, then name for stability
		const ordered = [...placedMarkers].sort(
			(a, b) => b.count - a.count || a.nameLine.localeCompare(b.nameLine)
		);

		const accepted: LabelBox[] = [];
		const sides: LabelSide[] = ['right', 'left', 'above', 'below'];

		for (const entry of ordered) {
			const pt = map.latLngToContainerPoint([entry.lat, entry.lng]);
			const cx = pt.x as number;
			const cy = pt.y as number;

			let chosenSide: LabelSide = 'right';
			let chosenOffset = 0;
			let chosenBox = labelBoxFor(cx, cy, 'right', 0);
			let found = false;

			outer: for (const extra of LABEL_OFFSET_STEPS) {
				for (const side of sides) {
					const box = labelBoxFor(cx, cy, side, extra);
					const hitsLabel = accepted.some((a) => boxesOverlap(a, box));
					// Soft avoid other pulses (small radius — don't block all placements)
					const hitsPulse = ordered.some((other) => {
						if (other === entry) return false;
						const op = map.latLngToContainerPoint([other.lat, other.lng]);
						const pr = Math.max(6, other.corePx * 0.6);
						const pulseBox: LabelBox = {
							left: op.x - pr,
							right: op.x + pr,
							top: op.y - pr,
							bottom: op.y + pr
						};
						return boxesOverlap(box, pulseBox);
					});
					if (!hitsLabel && !hitsPulse) {
						chosenSide = side;
						chosenOffset = extra;
						chosenBox = box;
						found = true;
						break outer;
					}
				}
			}

			// Last resort: still show a label (right + max offset) even if slightly overlapping
			if (!found) {
				chosenSide = 'right';
				chosenOffset = LABEL_OFFSET_STEPS[LABEL_OFFSET_STEPS.length - 1] ?? 56;
				chosenBox = labelBoxFor(cx, cy, chosenSide, chosenOffset);
			}

			accepted.push(chosenBox);

			if (entry.side !== chosenSide || entry.sideOffset !== chosenOffset) {
				entry.side = chosenSide;
				entry.sideOffset = chosenOffset;
				entry.marker.setIcon(buildMarkerIcon(entry, Lref));
			}
		}
	}

	function resetView() {
		if (!map) return;
		applySydneyView(true);
	}

	function fitAllMarkers() {
		if (!map || !Lref) return;
		const layers = markersLayer?.getLayers?.() ?? [];
		if (layers.length > 0) {
			const group = Lref.featureGroup(layers);
			map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 14, animate: true });
		} else {
			applySydneyView(true);
		}
	}

	async function setExpanded(next: boolean) {
		expanded = next;
		await tick();
		// Allow layout to settle then refresh Leaflet size
		requestAnimationFrame(() => {
			map?.invalidateSize({ animate: false });
			scheduleLabelLayout();
			setTimeout(() => {
				map?.invalidateSize({ animate: false });
				resolveLabelLayout();
			}, 80);
			setTimeout(() => {
				map?.invalidateSize({ animate: false });
				resolveLabelLayout();
			}, 250);
		});

		if (typeof document !== 'undefined') {
			if (next) {
				previousBodyOverflow = document.body.style.overflow;
				document.body.style.overflow = 'hidden';
			} else {
				document.body.style.overflow = previousBodyOverflow;
			}
		}
	}

	function openExpand() {
		void setExpanded(true);
	}

	function closeExpand() {
		void setExpanded(false);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && expanded) {
			e.preventDefault();
			closeExpand();
		}
	}

	async function plotLocations(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		L: any,
		locs: LocationAggregate[]
	) {
		if (!map || !markersLayer) return;
		const gen = ++plotGeneration;
		markersLayer.clearLayers();
		placedMarkers = [];
		mappedPlaceCount = 0;
		failedPlaceCount = 0;
		mappedIncidentCount = 0;
		geocodeFailedIncidentCount = 0;
		geocoding = true;

		if (locs.length === 0) {
			statusText =
				summary.totalIncidents === 0
					? 'No incidents to map yet.'
					: 'No parseable locations in email subjects yet.';
			applySydneyView(false);
			geocoding = false;
			return;
		}

		statusText = `Geocoding ${locs.length} location${locs.length === 1 ? '' : 's'}…`;

		type GeocodedPlace = {
			key: string;
			lat: number;
			lng: number;
			loc: LocationAggregate;
			point: GeoPoint;
		};

		const geocoded: GeocodedPlace[] = [];

		for (let i = 0; i < locs.length; i++) {
			if (cancelled || gen !== plotGeneration) return;
			const loc = locs[i];
			statusText = `Geocoding ${i + 1} of ${locs.length}…`;

			const point: GeoPoint | null = await geocodeNswLocation(loc.query, loc.suburb, {
				street: loc.street
			});
			if (cancelled || gen !== plotGeneration) return;

			if (!point) {
				failedPlaceCount += 1;
				geocodeFailedIncidentCount += loc.count;
				await sleep(20);
				continue;
			}

			geocoded.push({
				key: loc.key,
				lat: point.lat,
				lng: point.lng,
				loc,
				point
			});
			await sleep(20);
		}

		if (cancelled || gen !== plotGeneration) return;

		// Separate pins that share the same coordinates (common when many streets
		// fall back to one suburb centre) so every place shows its own indicator.
		const spread = spreadCoincidentPoints(geocoded);

		for (const item of spread) {
			const { loc, point } = item;
			mappedPlaceCount += 1;
			mappedIncidentCount += loc.count;

			const corePx = Math.min(16, 8 + Math.log2(loc.count + 1) * 2.5);
			const precisionNote =
				point.precision === 'street'
					? 'Street-level'
					: point.precision === 'suburb'
						? 'Suburb area (spread for visibility)'
						: 'Region';

			const countLabel =
				loc.count === 1 ? '1 incident' : `${loc.count} incidents`;
			const placeLabel = loc.street
				? `${loc.street}, ${loc.suburb}`
				: loc.suburb;
			const nameLine = loc.street || loc.suburb;
			const suburbLine = loc.street ? loc.suburb : 'NSW';

			const entry: MapMarkerEntry = {
				marker: null,
				lat: item.lat,
				lng: item.lng,
				count: loc.count,
				corePx,
				nameLine,
				suburbLine,
				placeLabel,
				side: 'right',
				sideOffset: 0
			};

			const marker = L.marker([item.lat, item.lng], {
				icon: buildMarkerIcon(entry, L),
				keyboard: true,
				riseOnHover: true,
				title: placeLabel,
				// Keep marker icons above labels of other markers when dense
				zIndexOffset: Math.round(loc.count * 10)
			});
			entry.marker = marker;

			marker.bindTooltip(
				`<div class="incident-map-tooltip-inner">
					<span class="incident-map-tooltip-count">${escapeHtml(countLabel)}</span>
					<span class="incident-map-tooltip-place">${escapeHtml(placeLabel)}</span>
				</div>`,
				{
					direction: 'top',
					offset: [0, -Math.ceil(corePx / 2) - 2],
					opacity: 1,
					sticky: false,
					interactive: false,
					className: 'incident-map-tooltip',
					permanent: false
				}
			);

			marker.bindPopup(
				`<div style="min-width:12rem;font:12px/1.4 system-ui,sans-serif">
					<strong>${escapeHtml(loc.street || loc.suburb)}</strong><br/>
					${escapeHtml(loc.suburb)}, NSW<br/>
					<span style="color:#555">${escapeHtml(countLabel)}</span><br/>
					<span style="color:#777;font-size:11px">${precisionNote}</span>
				</div>`
			);

			markersLayer.addLayer(marker);
			placedMarkers.push(entry);
		}

		if (cancelled || gen !== plotGeneration) return;

		// Fit all indicators into view so nothing is stranded off-screen
		if (placedMarkers.length > 0) {
			const group = L.featureGroup(placedMarkers.map((p) => p.marker));
			map.fitBounds(group.getBounds().pad(0.22), {
				maxZoom: 14,
				animate: false,
				padding: [28, 28]
			});
			statusText = `Showing all ${mappedPlaceCount} place${mappedPlaceCount === 1 ? '' : 's'} (${mappedIncidentCount} incident${mappedIncidentCount === 1 ? '' : 's'}). Co-located streets are fanned out. Drag / zoom to explore.`;
		} else {
			applySydneyView(false);
			statusText = 'Parsed locations but none could be geocoded yet.';
		}

		geocoding = false;
		map.invalidateSize({ animate: false });
		requestAnimationFrame(() => resolveLabelLayout());
		setTimeout(() => resolveLabelLayout(), 120);
		setTimeout(() => resolveLabelLayout(), 400);
	}

	function sleep(ms: number) {
		return new Promise((r) => setTimeout(r, ms));
	}

	function escapeHtml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	onMount(() => {
		cancelled = false;
		void initMap();
		return () => {
			cancelled = true;
		};
	});

	// Re-plot when incident set changes (e.g. after refresh)
	$effect(() => {
		const locs = locations;
		if (!map || !ready || typeof window === 'undefined') return;
		let active = true;
		(async () => {
			const L = Lref ?? (await import('leaflet'));
			if (!active || cancelled) return;
			await plotLocations(L, locs);
		})();
		return () => {
			active = false;
		};
	});

	onDestroy(() => {
		cancelled = true;
		if (labelLayoutTimer) clearTimeout(labelLayoutTimer);
		if (typeof document !== 'undefined') {
			document.body.style.overflow = previousBodyOverflow;
		}
		resizeObserver?.disconnect();
		resizeObserver = null;
		if (map) {
			map.off('zoomend moveend', scheduleLabelLayout);
			map.remove();
			map = null;
			markersLayer = null;
		}
		placedMarkers = [];
		labelLayoutBound = false;
		Lref = null;
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if expanded}
	<!-- Backdrop for expanded modal (75% central takeover) -->
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="map-expand-backdrop"
		onclick={(e) => {
			if (e.target === e.currentTarget) closeExpand();
		}}
		role="presentation"
	></div>
{/if}

<section
	class="map-chart-shell flex flex-col overflow-hidden rounded-lg border border-warm-200 bg-white shadow-sm {expanded
		? 'map-chart-shell--expanded'
		: 'h-full'}"
	aria-labelledby="nsw-map-title"
	aria-modal={expanded ? 'true' : undefined}
	role={expanded ? 'dialog' : undefined}
>
	<div class="flex flex-wrap items-start justify-between gap-2 border-b border-warm-200 px-3 py-2.5 sm:px-4">
		<div class="min-w-0 flex-1">
			<h2 id="nsw-map-title" class="text-base font-semibold text-warm-800">
				Incident locations (NSW)
			</h2>
			<p class="mt-0.5 text-xs text-warm-500 sm:text-sm">
				Default view: Sydney. Hover a pulse for counts; drag to pan; scroll or +/− to zoom.
			</p>
			<p class="mt-0.5 text-xs text-warm-400" aria-live="polite">{statusText}</p>
		</div>
		<div class="flex shrink-0 flex-wrap items-center gap-1.5">
			<button
				type="button"
				class="rounded-md border border-warm-200 bg-warm-50 px-2.5 py-1 text-xs font-medium text-warm-700 hover:bg-warm-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:opacity-50"
				onclick={resetView}
				disabled={!ready}
				title="Centre on Sydney"
			>
				Sydney
			</button>
			<button
				type="button"
				class="rounded-md border border-warm-200 bg-warm-50 px-2.5 py-1 text-xs font-medium text-warm-700 hover:bg-warm-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 disabled:opacity-50"
				onclick={fitAllMarkers}
				disabled={!ready || mappedPlaceCount === 0}
				title="Fit all mapped locations"
			>
				Fit all
			</button>
			{#if expanded}
				<button
					type="button"
					class="inline-flex items-center gap-1 rounded-md border border-warm-300 bg-warm-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-warm-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
					onclick={closeExpand}
					aria-label="Close expanded map"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
					Close
				</button>
			{:else}
				<button
					type="button"
					class="inline-flex items-center gap-1 rounded-md border border-warm-200 bg-white px-2.5 py-1 text-xs font-medium text-warm-800 shadow-sm hover:bg-warm-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
					onclick={openExpand}
					disabled={!ready}
					aria-label="Expand map to large view"
					title="Expand map"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"
						/>
					</svg>
					Expand
				</button>
			{/if}
		</div>
	</div>

	<div
		class="relative min-h-[25rem] flex-1 sm:min-h-[32.5rem] {expanded
			? 'map-chart-body--expanded'
			: ''}"
	>
		<!-- Leaflet attaches listeners to this container; role=application marks it interactive -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			bind:this={mapEl}
			class="nsw-incident-map absolute inset-0 h-full w-full bg-warm-100"
			role="application"
			aria-label="Interactive map centred on Sydney, New South Wales. Zoom and pan to explore incident locations. Hover markers for incident counts."
			tabindex="0"
		></div>

		<!-- Legend overlay -->
		<aside
			class="pointer-events-none absolute bottom-3 right-3 z-[500] max-w-[15.5rem] rounded-md border border-warm-200/90 bg-white/95 px-2.5 py-2 shadow-md backdrop-blur-sm dark:border-warm-300 dark:bg-warm-100/95"
			aria-label="Map legend"
		>
			<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-warm-500">
				Legend
			</p>
			<ul class="space-y-1.5 text-xs text-warm-700">
				<li class="flex items-center gap-2">
					<span class="incident-legend-pulse shrink-0" aria-hidden="true"></span>
					<span class="min-w-0 leading-snug">
						<span class="font-medium text-warm-800">Mapped location</span>
						<span class="mt-0.5 block text-[11px] text-warm-500">
							{#if geocoding}
								Placing markers…
							{:else}
								{mappedIncidentCount}
								incident{mappedIncidentCount === 1 ? '' : 's'}
								· {mappedPlaceCount} place{mappedPlaceCount === 1 ? '' : 's'}
								· every place labelled
							{/if}
						</span>
					</span>
				</li>
				<li class="flex items-center gap-2">
					<span
						class="incident-legend-unknown shrink-0"
						aria-hidden="true"
						title="Location cannot be determined"
					>
						?
					</span>
					<span class="min-w-0 leading-snug">
						<span class="font-medium text-warm-800">Location undetermined</span>
						<span class="mt-0.5 block text-[11px] text-warm-500">
							{#if geocoding}
								Calculating…
							{:else}
								<span class="font-semibold tabular-nums text-warm-800"
									>{undeterminedIncidentCount}</span
								>
								incident{undeterminedIncidentCount === 1 ? '' : 's'}
								{#if summary.totalIncidents > 0}
									<span class="text-warm-400">
										({Math.round(
											(undeterminedIncidentCount / summary.totalIncidents) * 100
										)}%)
									</span>
								{/if}
							{/if}
						</span>
					</span>
				</li>
			</ul>
			{#if !geocoding && undeterminedIncidentCount > 0}
				<p class="mt-1.5 border-t border-warm-100 pt-1.5 text-[10px] leading-snug text-warm-400">
					{#if summary.unparseableIncidentCount > 0 && geocodeFailedIncidentCount > 0}
						{summary.unparseableIncidentCount} need a location in incident details ·
						{geocodeFailedIncidentCount} could not be geocoded
					{:else if summary.unparseableIncidentCount > 0}
						Open the incident and set street/suburb under Map location (NSW)
					{:else}
						Parsed place could not be geocoded
					{/if}
				</p>
			{/if}
		</aside>
	</div>

	<div class="border-t border-warm-200 px-3 py-1.5 text-[11px] text-warm-400 sm:px-4">
		Map © OpenStreetMap · CARTO · B&amp;W basemap · Default: Sydney, NSW
	</div>
</section>

<!-- Placeholder keeps dashboard grid height while map is expanded -->
{#if expanded}
	<div
		class="pointer-events-none h-full min-h-[25rem] rounded-lg border border-dashed border-warm-200 bg-warm-50/80 sm:min-h-[32.5rem]"
		aria-hidden="true"
	>
		<div class="flex h-full min-h-[inherit] items-center justify-center p-4 text-center text-xs text-warm-400">
			Map expanded
		</div>
	</div>
{/if}

<style>
	.map-expand-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1100;
		background: rgba(28, 25, 23, 0.5);
		backdrop-filter: blur(2px);
	}

	/*
	 * Expanded map: fixed panel at 75% of the viewport (central page takeover).
	 */
	:global(.map-chart-shell--expanded) {
		position: fixed !important;
		top: 50% !important;
		left: 50% !important;
		z-index: 1110 !important;
		width: 75vw !important;
		height: 75vh !important;
		max-width: 75% !important;
		max-height: 75% !important;
		transform: translate(-50%, -50%);
		margin: 0 !important;
		box-shadow:
			0 25px 50px -12px rgba(0, 0, 0, 0.35),
			0 0 0 1px rgba(0, 0, 0, 0.06);
	}

	.map-chart-body--expanded {
		min-height: 0 !important;
	}

	/*
	 * Map shell: ensure Leaflet can receive pointer events and sits under tooltips.
	 */
	:global(.nsw-incident-map.leaflet-container) {
		font: inherit;
		z-index: 0;
		cursor: grab;
		background: #e8e8e8;
		/* Let Leaflet own pan/zoom gestures (incl. touch) */
		touch-action: none;
	}

	/* Force monochrome basemap (light tiles → pure B&W) */
	:global(.nsw-incident-map .leaflet-tile-pane) {
		filter: grayscale(1) contrast(1.12) brightness(1.04);
	}

	:global(.nsw-incident-map.leaflet-container:active) {
		cursor: grabbing;
	}

	:global(.nsw-incident-map .leaflet-control-zoom a) {
		width: 30px;
		height: 30px;
		line-height: 30px;
		color: #1c1917;
		background: #fff;
	}

	/*
	 * Pulsing map markers — electrified.pplx.app style:
	 * solid core + expanding translucent ring + permanent name label.
	 */
	:global(.leaflet-div-icon.incident-pulse-icon) {
		background: transparent !important;
		border: none !important;
		overflow: visible;
		cursor: pointer;
	}

	/* Fixed box; pulse centred; label docks on free side to avoid overlaps */
	:global(.incident-marker) {
		position: relative;
		width: 260px;
		height: 140px;
		pointer-events: none;
		overflow: visible;
	}

	:global(.incident-pulse-dot) {
		position: absolute;
		left: 50%;
		top: 50%;
		display: block;
		width: var(--core, 10px);
		height: var(--core, 10px);
		border-radius: 9999px;
		transform: translate(-50%, -50%);
		/* Strong accent so markers read clearly on B&W basemap */
		background: #0f7cb3;
		box-shadow: 0 0 0 0 #0f7cb3b3;
		animation: incident-pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
		pointer-events: auto;
		cursor: pointer;
	}

	:global(.incident-marker-label) {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 7.25rem;
		max-width: 7.25rem;
		padding: 0.15rem 0.35rem 0.2rem;
		border-radius: 0.25rem;
		border: 1px solid rgba(0, 0, 0, 0.55);
		background: rgba(255, 255, 255, 0.96);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
		line-height: 1.15;
		pointer-events: none;
		z-index: 2;
	}

	:global(.incident-marker--right .incident-marker-label) {
		left: calc(50% + 8px + var(--label-offset, 0px));
		top: 50%;
		transform: translateY(-50%);
	}

	:global(.incident-marker--left .incident-marker-label) {
		right: calc(50% + 8px + var(--label-offset, 0px));
		top: 50%;
		transform: translateY(-50%);
		align-items: flex-end;
		text-align: right;
	}

	:global(.incident-marker--above .incident-marker-label) {
		left: 50%;
		bottom: calc(50% + 8px + var(--label-offset, 0px));
		transform: translateX(-50%);
		align-items: center;
		text-align: center;
	}

	:global(.incident-marker--below .incident-marker-label) {
		left: 50%;
		top: calc(50% + 8px + var(--label-offset, 0px));
		transform: translateX(-50%);
		align-items: center;
		text-align: center;
	}

	:global(.incident-marker-name) {
		display: block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 600 11px/1.2 system-ui, -apple-system, sans-serif;
		color: #0a0a0a;
		letter-spacing: 0.01em;
	}

	:global(.incident-marker-suburb) {
		display: block;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font: 500 10px/1.2 system-ui, -apple-system, sans-serif;
		color: #44403c;
	}

	:global(.incident-marker--left .incident-marker-name),
	:global(.incident-marker--left .incident-marker-suburb) {
		width: 100%;
	}

	.incident-legend-pulse {
		display: block;
		width: 10px;
		height: 10px;
		border-radius: 9999px;
		background: #0f7cb3;
		box-shadow: 0 0 0 0 #0f7cb3b3;
		animation: incident-pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	.incident-legend-unknown {
		display: flex;
		width: 16px;
		height: 16px;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		border: 1.5px dashed #a8a29e;
		background: #f5f5f4;
		color: #78716c;
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
	}

	:global {
		@keyframes incident-pulse {
			0%,
			100% {
				box-shadow: 0 0 0 0 #0f7cb3b3;
			}
			50% {
				box-shadow: 0 0 0 14px #0f7cb300;
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.incident-pulse-dot),
		.incident-legend-pulse {
			animation: none;
			box-shadow: 0 0 0 3px #0f7cb355;
		}
	}

	/* Hover tooltip: incident total */
	:global(.leaflet-tooltip.incident-map-tooltip) {
		padding: 0;
		border: none;
		background: transparent;
		box-shadow: none;
	}

	:global(.leaflet-tooltip.incident-map-tooltip::before) {
		display: none;
	}

	:global(.incident-map-tooltip-inner) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
		padding: 0.4rem 0.65rem;
		border-radius: 0.5rem;
		background: rgba(28, 25, 23, 0.92);
		color: #fafaf9;
		font: 600 12px/1.25 system-ui, -apple-system, sans-serif;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
		white-space: nowrap;
		pointer-events: none;
	}

	:global(.incident-map-tooltip-count) {
		font-size: 13px;
		letter-spacing: 0.01em;
	}

	:global(.incident-map-tooltip-place) {
		font-weight: 500;
		font-size: 11px;
		opacity: 0.78;
		max-width: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	:global(.dark .nsw-incident-map.leaflet-container) {
		background: #1c1917;
	}

	:global(.dark .nsw-incident-map .leaflet-tile-pane) {
		filter: grayscale(1) contrast(1.05) brightness(0.92);
	}
</style>
