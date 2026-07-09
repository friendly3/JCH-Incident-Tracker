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
		 * Called with HH:mm when the user applies a selection.
		 * Parent owns closing (set `open` false).
		 */
		onApply?: (time: string) => void;
		/** Called when the popover should close (cancel, escape, backdrop). */
		onClose?: () => void;
	}

	let {
		open = false,
		value = '',
		title = 'Select time',
		idPrefix = 'time-picker',
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
		if (event.key === 'Enter') {
			const t = event.target;
			if (t instanceof HTMLTextAreaElement) return;
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

	function onBackdropPointerDown(event: PointerEvent) {
		// Only close when pressing the backdrop itself, not the panel.
		if (event.target === event.currentTarget) {
			event.preventDefault();
			close();
		}
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

		window.addEventListener('keydown', onWindowKeydownCapture, true);

		void tick().then(() => {
			hourSelectEl?.focus();
		});

		return () => {
			window.removeEventListener('keydown', onWindowKeydownCapture, true);
			if (previouslyFocused && document.contains(previouslyFocused)) {
				previouslyFocused.focus({ preventScroll: true });
			}
			previouslyFocused = null;
		};
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		class="time-picker-popover fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
		data-time-picker-backdrop
		onpointerdown={onBackdropPointerDown}
		role="presentation"
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={panelEl}
			id={dialogId}
			class="w-full max-w-[18rem] rounded-lg border border-warm-200 bg-white p-4 shadow-2xl dark:border-warm-300 dark:bg-warm-100"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			tabindex="-1"
			onkeydown={onPanelKeydown}
			onpointerdown={(e) => e.stopPropagation()}
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
