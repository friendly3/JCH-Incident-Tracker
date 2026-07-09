<script lang="ts">
	import { tick } from 'svelte';
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
		/** Element to anchor the fixed popover under (time field wrap). */
		anchorEl?: HTMLElement | null;
		/** Called with HH:mm when the user applies a selection. */
		onApply?: (time: string) => void;
		/** Called when the popover should close (cancel, escape, outside click). */
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

	const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
	const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

	let hour = $state('00');
	let minute = $state('00');
	let panelEl = $state<HTMLDivElement | undefined>(undefined);
	let hourSelectEl = $state<HTMLSelectElement | undefined>(undefined);
	let panelStyle = $state('');
	let previouslyFocused: HTMLElement | null = null;

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
		onClose?.();
	}

	function positionPanel() {
		const anchor = anchorEl;
		if (!anchor) {
			panelStyle = 'top: 50%; left: 50%; transform: translate(-50%, -50%);';
			return;
		}
		const rect = anchor.getBoundingClientRect();
		const gap = 6;
		const width = Math.min(window.innerWidth - 16, 264);
		const estimatedHeight = 180;
		let left = rect.left;
		if (left + width > window.innerWidth - 8) {
			left = Math.max(8, window.innerWidth - width - 8);
		}
		// Prefer below the field; flip above if not enough room.
		const spaceBelow = window.innerHeight - rect.bottom - gap;
		const spaceAbove = rect.top - gap;
		if (spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove) {
			panelStyle = `top: ${Math.round(rect.bottom + gap)}px; left: ${Math.round(left)}px; width: ${width}px;`;
		} else {
			panelStyle = `top: ${Math.round(rect.top - gap - estimatedHeight)}px; left: ${Math.round(left)}px; width: ${width}px;`;
		}
	}

	function focusables(): HTMLElement[] {
		if (!panelEl) return [];
		const nodes = panelEl.querySelectorAll<HTMLElement>(
			'button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
		);
		return Array.from(nodes).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
	}

	function onPanelKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (event.key !== 'Tab' || !panelEl) return;
		const items = focusables();
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement as HTMLElement | null;
		if (event.shiftKey) {
			if (active === first || !panelEl.contains(active)) {
				event.preventDefault();
				last.focus();
			}
		} else if (active === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function onDocumentPointerDown(event: PointerEvent) {
		if (!open || !panelEl) return;
		const target = event.target;
		if (!(target instanceof Node)) return;
		if (panelEl.contains(target)) return;
		// Ignore the clock button that toggles this picker.
		if (target instanceof Element && target.closest('[data-time-picker-trigger]')) return;
		close();
	}

	$effect(() => {
		if (!open) return;

		const parsed = parseValue(value);
		hour = parsed.h;
		minute = parsed.m;
		previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;

		positionPanel();

		const onDoc = (e: PointerEvent) => onDocumentPointerDown(e);
		const onReposition = () => positionPanel();
		document.addEventListener('pointerdown', onDoc, true);
		window.addEventListener('resize', onReposition);
		// Capture scroll on any scrollable ancestor (form body, window).
		window.addEventListener('scroll', onReposition, true);

		void tick().then(() => {
			positionPanel();
			hourSelectEl?.focus();
		});

		return () => {
			document.removeEventListener('pointerdown', onDoc, true);
			window.removeEventListener('resize', onReposition);
			window.removeEventListener('scroll', onReposition, true);
			if (previouslyFocused && document.contains(previouslyFocused)) {
				previouslyFocused.focus({ preventScroll: true });
			}
			previouslyFocused = null;
		};
	});
</script>

{#if open}
	<div
		bind:this={panelEl}
		class="time-picker-popover fixed z-[80] rounded-md border border-warm-200 bg-white p-3 shadow-lg dark:border-warm-300 dark:bg-warm-100"
		style={panelStyle}
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		onkeydown={onPanelKeydown}
	>
		<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-500 dark:text-warm-600">
			{title}
		</p>
		<div class="flex items-end gap-2">
			<div class="min-w-0 flex-1">
				<label class="mb-1 block text-xs text-warm-600" for={hourId}>Hour</label>
				<select
					id={hourId}
					bind:this={hourSelectEl}
					bind:value={hour}
					class="input-focus w-full rounded-md border border-warm-200 bg-white px-2 py-1.5 text-sm text-warm-800 dark:bg-warm-200 dark:text-warm-900"
				>
					{#each HOURS as h}
						<option value={h}>{h}</option>
					{/each}
				</select>
			</div>
			<span class="pb-1.5 text-lg font-semibold text-warm-500" aria-hidden="true">:</span>
			<div class="min-w-0 flex-1">
				<label class="mb-1 block text-xs text-warm-600" for={minuteId}>Minute</label>
				<select
					id={minuteId}
					bind:value={minute}
					class="input-focus w-full rounded-md border border-warm-200 bg-white px-2 py-1.5 text-sm text-warm-800 dark:bg-warm-200 dark:text-warm-900"
				>
					{#each MINUTES as m}
						<option value={m}>{m}</option>
					{/each}
				</select>
			</div>
		</div>
		<div class="mt-3 flex items-center justify-end gap-2">
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
{/if}
