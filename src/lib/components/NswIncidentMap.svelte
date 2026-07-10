<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { Incident } from '$lib/data/incidents';
	import {
		NSW_BOUNDS,
		NSW_CENTER,
		geocodeNswLocation,
		type GeoPoint
	} from '$lib/geocodeNsw';
	import {
		aggregateLocationsFromSubjects,
		type LocationAggregate
	} from '$lib/parseEmailSubjectLocation';

	interface Props {
		incidents: Incident[];
	}

	let { incidents }: Props = $props();

	let mapEl = $state<HTMLDivElement | undefined>(undefined);
	let statusText = $state('Preparing map…');
	let mappedCount = $state(0);
	let parsedCount = $state(0);
	let failedCount = $state(0);
	let ready = $state(false);

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

	const locations = $derived(aggregateLocationsFromSubjects(incidents));

	async function initMap() {
		if (!mapEl || typeof window === 'undefined') return;

		const L = await import('leaflet');
		Lref = L;
		await import('leaflet/dist/leaflet.css');

		if (map) {
			map.remove();
			map = null;
		}

		// Full interactive map: drag to pan, scroll/buttons to zoom
		map = L.map(mapEl, {
			center: NSW_CENTER,
			zoom: 6,
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

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			attribution:
				'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
			maxZoom: 18
		}).addTo(map);

		// Zoom +/- already added via zoomControl: true (top-left)
		map.fitBounds(NSW_BOUNDS, { padding: [16, 16] });

		markersLayer = L.layerGroup().addTo(map);

		// Leaflet needs a size refresh after layout (flex/hidden parents)
		requestAnimationFrame(() => {
			map?.invalidateSize({ animate: false });
		});
		setTimeout(() => map?.invalidateSize({ animate: false }), 200);

		if (typeof ResizeObserver !== 'undefined' && mapEl) {
			resizeObserver = new ResizeObserver(() => {
				map?.invalidateSize({ animate: false });
			});
			resizeObserver.observe(mapEl);
		}

		ready = true;
		await plotLocations(L, locations);
	}

	function resetView() {
		if (!map || !Lref) return;
		// Prefer fitted markers when present
		const layers = markersLayer?.getLayers?.() ?? [];
		if (layers.length > 0) {
			const group = Lref.featureGroup(layers);
			map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 14, animate: true });
		} else {
			map.fitBounds(NSW_BOUNDS, { padding: [16, 16], animate: true });
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
		parsedCount = locs.length;
		mappedCount = 0;
		failedCount = 0;

		if (locs.length === 0) {
			statusText = 'No parseable locations in email subjects yet.';
			map.fitBounds(NSW_BOUNDS, { padding: [16, 16] });
			return;
		}

		statusText = `Geocoding ${locs.length} location${locs.length === 1 ? '' : 's'}…`;
		const latLngs: [number, number][] = [];

		for (let i = 0; i < locs.length; i++) {
			if (cancelled || gen !== plotGeneration) return;
			const loc = locs[i];
			statusText = `Geocoding ${i + 1} of ${locs.length}…`;

			const point: GeoPoint | null = await geocodeNswLocation(loc.query, loc.suburb);
			if (cancelled || gen !== plotGeneration) return;

			if (!point) {
				failedCount += 1;
				await sleep(30);
				continue;
			}

			mappedCount += 1;
			latLngs.push([point.lat, point.lng]);

			// Dot size scales lightly with count (core size in px; ring animates beyond)
			const corePx = Math.min(16, 8 + Math.log2(loc.count + 1) * 2.5);
			const iconPx = Math.ceil(corePx + 28); // room for expanding pulse ring
			const precisionNote =
				point.precision === 'street'
					? 'Street-level'
					: point.precision === 'suburb'
						? 'Suburb centre (approx.)'
						: 'Region';

			const countLabel =
				loc.count === 1 ? '1 incident' : `${loc.count} incidents`;
			const placeLabel = loc.street
				? `${loc.street}, ${loc.suburb}`
				: loc.suburb;

			const icon = L.divIcon({
				className: 'incident-pulse-icon',
				html: `<span class="incident-pulse-dot" style="--core:${corePx}px" aria-hidden="true"></span>`,
				iconSize: [iconPx, iconPx],
				iconAnchor: [iconPx / 2, iconPx / 2],
				popupAnchor: [0, -corePx / 2],
				tooltipAnchor: [0, -corePx / 2 - 4]
			});

			const marker = L.marker([point.lat, point.lng], {
				icon,
				keyboard: true,
				riseOnHover: true,
				title: '' // use Leaflet tooltip instead of native title
			});

			// Hover: total incidents for this location
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
					// open on hover (default for tooltips)
					permanent: false
				}
			);

			// Click: fuller detail
			marker.bindPopup(
				`<div style="min-width:12rem;font:12px/1.4 system-ui,sans-serif">
					<strong>${escapeHtml(loc.street || loc.suburb)}</strong><br/>
					${escapeHtml(loc.suburb)}, NSW<br/>
					<span style="color:#555">${escapeHtml(countLabel)}</span><br/>
					<span style="color:#777;font-size:11px">${precisionNote}</span>
				</div>`
			);

			markersLayer.addLayer(marker);

			// Nominatim: ~1 req/s when uncached — geocodeNswLocation caches aggressively
			await sleep(80);
		}

		if (cancelled || gen !== plotGeneration) return;

		if (latLngs.length > 0) {
			const bounds = L.latLngBounds(latLngs);
			map.fitBounds(bounds.pad(0.2), { maxZoom: 14 });
			statusText = `Showing ${mappedCount} of ${parsedCount} parsed location${parsedCount === 1 ? '' : 's'}${
				failedCount ? ` (${failedCount} could not be placed)` : ''
			}. Drag to pan · scroll or use +/− to zoom · hover a pulse for counts.`;
		} else {
			map.fitBounds(NSW_BOUNDS, { padding: [16, 16] });
			statusText = 'Parsed locations but none could be geocoded yet.';
		}

		map.invalidateSize({ animate: false });
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
		resizeObserver?.disconnect();
		resizeObserver = null;
		if (map) {
			map.remove();
			map = null;
			markersLayer = null;
		}
		Lref = null;
	});
