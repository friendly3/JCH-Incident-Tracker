<script lang="ts">
	import { tick, untrack } from 'svelte';

	interface Props {
		/** Whether the popover is open. */
		open?: boolean;
		/** Current date value in YYYY-MM-DD (or empty). */
		value?: string;
		/** Accessible dialog title. */
		title?: string;
		/** Prefix for control ids (unique when multiple pickers exist). */
		idPrefix?: string;
		/**
		 * Element to anchor the popover under (typically the date field wrap).
		 * When omitted, falls back to a centered placement near the top of the viewport.
		 */
		anchorEl?: HTMLElement | null;
		/**
		 * Called with YYYY-MM-DD when the user applies a selection.
		 * Parent owns closing (set `open` false).
		 */
		onApply?: (date: string) => void;
		/** Called when the popover should close (cancel, escape, click-outside). */
		onClose?: () => void;
	}

	let {
		open = false,
		value = '',
		title = 'Select date',
		idPrefix = 'date-picker',
		anchorEl = null,
		onApply,
		onClose
	}: Props = $props();

	const dialogId = $derived(`${idPrefix}-dialog`);
	const titleId = $derived(`${idPrefix}-title`);
	const monthId = $derived(`${idPrefix}-month`);
	const yearId = $derived(`${idPrefix}-year`);

	const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
	const MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	] as const;

	let viewYear = $state(new Date().getFullYear());
	let viewMonth = $state(new Date().getMonth()); // 0-11
	let selectedYear = $state(new Date().getFullYear());
	let selectedMonth = $state(new Date().getMonth());
	let selectedDay = $state(new Date().getDate());
	let panelEl = $state<HTMLDivElement | undefined>(undefined);
	let monthSelectEl = $state<HTMLSelectElement | undefined>(undefined);
	let previouslyFocused: HTMLElement | null = null;
	/** Portal host on document.body so modal overflow cannot clip the dialog. */
	let portalHost: HTMLDivElement | null = null;
	let panelStyle = $state('top: 0; left: 0; visibility: hidden;');

	const PANEL_GAP_PX = 6;
	const VIEWPORT_PAD_PX = 8;

	const yearOptions = $derived.by(() => {
		const center = viewYear;
		const start = Math.min(center - 40, selectedYear - 5, new Date().getFullYear() - 5);
		const end = Math.max(center + 10, selectedYear + 5, new Date().getFullYear() + 5);
		const years: number[] = [];
		for (let y = start; y <= end; y++) years.push(y);
		return years;
	});

	/** Calendar cells for the viewed month (Mon-first). Null = empty padding. */
	const calendarCells = $derived.by(() => {
		const first = new Date(viewYear, viewMonth, 1);
		// JS: 0=Sun..6=Sat → Mon-first index 0..6
		const startPad = (first.getDay() + 6) % 7;
		const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
		const cells: Array<{ day: number; y: number; m: number } | null> = [];
		for (let i = 0; i < startPad; i++) cells.push(null);
		for (let d = 1; d <= daysInMonth; d++) {
			cells.push({ day: d, y: viewYear, m: viewMonth });
		}
		// Pad to full weeks for stable layout
		while (cells.length % 7 !== 0) cells.push(null);
		return cells;
	});

	/** Weeks for role="row" grouping (screen-reader grid structure). */
	const calendarWeeks = $derived.by(() => {
		const weeks: Array<Array<{ day: number; y: number; m: number } | null>> = [];
		const cells = calendarCells;
		for (let i = 0; i < cells.length; i += 7) {
			weeks.push(cells.slice(i, i + 7));
		}
		return weeks;
	});

	/** Flat list of day cells only (for arrow-key roving). */
	const dayCells = $derived(calendarCells.filter((c): c is { day: number; y: number; m: number } => c != null));

	function parseValue(raw: string): { y: number; m: number; d: number } {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw?.trim() ?? '');
		if (match) {
			const y = parseInt(match[1], 10);
			const m = parseInt(match[2], 10) - 1;
			const d = parseInt(match[3], 10);
			const check = new Date(y, m, d);
			if (
				!Number.isNaN(check.getTime()) &&
				check.getFullYear() === y &&
				check.getMonth() === m &&
				check.getDate() === d
			) {
				return { y, m, d };
			}
		}
		const now = new Date();
		return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
	}

	function formatYmd(y: number, m: number, d: number): string {
		return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}

	function close() {
		onClose?.();
	}

	function apply() {
		onApply?.(formatYmd(selectedYear, selectedMonth, selectedDay));
	}

	function selectDay(y: number, m: number, d: number) {
		selectedYear = y;
		selectedMonth = m;
		selectedDay = d;
	}

	function isSelected(y: number, m: number, d: number): boolean {
		return y === selectedYear && m === selectedMonth && d === selectedDay;
	}

	function isToday(y: number, m: number, d: number): boolean {
		const now = new Date();
		return y === now.getFullYear() && m === now.getMonth() && d === now.getDate();
	}

	/** Only one day is in the tab order (selected if in view, else first of month). */
	function dayTabIndex(y: number, m: number, d: number): number {
		if (viewYear === selectedYear && viewMonth === selectedMonth) {
			return d === selectedDay ? 0 : -1;
		}
		return d === 1 ? 0 : -1;
	}

	function dayButtonId(y: number, m: number, d: number): string {
		return `${idPrefix}-day-${formatYmd(y, m, d)}`;
	}

	function focusDayButton(y: number, m: number, d: number) {
		const el = document.getElementById(dayButtonId(y, m, d));
		if (el instanceof HTMLElement) el.focus();
	}

	/**
	 * Move selection by delta days within the viewed month; clamps to month bounds.
	 * Changes view month when leaving the current month edges.
	 */
	function moveSelection(deltaDays: number) {
		const base =
			viewYear === selectedYear && viewMonth === selectedMonth
				? new Date(selectedYear, selectedMonth, selectedDay)
				: new Date(viewYear, viewMonth, 1);
		const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays);
		viewYear = next.getFullYear();
		viewMonth = next.getMonth();
		selectedYear = next.getFullYear();
		selectedMonth = next.getMonth();
		selectedDay = next.getDate();
		void tick().then(() => focusDayButton(selectedYear, selectedMonth, selectedDay));
	}

	function prevMonth() {
		if (viewMonth === 0) {
			viewMonth = 11;
			viewYear -= 1;
		} else {
			viewMonth -= 1;
		}
	}

	function nextMonth() {
		if (viewMonth === 11) {
			viewMonth = 0;
			viewYear += 1;
		} else {
			viewMonth += 1;
		}
	}

	function onMonthSelectChange(event: Event) {
		const t = event.currentTarget;
		if (t instanceof HTMLSelectElement) {
			viewMonth = parseInt(t.value, 10);
		}
	}

	function onYearSelectChange(event: Event) {
		const t = event.currentTarget;
		if (t instanceof HTMLSelectElement) {
			viewYear = parseInt(t.value, 10);
		}
	}

	function onGridKeydown(event: KeyboardEvent) {
		const key = event.key;
		if (key === 'ArrowLeft') {
			event.preventDefault();
			moveSelection(-1);
			return;
		}
		if (key === 'ArrowRight') {
			event.preventDefault();
			moveSelection(1);
			return;
		}
		if (key === 'ArrowUp') {
			event.preventDefault();
			moveSelection(-7);
			return;
		}
		if (key === 'ArrowDown') {
			event.preventDefault();
			moveSelection(7);
			return;
		}
		if (key === 'Home') {
			event.preventDefault();
			const first = dayCells[0];
			if (first) {
				selectDay(first.y, first.m, first.day);
				void tick().then(() => focusDayButton(first.y, first.m, first.day));
			}
			return;
		}
		if (key === 'End') {
			event.preventDefault();
			const last = dayCells[dayCells.length - 1];
			if (last) {
				selectDay(last.y, last.m, last.day);
				void tick().then(() => focusDayButton(last.y, last.m, last.day));
			}
			return;
		}
		if (key === 'Enter' || key === ' ') {
			// Day button already selected via focus/arrows; Enter/Space apply immediately
			// only when the focused control is a day cell (default button activation selects).
			const t = event.target;
			if (t instanceof HTMLButtonElement && t.getAttribute('role') === 'gridcell') {
				event.preventDefault();
				apply();
			}
		}
	}

	function onPanelKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			close();
			return;
		}
		if (event.key === 'Enter') {
			const t = event.target;
			if (t instanceof HTMLTextAreaElement) return;
			if (t instanceof HTMLButtonElement) return;
			if (t instanceof HTMLSelectElement) return;
			event.preventDefault();
			event.stopPropagation();
			apply();
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
		requestAnimationFrame(() => {
			if (!open) return;
			const active = document.activeElement;
			if (active instanceof Node) {
				if (panelEl?.contains(active)) return;
				if (anchorEl?.contains(active)) return;
			}
			close();
		});
	}

	/**
	 * Capture Escape on window so the host page modal does not steal it.
	 * stopImmediatePropagation: same-node listeners registered earlier (host) must not run.
	 * Host also short-circuits when a date/time portal is mounted.
	 */
	function onWindowKeydownCapture(event: KeyboardEvent) {
		if (!open) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
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
		const panelH = panelRect.height || 320;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let top: number;
		let left: number;

		if (anchorEl) {
			const a = anchorEl.getBoundingClientRect();
			top = a.bottom + PANEL_GAP_PX;
			left = a.left;
			if (a.width > 0 && a.width < panelW) {
				left = a.right - panelW;
			}
			if (top + panelH + VIEWPORT_PAD_PX > vh && a.top - PANEL_GAP_PX - panelH >= VIEWPORT_PAD_PX) {
				top = a.top - PANEL_GAP_PX - panelH;
			}
		} else {
			top = Math.max(VIEWPORT_PAD_PX, Math.round(vh * 0.15));
			left = Math.round((vw - panelW) / 2);
		}

		left = Math.min(Math.max(VIEWPORT_PAD_PX, left), Math.max(VIEWPORT_PAD_PX, vw - panelW - VIEWPORT_PAD_PX));
		top = Math.min(Math.max(VIEWPORT_PAD_PX, top), Math.max(VIEWPORT_PAD_PX, vh - panelH - VIEWPORT_PAD_PX));

		panelStyle = `top: ${Math.round(top)}px; left: ${Math.round(left)}px; visibility: visible;`;
	}

	/** Move the dialog tree onto document.body (escape overflow/stacking). */
	function portal(node: HTMLElement) {
		if (typeof document === 'undefined') return {};
		const host = document.createElement('div');
		host.className = 'date-picker-portal-root';
		host.setAttribute('data-date-picker-portal', idPrefix);
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
		viewYear = parsed.y;
		viewMonth = parsed.m;
		selectedYear = parsed.y;
		selectedMonth = parsed.m;
		selectedDay = parsed.d;
		previouslyFocused =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;

		panelStyle = 'top: 0; left: 0; visibility: hidden;';

		window.addEventListener('keydown', onWindowKeydownCapture, true);
		document.addEventListener('pointerdown', onDocumentPointerDown, true);
		window.addEventListener('resize', positionPanel);
		window.addEventListener('scroll', positionPanel, true);

		void tick().then(() => {
			positionPanel();
			requestAnimationFrame(() => {
				positionPanel();
				monthSelectEl?.focus();
			});
		});

		return () => {
			window.removeEventListener('keydown', onWindowKeydownCapture, true);
			document.removeEventListener('pointerdown', onDocumentPointerDown, true);
			window.removeEventListener('resize', positionPanel);
			window.removeEventListener('scroll', positionPanel, true);
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
			class="date-picker-panel fixed z-[200] w-[min(18rem,calc(100vw-1rem))] rounded-lg border border-warm-200 bg-white p-4 shadow-2xl dark:border-warm-300 dark:bg-warm-100"
			style={panelStyle}
			role="dialog"
			aria-modal="false"
			aria-labelledby={titleId}
			data-date-picker-panel
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

			<div class="mb-3 flex items-center gap-2">
				<button
					type="button"
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-warm-200 bg-white text-warm-700 hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-200 dark:hover:bg-warm-300"
					aria-label="Previous month"
					onclick={prevMonth}
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
					</svg>
				</button>
				<div class="min-w-0 flex-1">
					<label class="sr-only" for={monthId}>Month</label>
					<select
						id={monthId}
						bind:this={monthSelectEl}
						value={String(viewMonth)}
						onchange={onMonthSelectChange}
						class="input-focus w-full rounded-md border border-warm-200 bg-white px-1.5 py-1.5 text-xs text-warm-800 dark:bg-warm-200 dark:text-warm-900"
					>
						{#each MONTHS as name, i (name)}
							<option value={String(i)}>{name}</option>
						{/each}
					</select>
				</div>
				<div class="w-[4.5rem] shrink-0">
					<label class="sr-only" for={yearId}>Year</label>
					<select
						id={yearId}
						value={String(viewYear)}
						onchange={onYearSelectChange}
						class="input-focus w-full rounded-md border border-warm-200 bg-white px-1.5 py-1.5 text-xs text-warm-800 dark:bg-warm-200 dark:text-warm-900"
					>
						{#each yearOptions as y (y)}
							<option value={String(y)}>{y}</option>
						{/each}
					</select>
				</div>
				<button
					type="button"
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-warm-200 bg-white text-warm-700 hover:bg-warm-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-warm-200 dark:hover:bg-warm-300"
					aria-label="Next month"
					onclick={nextMonth}
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
					</svg>
				</button>
			</div>

			<div class="mb-1 grid grid-cols-7 gap-0.5 text-center" aria-hidden="true">
				{#each WEEKDAYS as wd (wd)}
					<span class="py-1 text-[0.65rem] font-medium uppercase tracking-wide text-warm-500"
						>{wd}</span
					>
				{/each}
			</div>

			<!-- svelte-ignore a11y_interactive_supports_focus: focus stays on day cells (roving tabindex); grid handles arrow keys via bubbling -->
			<div
				class="flex flex-col gap-0.5"
				role="grid"
				aria-label="Calendar days"
				tabindex="-1"
				onkeydown={onGridKeydown}
			>
				{#each calendarWeeks as week, wi (wi)}
					<div class="grid grid-cols-7 gap-0.5" role="row">
						{#each week as cell, ci (`${wi}-${ci}`)}
							{#if cell}
								<button
									type="button"
									id={dayButtonId(cell.y, cell.m, cell.day)}
									role="gridcell"
									tabindex={dayTabIndex(cell.y, cell.m, cell.day)}
									aria-selected={isSelected(cell.y, cell.m, cell.day)}
									aria-label={formatYmd(cell.y, cell.m, cell.day)}
									class="flex h-8 w-full items-center justify-center rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500
										{isSelected(cell.y, cell.m, cell.day)
										? 'bg-accent-600 font-medium text-white hover:bg-accent-500'
										: isToday(cell.y, cell.m, cell.day)
											? 'bg-warm-100 font-medium text-warm-800 hover:bg-warm-200 dark:bg-warm-300 dark:text-warm-900'
											: 'text-warm-700 hover:bg-warm-50 dark:text-warm-800 dark:hover:bg-warm-300'}"
									onclick={() => selectDay(cell.y, cell.m, cell.day)}
								>
									{cell.day}
								</button>
							{:else}
								<span class="h-8" role="gridcell" aria-hidden="true"></span>
							{/if}
						{/each}
					</div>
				{/each}
			</div>

			<p class="mt-2 text-center text-xs text-warm-500" aria-live="polite">
				{formatYmd(selectedYear, selectedMonth, selectedDay)}
			</p>

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
	</div>
{/if}
