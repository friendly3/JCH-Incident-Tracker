<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import type { Incident } from '$lib/data/incidents';
	import {
		STREET_DETAIL_MIN_ZOOM,
		SYDNEY_CENTER,
		SYDNEY_DEFAULT_ZOOM,
		aggregatePlacesBySuburb,
		collapseOverlappingToSuburbPins,
		geocodeNswLocation,
		type GeoPoint
	} from '$lib/geocodeNsw';
	import {
		resolveIncidentLocation,
		summarizeLocationsFromSubjects,
		type LocationAggregate
	} from '$lib/parseEmailSubjectLocation';

	interface Props {
		incidents: Incident[];
		/** Active dashboard period label, e.g. "Last 30 days" — shown on the map chrome. */
		periodLabel?: string;
	}

	let { incidents, periodLabel = '' }: Props = $props();

	let mapEl = $state<HTMLDivElement | undefined>(undefined);
	let statusText = $state('Preparing map…');
	/** Distinct places plotted on the map. */
	let mappedPlaceCount = $state(0);
	/** Distinct places that parsed but failed geocoding. */
	let failedPlaceCount = $state(0);
	/** Incident totals after geocoding finishes. */
	let mappedIncidentCount = $state(0);
	let geocodeFailedIncidentCount = $state(0);
	/** Sample labels for places that failed geocoding (for legend identification). */
	let geocodeFailedSamples = $state<string[]>([]);
	let geocoding = $state(false);
	let ready = $state(false);
	let expanded = $state(false);
	/** street = individual streets; suburb = aggregated by suburb (zoom-dependent). */
	let viewMode = $state<'street' | 'suburb'>('suburb');
	let streetLevelCount = $state(0);
	let suburbLevelCount = $state(0);

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
	/** Full geocoded street-level dataset (before zoom aggregation). */
	let streetPlaces: StreetPlace[] = [];
	let labelLayoutBound = false;
	let labelLayoutTimer: ReturnType<typeof setTimeout> | null = null;
	let viewModeBound = false;
	let initialFitDone = false;

	type StreetPlace = {
		key: string;
		lat: number;
		lng: number;
		count: number;
		suburb: string;
		street: string;
		precision: GeoPoint['precision'];
		placeLabel: string;
	};

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

	/** Refs for incidents with a ref but no resolveable map location (no-ref excluded). */
	const unparseableSamples = $derived.by(() => {
		const samples: string[] = [];
		for (const row of incidents) {
			const ref = row.referenceNo?.trim();
			if (!ref) continue;
			if (resolveIncidentLocation(row)) continue;
			samples.push(ref);
			if (samples.length >= 12) break;
		}
		return samples;
	});

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
		if (!viewModeBound) {
			map.on('zoomend', onZoomModeChange);
			viewModeBound = true;
		}

		ready = true;
		await plotLocations(L, locations);
	}

	function onZoomModeChange() {
		if (!map || streetPlaces.length === 0 || geocoding) return;
		const next: 'street' | 'suburb' =
			map.getZoom() >= STREET_DETAIL_MIN_ZOOM ? 'street' : 'suburb';
		if (next !== viewMode) {
			viewMode = next;
			renderMarkersForMode(false);
		} else {
			scheduleLabelLayout();
		}
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

	function addMarkerEntry(opts: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		L: any;
		lat: number;
		lng: number;
		count: number;
		nameLine: string;
		suburbLine: string;
		placeLabel: string;
		precisionNote: string;
		popupDetail: string;
	}) {
		const corePx = Math.min(16, 8 + Math.log2(opts.count + 1) * 2.5);
		const countLabel =
			opts.count === 1 ? '1 incident' : `${opts.count} incidents`;

		const entry: MapMarkerEntry = {
			marker: null,
			lat: opts.lat,
			lng: opts.lng,
			count: opts.count,
			corePx,
			nameLine: opts.nameLine,
			suburbLine: opts.suburbLine,
			placeLabel: opts.placeLabel,
			side: 'right',
			sideOffset: 0
		};

		const marker = opts.L.marker([opts.lat, opts.lng], {
			icon: buildMarkerIcon(entry, opts.L),
			keyboard: true,
			riseOnHover: true,
			title: opts.placeLabel,
			zIndexOffset: Math.round(opts.count * 10)
		});
		entry.marker = marker;

		marker.bindTooltip(
			`<div class="incident-map-tooltip-inner">
				<span class="incident-map-tooltip-count">${escapeHtml(countLabel)}</span>
				<span class="incident-map-tooltip-place">${escapeHtml(opts.placeLabel)}</span>
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
				<strong>${escapeHtml(opts.nameLine)}</strong><br/>
				${escapeHtml(opts.popupDetail)}<br/>
				<span style="color:#555">${escapeHtml(countLabel)}</span><br/>
				<span style="color:#777;font-size:11px">${escapeHtml(opts.precisionNote)}</span>
			</div>`
		);

		markersLayer.addLayer(marker);
		placedMarkers.push(entry);
	}

	/**
	 * Draw markers for the current zoom mode from `streetPlaces`.
	 * - Suburb mode: one pin per suburb
	 * - Street mode: one pin per geocode; overlapping positions collapse to a
	 *   single pin labelled with the suburb (not fanned-out streets)
	 */
	function renderMarkersForMode(fitBounds: boolean) {
		if (!map || !markersLayer || !Lref) return;

		const L = Lref;
		markersLayer.clearLayers();
		placedMarkers = [];

		const zoom = map.getZoom() as number;
		viewMode = zoom >= STREET_DETAIL_MIN_ZOOM ? 'street' : 'suburb';

		if (streetPlaces.length === 0) {
			mappedPlaceCount = 0;
			statusText = 'No geocoded places to show.';
			return;
		}

		if (viewMode === 'suburb') {
			const suburbs = aggregatePlacesBySuburb(
				streetPlaces.map((p) => ({
					key: p.key,
					lat: p.lat,
					lng: p.lng,
					count: p.count,
					suburb: p.suburb,
					street: p.street,
					precision: p.precision
				}))
			);
			suburbLevelCount = suburbs.length;

			for (const s of suburbs) {
				addMarkerEntry({
					L,
					lat: s.lat,
					lng: s.lng,
					count: s.count,
					nameLine: s.suburb,
					suburbLine: `${s.placeCount} location${s.placeCount === 1 ? '' : 's'} · NSW`,
					placeLabel: s.suburb,
					precisionNote: `Suburb total · zoom in (level ${STREET_DETAIL_MIN_ZOOM}+) for detail`,
					popupDetail: `${s.suburb}, NSW · ${s.placeCount} location${s.placeCount === 1 ? '' : 's'}`
				});
			}

			mappedPlaceCount = suburbs.length;
			statusText = `Suburb view: ${suburbs.length} suburb${suburbs.length === 1 ? '' : 's'} (${mappedIncidentCount} incidents). Zoom in to level ${STREET_DETAIL_MIN_ZOOM}+ for more detail.`;
		} else {
			// Overlapping coords → one indicator, suburb label only
			const collapsed = collapseOverlappingToSuburbPins(
				streetPlaces.map((p) => ({
					key: p.key,
					lat: p.lat,
					lng: p.lng,
					count: p.count,
					suburb: p.suburb,
					street: p.street,
					precision: p.precision
				})),
				4 // ~11 m grid — treats near-identical pins as one
			);

			for (const p of collapsed) {
				const isMerged = p.merged;
				const nameLine = isMerged || !p.street ? p.suburb : p.street;
				const suburbLine = isMerged
					? `${p.placeCount} locations · NSW`
					: p.street
						? p.suburb
						: 'NSW';
				const placeLabel = isMerged || !p.street ? p.suburb : `${p.street}, ${p.suburb}`;
				const streetsNote =
					isMerged && p.streets.length
						? p.streets.slice(0, 8).join(', ') +
							(p.streets.length > 8 ? ` (+${p.streets.length - 8} more)` : '')
						: '';

				addMarkerEntry({
					L,
					lat: p.lat,
					lng: p.lng,
					count: p.count,
					nameLine,
					suburbLine,
					placeLabel,
					precisionNote: isMerged
						? 'Overlapping locations combined · suburb label'
						: p.precision === 'street'
							? 'Street-level geocode'
							: 'Approx. location',
					popupDetail: isMerged
						? `${p.suburb}, NSW${streetsNote ? `<br/><span style="color:#555">${escapeHtml(streetsNote)}</span>` : ''}`
						: `${p.suburb}, NSW`
				});
			}

			mappedPlaceCount = collapsed.length;
			const mergedCount = collapsed.filter((p) => p.merged).length;
			statusText =
				mergedCount > 0
					? `Showing ${collapsed.length} indicator${collapsed.length === 1 ? '' : 's'} (${mergedCount} combined where locations overlapped · labelled by suburb).`
					: `Showing ${collapsed.length} location${collapsed.length === 1 ? '' : 's'}. Overlapping pins combine into one suburb label.`;
		}

		if (fitBounds && placedMarkers.length > 0) {
			const group = L.featureGroup(placedMarkers.map((p) => p.marker));
			// Cap suburb overview below street-detail zoom so the default view
			// never flips into street pins after fitBounds.
			const suburbMaxZoom = STREET_DETAIL_MIN_ZOOM - 1;
			map.fitBounds(group.getBounds().pad(0.22), {
				maxZoom: viewMode === 'street' ? 15 : suburbMaxZoom,
				animate: false,
				padding: [28, 28]
			});
			// Re-evaluate mode after fit (fit may change zoom)
			const afterZoom = map.getZoom() as number;
			const afterMode: 'street' | 'suburb' =
				afterZoom >= STREET_DETAIL_MIN_ZOOM ? 'street' : 'suburb';
			if (afterMode !== viewMode) {
				viewMode = afterMode;
				renderMarkersForMode(false);
				return;
			}
		}

		map.invalidateSize({ animate: false });
		requestAnimationFrame(() => resolveLabelLayout());
		setTimeout(() => resolveLabelLayout(), 120);
		setTimeout(() => resolveLabelLayout(), 400);
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
		streetPlaces = [];
		mappedPlaceCount = 0;
		failedPlaceCount = 0;
		mappedIncidentCount = 0;
		geocodeFailedIncidentCount = 0;
		geocodeFailedSamples = [];
		streetLevelCount = 0;
		suburbLevelCount = 0;
		geocoding = true;
		initialFitDone = false;

		if (locs.length === 0) {
			statusText =
				summary.totalIncidents === 0
					? 'No incidents to map yet.'
					: 'No parseable locations in email subjects yet.';
			applySydneyView(false);
			geocoding = false;
			return;
		}

		statusText = `Geocoding ${locs.length} street location${locs.length === 1 ? '' : 's'}…`;

		const geocoded: StreetPlace[] = [];
		const failedSamples: string[] = [];

		for (let i = 0; i < locs.length; i++) {
			if (cancelled || gen !== plotGeneration) return;
			const loc = locs[i];
			statusText = `Geocoding street ${i + 1} of ${locs.length}…`;

			const point: GeoPoint | null = await geocodeNswLocation(loc.query, loc.suburb, {
				street: loc.street
			});
			if (cancelled || gen !== plotGeneration) return;

			if (!point) {
				failedPlaceCount += 1;
				geocodeFailedIncidentCount += loc.count;
				const placeLabel = loc.street ? `${loc.street}, ${loc.suburb}` : loc.suburb;
				const sampleRef = loc.samples[0] ? ` (${loc.samples[0]})` : '';
				if (failedSamples.length < 12) {
					failedSamples.push(
						loc.count > 1
							? `${placeLabel} ×${loc.count}${sampleRef}`
							: `${placeLabel}${sampleRef}`
					);
				}
				// Pace lightly even on failure
				await sleep(150);
				continue;
			}

			mappedIncidentCount += loc.count;
			if (point.precision === 'street') streetLevelCount += 1;

			const placeLabel = loc.street
				? `${loc.street}, ${loc.suburb}`
				: loc.suburb;

			geocoded.push({
				key: loc.key,
				lat: point.lat,
				lng: point.lng,
				count: loc.count,
				suburb: loc.suburb,
				street: loc.street,
				precision: point.precision,
				placeLabel
			});

			// Nominatim courtesy via server (~1/s when uncached)
			await sleep(point.precision === 'street' ? 900 : 120);
		}

		if (cancelled || gen !== plotGeneration) return;

		streetPlaces = geocoded;
		geocodeFailedSamples = failedSamples;
		geocoding = false;

		if (streetPlaces.length === 0) {
			applySydneyView(false);
			statusText = 'Parsed locations but none could be geocoded yet.';
			return;
		}

		// Default load: suburb overview only (street detail requires user zoom-in)
		const suburbMaxZoom = STREET_DETAIL_MIN_ZOOM - 1;
		if (map.getZoom() > suburbMaxZoom) {
			map.setZoom(Math.min(SYDNEY_DEFAULT_ZOOM, suburbMaxZoom), { animate: false });
		}
		renderMarkersForMode(true);
		// Hard clamp: initial fit must not leave the map in street mode
		if (map.getZoom() >= STREET_DETAIL_MIN_ZOOM) {
			map.setZoom(suburbMaxZoom, { animate: false });
			viewMode = 'suburb';
			renderMarkersForMode(false);
		}
		initialFitDone = true;
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
			map.off('zoomend', onZoomModeChange);
			map.remove();
			map = null;
			markersLayer = null;
		}
		placedMarkers = [];
		streetPlaces = [];
		labelLayoutBound = false;
		viewModeBound = false;
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
			<div class="flex flex-wrap items-center gap-2">
				<h2 id="nsw-map-title" class="text-base font-semibold text-warm-800">
					Incident locations (NSW)
				</h2>
				{#if periodLabel.trim()}
					<span
						class="inline-flex items-center rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 text-[10px] font-medium tabular-nums text-accent-700 dark:border-accent-200/40 dark:bg-accent-100/30 dark:text-accent-600"
						title="Map pins reflect the dashboard period filter"
					>
						{periodLabel.trim()}
					</span>
				{/if}
			</div>
			<p class="mt-0.5 text-xs text-warm-500 sm:text-sm">
				{#if viewMode === 'suburb'}
					Suburb totals (zoom to {STREET_DETAIL_MIN_ZOOM}+ for street locations). Hover for counts.
				{:else}
					Street locations. Zoom out below {STREET_DETAIL_MIN_ZOOM} for suburb totals.
				{/if}
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
						<span class="font-medium text-warm-800">
							{viewMode === 'suburb' ? 'Suburb total' : 'Street location'}
						</span>
						<span class="mt-0.5 block text-[11px] text-warm-500">
							{#if geocoding}
								Geocoding streets…
							{:else if viewMode === 'suburb'}
								{mappedIncidentCount} incident{mappedIncidentCount === 1 ? '' : 's'}
								· {mappedPlaceCount} suburb{mappedPlaceCount === 1 ? '' : 's'}
								· zoom in for streets
							{:else}
								{mappedIncidentCount} incident{mappedIncidentCount === 1 ? '' : 's'}
								· {mappedPlaceCount} street pin{mappedPlaceCount === 1 ? '' : 's'}
								({streetLevelCount} precise)
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
				<div class="mt-1.5 max-h-40 space-y-1.5 overflow-y-auto border-t border-warm-100 pt-1.5 text-[10px] leading-snug text-warm-500">
					{#if summary.unparseableIncidentCount > 0}
						<p>
							<span class="font-semibold text-warm-700"
								>{summary.unparseableIncidentCount} need a location</span
							>
							— set suburb under Map location on the incident, or use
							<strong class="font-medium text-warm-600">Missing map location</strong> on
							the Incidents list
							{#if periodLabel}
								<span class="text-warm-400"> (list is all-time; map is {periodLabel})</span>
							{/if}
						</p>
						{#if unparseableSamples.length > 0}
							<ul class="list-inside list-disc space-y-0.5 pl-0.5 font-mono text-[10px] text-warm-600">
								{#each unparseableSamples as sample, idx (idx)}
									<li class="break-all">{sample}</li>
								{/each}
								{#if summary.unparseableIncidentCount > unparseableSamples.length}
									<li class="list-none text-warm-400">
										…and {summary.unparseableIncidentCount - unparseableSamples.length} more
									</li>
								{/if}
							</ul>
						{/if}
					{/if}
					{#if geocodeFailedIncidentCount > 0}
						<p>
							<span class="font-semibold text-warm-700"
								>{geocodeFailedIncidentCount} could not be geocoded</span
							>
							({failedPlaceCount} place{failedPlaceCount === 1 ? '' : 's'}) — check spelling or
							set a clearer suburb
						</p>
						{#if geocodeFailedSamples.length > 0}
							<ul class="list-inside list-disc space-y-0.5 pl-0.5 font-mono text-[10px] text-warm-600">
								{#each geocodeFailedSamples as sample, idx (idx)}
									<li class="break-all">{sample}</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</div>
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