</script>

<section
	class="flex h-full flex-col overflow-hidden rounded-lg border border-warm-200 bg-white shadow-sm"
	aria-labelledby="nsw-map-title"
>
	<div class="flex flex-wrap items-start justify-between gap-2 border-b border-warm-200 px-3 py-2.5 sm:px-4">
		<div class="min-w-0 flex-1">
			<h2 id="nsw-map-title" class="text-base font-semibold text-warm-800">
				Incident locations (NSW)
			</h2>
			<p class="mt-0.5 text-xs text-warm-500 sm:text-sm">
				Parsed from email subjects. Hover a pulse for counts; drag to pan; scroll or +/− to zoom.
			</p>
			<p class="mt-0.5 text-xs text-warm-400" aria-live="polite">{statusText}</p>
		</div>
		<button
			type="button"
			class="shrink-0 rounded-md border border-warm-200 bg-warm-50 px-2.5 py-1 text-xs font-medium text-warm-700 hover:bg-warm-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
			onclick={resetView}
			disabled={!ready}
		>
			Reset view
		</button>
	</div>
	<!-- Leaflet attaches listeners to this container; role=application marks it interactive -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={mapEl}
		class="nsw-incident-map min-h-[20rem] flex-1 w-full bg-warm-100 sm:min-h-[26rem]"
		role="application"
		aria-label="Interactive map of New South Wales. Zoom and pan to explore incident locations. Hover markers for incident counts."
		tabindex="0"
	></div>
	<div class="border-t border-warm-200 px-3 py-1.5 text-[11px] text-warm-400 sm:px-4">
		Map data © OpenStreetMap contributors · Locations assumed NSW, Australia
	</div>
</section>

<style>
	/*
	 * Map shell: ensure Leaflet can receive pointer events and sits under tooltips.
	 */
	:global(.nsw-incident-map.leaflet-container) {
		font: inherit;
		z-index: 0;
		cursor: grab;
		background: #f3f0eb;
		/* Let Leaflet own pan/zoom gestures (incl. touch) */
		touch-action: none;
	}

	:global(.nsw-incident-map.leaflet-container:active) {
		cursor: grabbing;
	}

	:global(.nsw-incident-map .leaflet-control-zoom a) {
		width: 30px;
		height: 30px;
		line-height: 30px;
		color: #3d3832;
	}

	/*
	 * Pulsing map markers — electrified.pplx.app style:
	 * solid core + expanding translucent ring.
	 */
	:global(.leaflet-div-icon.incident-pulse-icon) {
		background: transparent !important;
		border: none !important;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: visible;
		/* Larger hit target for hover */
		cursor: pointer;
	}

	:global(.incident-pulse-dot) {
		display: block;
		width: var(--core, 10px);
		height: var(--core, 10px);
		border-radius: 9999px;
		background: #0f7cb3;
		box-shadow: 0 0 0 0 #0f7cb3b3;
		animation: incident-pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
		pointer-events: auto;
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
		:global(.incident-pulse-dot) {
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
		/* override leaflet default white box */
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
</style>
