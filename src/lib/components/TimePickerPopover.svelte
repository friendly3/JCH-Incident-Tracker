<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { normalizeTimeField } from '$lib/formatDate';

	interface Props {
		/** Whether the popover is open. */
		open?: boolean;
		/** Current time value in HH:mm (or empty). */
		value?: string;
		/** Accessible dialog title. */
		title?: string;
		/** Prefix for control ids (unique when multiple pickers exist). */
		idPrefix?: string;
		/**
		 * Element to anchor the popover under (typically the time field wrap).
		 * When omitted, falls back to a centered placement near the top of the viewport.
		 */
		anchorEl?: HTMLElement | null;
		/**
		 * Called with HH:mm when the user applies a selection.
		 * Parent owns closing (set `open` false).
		 */
		onApply?: (time: string) => void;
		/** Called when the popover should close (cancel, escape, click-outside). */
		onClose?: () => void;
	}

	let {
		open = false,
		value = '',
		title = 'Select time',
		idPrefix = 'time-picker',
		anchorEl = null,
		onApply,
		onClose
	}: Props = $props();

	const hourId = $derived(`${idPrefix}-hour`);
	const minuteId = $derived(`${idPrefix}-minute`);
	const dialogId = $derived(`${idPrefix}-dialog`);
	const titleId = $derived(`${idPrefix}-title`);

	const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

	let hour = $state('00');
	let minute = $state('00');
	let panelEl = $state<HTMLDivElement | undefined>(undefined);
	let hourSelectEl = $state<HTMLSelectElement | undefined>(undefined);
	let previouslyFocused: HTMLElement | null = null;
	/** Portal host on document.body so modal overflow cannot clip the dialog. */
	let portalHost: HTMLDivElement | null = null;
	let panelStyle = $state('top: 0; left: 0; visibility: hidden;');

	const PANEL_GAP_PX = 6;
	const VIEWPORT_PAD_PX = 8;

	function parseValue(raw: string): { h: string; m: string } {
		const t = normalizeTimeField(raw);
		if (/^\d{1,2}:\d{2}$/.test(t)) {
			const [hs, ms] = t.split(':');
			const hNum = Math.min(23, Math.max(0, parseInt(hs, 10)));
			const mNum = Math.min(59, Math.max(0, parseInt(ms, 10)));
			if (!Number.isNaN(hNum) && !Number.isNaN(mNum)) {
				return { h: String(hNum).padStart(2, '0'), m: String(mNum).padStart(2, '0') };
			}
		}
		const now = new Date();
		return {
			h: String(now.getHours()).padStart(2, '0'),
			m: String(now.getMinutes()).padStart(2, '0')
		};
	}

	function close() {
		onClose?.();
	}

	function apply() {
		onApply?.(`${hour}:${minute}`);
	}

	function onPanelKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (event.key === 'Enter') {
			const t = event.target;
			if (t instanceof HTMLTextAreaElement) return;
			if (t instanceof HTMLButtonElement) return;
			event.preventDefault();
			event.stopPropagation();
			apply();
			// Enter applies; do not trap Tab — non-modal popover allows focus to leave.
		}
	}

	/**
	 * Non-modal popover: when focus leaves the panel and the anchor field,
	 * close so keyboard users can Tab into the rest of the form.
	 */
	function onPanelFocusOut(event: FocusEvent) {
		const next = event.relatedTarget;
		if (next instanceof Node) {
			if (panelEl?.contains(next)) return;
			if (anchorEl?.contains(next)) return;
		}
		// relatedTarget is often null for Tab-to-browser-chrome; check after focus moves
		requestAnimationFrame(() => {
			if (!open) return;
			const active = document.activeElement;
			if (active instanceof Node) {
				if (panelEl?.contains(active)) return;
				if (anchorEl?.contains(active)) return;
			}
			// Focus left the popover/anchor entirely
			close();
		});
	}

	/**
	 * Capture Escape on window so the host page modal does not steal it.
	 */
	function onWindowKeydownCapture(event: KeyboardEvent) {
		if (!open) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		close();
	}

	/** Click/tap outside the panel (and outside the anchor) closes the popover. */
	function onDocumentPointerDown(event: PointerEvent) {
		if (!open) return;
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (panelEl?.contains(target)) return;
		if (anchorEl?.contains(target)) return;
		close();
	}

	/**
	 * Position the compact panel just under the anchor field.
	 * Flips above the field when there is not enough room below.
	 */
	function positionPanel() {
		const panel = panelEl;
		if (!panel) return;

		const panelRect = panel.getBoundingClientRect();
		const panelW = panelRect.width || 288;
		const panelH = panelRect.height || 220;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let top: number;
		let left: number;

		if (anchorEl) {
			const a = anchorEl.getBoundingClientRect();
			top = a.bottom + PANEL_GAP_PX;
			left = a.left;
			// Prefer right-align to field when field is narrower than panel
			if (a.width > 0 && a.width < panelW) {
				left = a.right - panelW;
			}
			// Flip above if overflowing bottom
			if (top + panelH + VIEWPORT_PAD_PX > vh && a.top - PANEL_GAP_PX - panelH >= VIEWPORT_PAD_PX) {
				top = a.top - PANEL_GAP_PX - panelH;
			}
		} else {
			top = Math.max(VIEWPORT_PAD_PX, Math.round(vh * 0.2));
			left = Math.round((vw - panelW) / 2);
		}

		// Clamp into viewport
		left = Math.min(Math.max(VIEWPORT_PAD_PX, left), Math.max(VIEWPORT_PAD_PX, vw - panelW - VIEWPORT_PAD_PX));
		top = Math.min(Math.max(VIEWPORT_PAD_PX, top), Math.max(VIEWPORT_PAD_PX, vh - panelH - VIEWPORT_PAD_PX));

		panelStyle = `top: ${Math.round(top)}px; left: ${Math.round(left)}px; visibility: visible;`;
	}

	/** Move the dialog tree onto document.body (escape overflow/stacking). */
	function portal(node: HTMLElement) {
		if (typeof document === 'undefined') return {};
		const host = document.createElement('div');
		host.className = 'time-picker-portal-root';
		host.setAttribute('data-time-picker-portal', idPrefix);
		document.body.appendChild(host);
		host.appendChild(node);
		portalHost = host;
		return {
			destroy() {
				if (host.parentNode) host.parentNode.removeChild(host);
				if (portalHost === host) portalHost = null;
			}
		};
	}

	$effect(() => {
		if (!open) return;

		const parsed = parseValue(untrack(() => value));
		hour = parsed.h;
		minute = parsed.m;
		previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;

		// Hide until measured to avoid a flash at 0,0
		panelStyle = 'top: 0; left: 0; visibility: hidden;';

		window.addEventListener('keydown', onWindowKeydownCapture, true);
		// Capture phase so we close before other UI handles the same click
		document.addEventListener('pointerdown', onDocumentPointerDown, true);
		window.addEventListener('resize', positionPanel);
		// Reposition when the host modal scrolls
		window.addEventListener('scroll', positionPanel, true);

		void tick().then(() => {
			positionPanel();
			// Second pass after fonts/layout settle
			requestAnimationFrame(() => {
				positionPanel();
				hourSelectEl?.focus();
			});
		});

		return () => {
			window.removeEventListener('keydown', onWindowKeydownCapture, true);
			document.removeEventListener('pointerdown', onDocumentPointerDown, true);
			window.removeEventListener('resize', positionPanel);
			window.removeEventListener('scroll', positionPanel, true);
			// Restore trigger focus only when focus is still in the panel (or lost).
			// If the user Tabbed out into the form, leave focus where it is.
			const active = document.activeElement;
			const focusStillInPanel =
				!active ||
				active === document.body ||
				(panelEl != null && panelEl.contains(active));
			if (
				focusStillInPanel &&
				previouslyFocused &&
				document.contains(previouslyFocused)
			) {
				previouslyFocused.focus({ preventScroll: true });
			}
			previouslyFocused = null;
		};
	});
