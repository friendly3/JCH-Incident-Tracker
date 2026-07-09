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
		/** Element to anchor the fixed popover under (time field wrap). */
		anchorEl?: HTMLElement | null;
		/**
		 * Called with HH:mm when the user applies a selection.
		 * Parent owns closing (set `open` false); this component does not call `onClose` after apply.
		 */
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
	const dialogId = $derived(`${idPrefix}-dialog`);
	const titleId = $derived(`${idPrefix}-title`);

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

	/** Apply selected time. Parent owns closing via onApply handler. */
	function apply() {
		onApply?.(`${hour}:${minute}`);
	}

	function positionPanel() {
		const anchor = anchorEl;
		if (!anchor) {
			panelStyle = 'top: 50%; left: 50%; transform: translate(-50%, -50%);';
			return;
		}
		const rect = anchor.getBoundingClientRect();
		const gap = 6;
		const margin = 8;
		const measured = panelEl?.getBoundingClientRect();
		const width = measured && measured.width > 0
			? Math.min(window.innerWidth - margin * 2, measured.width)
			: Math.min(window.innerWidth - margin * 2, 264);
		const height = measured && measured.height > 0 ? measured.height : 180;

		let left = rect.left;
		if (left + width > window.innerWidth - margin) {
			left = Math.max(margin, window.innerWidth - width - margin);
		}
		left = Math.max(margin, left);

		// Prefer below the field; flip above if not enough room for measured height.
		const spaceBelow = window.innerHeight - rect.bottom - gap;
		const spaceAbove = rect.top - gap;
		let top: number;
		if (spaceBelow >= height || spaceBelow >= spaceAbove) {
			top = rect.bottom + gap;
		} else {
			top = rect.top - gap - height;
		}
		// Clamp into the viewport so the panel stays fully visible when possible.
		const maxTop = Math.max(margin, window.innerHeight - height - margin);
		top = Math.min(Math.max(margin, top), maxTop);

		panelStyle = `top: ${Math.round(top)}px; left: ${Math.round(left)}px; width: ${Math.round(width)}px;`;
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
			// Capture-phase window listener is primary; this is a bubble fallback.
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (event.key === 'Enter') {
			const t = event.target;
			if (t instanceof HTMLTextAreaElement) return;
			// Let focused buttons activate via their own click/keydown handling.
			if (t instanceof HTMLButtonElement) return;
			event.preventDefault();
			event.stopPropagation();
			apply();
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

	/**
	 * Window capture Escape must win over the incidents page modal's
	 * svelte:window onkeydowncapture, which otherwise closes the editor.
	 * Host page also early-returns when focus is inside .time-picker-popover.
	 */
	function onWindowKeydownCapture(event: KeyboardEvent) {
		if (!open) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		close();
	}

	$effect(() => {
		if (!open) return;

		// Seed hour/minute only from value at open — do not re-init when parent
		// reassigns form fields while the popover stays open.
		const parsed = parseValue(untrack(() => value));
		hour = parsed.h;
		minute = parsed.m;
		previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;

		// Track anchor for reposition; untrack panel reads inside positionPanel's first call.
		void anchorEl;

		positionPanel();

		const onDoc = (e: PointerEvent) => onDocumentPointerDown(e);
		const onReposition = () => positionPanel();
		window.addEventListener('keydown', onWindowKeydownCapture, true);
		document.addEventListener('pointerdown', onDoc, true);
		window.addEventListener('resize', onReposition);
		// Capture scroll on any scrollable ancestor (form body, window).
		window.addEventListener('scroll', onReposition, true);

		void tick().then(() => {
			// Reposition with real measured panel height/width after paint.
			positionPanel();
			hourSelectEl?.focus();
		});

		return () => {
			window.removeEventListener('keydown', onWindowKeydownCapture, true);
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
		id={dialogId}
		class="time-picker-popover fixed z-[80] rounded-md border border-warm-200 bg-white p-3 shadow-lg dark:border-warm-300 dark:bg-warm-100"
		style={panelStyle}
		role="dialog"
		aria-modal="false"
		aria-labelledby={titleId}
		tabindex="-1"
		onkeydown={onPanelKeydown}
	>
		<p
			id={titleId}
			class="mb-2 text-xs font-semibold uppercase tracking-wide text-warm-500 dark:text-warm-600"
		>
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