</script>

{#if open}
	<!-- Compact popover: portaled, no dimming fullscreen overlay -->
	<div use:portal class="contents">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={panelEl}
			id={dialogId}
			class="time-picker-panel fixed z-[200] w-[min(18rem,calc(100vw-1rem))] rounded-lg border border-warm-200 bg-white p-4 shadow-2xl dark:border-warm-300 dark:bg-warm-100"
			style={panelStyle}
			role="dialog"
			aria-modal="false"
			aria-labelledby={titleId}
			data-time-picker-panel
			tabindex="-1"
			onkeydown={onPanelKeydown}
			onfocusout={onPanelFocusOut}
		>
			<p
				id={titleId}
				class="mb-3 text-sm font-semibold text-warm-800 dark:text-warm-900"
			>
				{title}
			</p>
			<div class="flex items-end gap-2">
				<div class="min-w-0 flex-1">
					<label class="mb-1 block text-xs font-medium text-warm-600" for={hourId}>Hour</label>
					<select
						id={hourId}
						bind:this={hourSelectEl}
						bind:value={hour}
						class="input-focus w-full rounded-md border border-warm-200 bg-white px-2 py-2 text-sm text-warm-800 dark:bg-warm-200 dark:text-warm-900"
					>
						{#each HOURS as h (h)}
							<option value={h}>{h}</option>
						{/each}
					</select>
				</div>
				<span class="pb-2 text-lg font-semibold text-warm-500" aria-hidden="true">:</span>
				<div class="min-w-0 flex-1">
					<label class="mb-1 block text-xs font-medium text-warm-600" for={minuteId}>Minute</label>
					<select
						id={minuteId}
						bind:value={minute}
						class="input-focus w-full rounded-md border border-warm-200 bg-white px-2 py-2 text-sm text-warm-800 dark:bg-warm-200 dark:text-warm-900"
					>
						{#each MINUTES as m (m)}
							<option value={m}>{m}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="mt-4 flex items-center justify-end gap-2">
				<button
					type="button"
					class="rounded-md border border-warm-300 bg-white px-3 py-1.5 text-sm text-warm-700 hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-200 dark:hover:bg-warm-300"
					onclick={close}
				>
					Cancel
				</button>
				<button
					type="button"
					class="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
					onclick={apply}
				>
					Apply
				</button>
			</div>
		</div>
	</div>
{/if}
