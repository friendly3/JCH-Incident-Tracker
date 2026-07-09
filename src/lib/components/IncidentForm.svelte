<script lang="ts">
	import type { Incident, IncidentType, IncidentAction } from '$lib/data/incidents';
	import type { Driver, TeamLeader } from '$lib/data/team';
	import { formatDate, formatDateTimeFields, formatTimeField, normalizeTimeField } from '$lib/formatDate';

	interface Props {
		incident?: Incident;
		incidentTypes: IncidentType[];
		incidentActions: IncidentAction[];
		drivers: Driver[];
		teamLeaders: TeamLeader[];
		onSubmit: (incident: Incident) => void;
		onCancel: (hasUnsavedChanges: boolean) => void;
		onUnsavedChangesChange?: (hasChanges: boolean) => void;
		/** When false, parent shell renders the form title (modal/fullscreen header). */
		showTitle?: boolean;
		/** `shell` = gray inset surface (modal/fullscreen); `inline` = flat background for legacy wrappers. */
		variant?: 'shell' | 'inline';
	}

	let {
		incident,
		incidentTypes,
		incidentActions,
		drivers,
		teamLeaders,
		onSubmit,
		onCancel,
		onUnsavedChangesChange,
		showTitle = true,
		variant = 'shell'
	}: Props = $props();

	const isEdit = $derived(!!incident);
	let showConfirm = $state(false);
	let submitError = $state<string | null>(null);
	type SubmitErrorField = 'dateReceived' | 'type';
	let submitErrorField = $state<SubmitErrorField | null>(null);
	const FK_EMPTY = '';

	function normalizeFkId(value: string | null | undefined): string | null {
		if (value == null || value === '' || value === 'null' || value === 'undefined') return null;
		return value;
	}

	function setFkField(field: 'typeId' | 'driverId' | 'teamLeaderId' | 'actionId', raw: string) {
		form[field] = raw === FK_EMPTY ? null : raw;
	}

	function fkInList(id: string | null, items: { id: string }[]): boolean {
		return id != null && items.some((item) => item.id === id);
	}

	function normalizeDateOnly(date: string): string {
		if (!date?.trim()) return '';
		const match = /^(\d{4}-\d{2}-\d{2})/.exec(date.trim());
		return match ? match[1] : date.trim();
	}

	function normalizeIncident(source: Incident): Incident {
		return {
			...source,
			source: source.source === 'import' ? 'import' : 'ui',
			dateReceived: normalizeDateOnly(source.dateReceived),
			dateResponse: normalizeDateOnly(source.dateResponse),
			time: normalizeTimeField(source.time),
			timeResponse: normalizeTimeField(source.timeResponse),
			emailSender: source.emailSender?.trim() ?? '',
			emailSubject: source.emailSubject?.trim() ?? '',
			sender: source.sender?.trim() ?? '',
			marked: source.marked?.trim() ?? '',
			response: source.response?.trim() ?? '',
			referenceNo: source.referenceNo?.trim() ?? '',
			referenceText: source.referenceText?.trim() ?? '',
			typeId: normalizeFkId(source.typeId),
			driverId: normalizeFkId(source.driverId),
			teamLeaderId: normalizeFkId(source.teamLeaderId),
			actionId: normalizeFkId(source.actionId)
		};
	}

	function emptyIncident(): Incident {
		return {
			id: crypto.randomUUID(),
			source: 'ui',
			emailSender: '',
			emailSubject: '',
			dateReceived: '',
			time: '',
			sender: '',
			teamLeaderId: null,
			typeId: null,
			marked: '',
			referenceNo: '',
			referenceText: '',
			driverId: null,
			response: '',
			dateResponse: '',
			timeResponse: '',
			actionId: null
		};
	}

	type FormSnapshot = {
		source: 'ui' | 'import';
		dateReceived: string;
		time: string;
		sender: string;
		teamLeaderId: string | null;
		typeId: string | null;
		marked: string;
		referenceNo: string;
		referenceText: string;
		driverId: string | null;
		response: string;
		dateResponse: string;
		timeResponse: string;
		actionId: string | null;
		emailSender: string;
		emailSubject: string;
	};

	function toSnapshot(value: Incident): FormSnapshot {
		return {
			source: value.source === 'import' ? 'import' : 'ui',
			dateReceived: normalizeDateOnly(value.dateReceived),
			time: normalizeTimeField(value.time),
			sender: value.sender?.trim() ?? '',
			teamLeaderId: value.teamLeaderId,
			typeId: value.typeId,
			marked: value.marked?.trim() ?? '',
			referenceNo: value.referenceNo?.trim() ?? '',
			referenceText: value.referenceText?.trim() ?? '',
			driverId: value.driverId,
			response: value.response?.trim() ?? '',
			dateResponse: normalizeDateOnly(value.dateResponse),
			timeResponse: normalizeTimeField(value.timeResponse),
			actionId: value.actionId,
			emailSender: value.emailSender?.trim() ?? '',
			emailSubject: value.emailSubject?.trim() ?? ''
		};
	}

	let form = $state<Incident>({
		id: '',
		source: 'ui',
		emailSender: '',
		emailSubject: '',
		dateReceived: '',
		time: '',
		sender: '',
		teamLeaderId: null,
		typeId: null,
		marked: '',
		referenceNo: '',
		referenceText: '',
		driverId: null,
		response: '',
		dateResponse: '',
		timeResponse: '',
		actionId: null
	});

	let baselineSnapshot = $state('');

	function computeHasUnsavedChanges(): boolean {
		const current = JSON.stringify(toSnapshot(form));
		return current !== baselineSnapshot;
	}

	const hasUnsavedChanges = $derived(computeHasUnsavedChanges());

	/** Synchronous dirty check for parent dismiss handlers (backdrop/Escape). */
	export function getHasUnsavedChanges(): boolean {
		return computeHasUnsavedChanges();
	}

	/** Report dirty state to parent for close/discard flow. */
	export function requestClose(): void {
		onCancel(computeHasUnsavedChanges());
	}

	// UI indicator only — dismiss decisions use requestClose()/onCancel(liveFlag)
	$effect(() => {
		onUnsavedChangesChange?.(hasUnsavedChanges);
	});

	// Reset form when incident prop changes (only track `incident`, not form edits)
	$effect(() => {
		showConfirm = false;
		submitError = null;
		submitErrorField = null;
		const source = incident;
		const initial = source ? normalizeIncident(source) : emptyIncident();
		form = initial;
		baselineSnapshot = JSON.stringify(toSnapshot(initial));
	});

	function handleSubmit() {
		submitError = null;
		submitErrorField = null;

		const typeId = normalizeFkId(form.typeId);
		if (!form.dateReceived?.trim()) {
			submitError = 'Date Received is required.';
			submitErrorField = 'dateReceived';
			return;
		}
		if (!typeId) {
			submitError = 'Type is required — please select an incident type.';
			submitErrorField = 'type';
			return;
		}

		const payload: Incident = {
			...form,
			source: form.source === 'import' ? 'import' : 'ui',
			typeId,
			driverId: normalizeFkId(form.driverId),
			teamLeaderId: normalizeFkId(form.teamLeaderId),
			actionId: normalizeFkId(form.actionId),
			time: normalizeTimeField(form.time),
			timeResponse: normalizeTimeField(form.timeResponse)
		};

		if (isEdit && !showConfirm) {
			showConfirm = true;
			return;
		}
		onSubmit(payload);
		showConfirm = false;
	}

	function handleCancel() {
		requestClose();
	}

	const inputClass =
		'w-full rounded-md border border-warm-200 bg-white px-3 py-2 text-sm text-warm-700 input-focus dark:bg-warm-200';
	const dateTimeFieldClass =
		'input-focus-within form-field-surface relative w-full rounded-md border border-warm-200 bg-white dark:bg-warm-200';
	const dateTimeDisplayClass =
		'pointer-events-none flex min-h-[2.375rem] items-center px-3 py-2 pr-10 text-sm';
	const dateTimeIconClass =
		'pointer-events-none absolute right-3 top-1/2 z-0 -translate-y-1/2 text-warm-500 dark:text-warm-400';
	// z-10 so the invisible native control sits above the display/icon and receives clicks.
	// opacity-0 alone is not enough for type=time in Chromium — openNativePicker() calls showPicker().
	const dateTimeOverlayClass =
		'absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-default';
	const dateTimeControlClass = 'flex flex-col gap-2 sm:flex-row sm:items-stretch';
	const timeFieldClass = `${dateTimeFieldClass} w-full sm:w-[8.5rem] sm:shrink-0`;
	const emptyDateTimeDisplay = '—';

	/**
	 * Open the browser's native date/time picker for our custom overlay fields.
	 * Chromium only opens type=time when the tiny clock glyph is hit; a full-field
	 * transparent overlay therefore needs an explicit showPicker() on user click.
	 */
	function openNativePicker(event: MouseEvent) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement) || input.disabled) return;
		try {
			if (typeof input.showPicker === 'function') {
				input.showPicker();
			}
		} catch {
			// NotAllowedError / unsupported — focus still allows typing a value.
		}
	}

	const receivedAtDesc = $derived(
		formatDateTimeFields(form.dateReceived, form.time) || 'Date and time not set'
	);
	const respondedAtDesc = $derived(
		formatDateTimeFields(form.dateResponse, form.timeResponse) || 'Date and time not set'
	);
	const emailFieldsEditable = $derived((form.source ?? 'ui') === 'ui');
	const readonlyEmailClass = `${inputClass} bg-warm-100 text-warm-400 cursor-default select-all dark:bg-warm-300`;
	const footerBtnFocus =
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';

	const receivedAtDescribedBy = $derived(
		submitErrorField === 'dateReceived'
			? 'receivedAt-desc incident-submit-error'
			: 'receivedAt-desc'
	);
</script>

{#snippet dateTimeCalendarIcon()}
	<span class={dateTimeIconClass} aria-hidden="true">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-4 w-4"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
			/>
		</svg>
	</span>
{/snippet}

{#snippet dateTimeClockIcon()}
	<span class={dateTimeIconClass} aria-hidden="true">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-4 w-4"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			stroke-width="2"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		</svg>
	</span>
{/snippet}

<form
	novalidate
	onsubmit={(e) => {
		e.preventDefault();
		handleSubmit();
	}}
	class="flex min-h-0 flex-1 flex-col"
>
	<div
		class="{variant === 'shell'
			? 'sn-form-surface'
			: 'bg-transparent'} flex-1 overflow-y-auto"
	>
		<div class="mx-auto w-full max-w-3xl px-6 py-6">
			{#if showTitle}
				<h2 id="incident-form-title" class="mb-6 text-xl font-semibold text-warm-800">
					{isEdit ? 'Edit Incident' : 'New Incident'}
				</h2>
			{/if}

			<section class="mb-8" aria-labelledby="section-details-heading">
				<h3 id="section-details-heading" class="sn-section-title">Details</h3>
				<div class="sn-field-row">
					<label for="referenceNo" class="sn-field-label">Reference No.</label>
					<div class="sn-field-control">
						<input
							id="referenceNo"
							type="text"
							bind:value={form.referenceNo}
							class="{inputClass} text-accent-600"
						/>
					</div>
				</div>
				<div class="sn-field-row">
					<label for="emailSender" class="sn-field-label">Email Sender</label>
					<div class="sn-field-control">
						<input
							id="emailSender"
							type="text"
							bind:value={form.emailSender}
							readonly={!emailFieldsEditable}
							class={emailFieldsEditable ? inputClass : readonlyEmailClass}
						/>
					</div>
				</div>
				<div class="sn-field-row">
					<label for="emailSubject" class="sn-field-label">Email Subject</label>
					<div class="sn-field-control">
						<input
							id="emailSubject"
							type="text"
							bind:value={form.emailSubject}
							readonly={!emailFieldsEditable}
							class={emailFieldsEditable ? inputClass : readonlyEmailClass}
						/>
					</div>
				</div>
				<div class="sn-field-row">
					<label for="referenceText" class="sn-field-label">Reference Text</label>
					<div class="sn-field-control">
						<input id="referenceText" type="text" bind:value={form.referenceText} class={inputClass} />
					</div>
				</div>
				<div class="sn-field-row">
					<span id="receivedAt-label" class="sn-field-label">
						Date Received <span class="text-red-600">*</span>
					</span>
					<div class="sn-field-control">
						<span id="receivedAt-desc" class="sr-only">{receivedAtDesc}</span>
						<div class={dateTimeControlClass} role="group" aria-labelledby="receivedAt-label">
							<div class="{dateTimeFieldClass} min-w-0 flex-1">
								<div
									class="{dateTimeDisplayClass} {form.dateReceived ? 'text-warm-700' : 'text-warm-400'}"
									aria-hidden="true"
								>
									{formatDate(form.dateReceived) || emptyDateTimeDisplay}
								</div>
								{@render dateTimeCalendarIcon()}
								<input
									id="receivedAt"
									type="date"
									bind:value={form.dateReceived}
									aria-labelledby="receivedAt-label receivedAt-date-hint"
									aria-describedby={receivedAtDescribedBy}
									aria-required="true"
									aria-invalid={submitErrorField === 'dateReceived' ? 'true' : undefined}
									class={dateTimeOverlayClass}
									onclick={openNativePicker}
								/>
							</div>
							<span id="receivedAt-date-hint" class="sr-only">Date</span>
							<div class={timeFieldClass}>
								<div
									class="{dateTimeDisplayClass} {form.time ? 'text-warm-700' : 'text-warm-400'}"
									aria-hidden="true"
								>
									{formatTimeField(form.time) || emptyDateTimeDisplay}
								</div>
								{@render dateTimeClockIcon()}
								<input
									id="receivedAt-time"
									type="time"
									bind:value={form.time}
									aria-labelledby="receivedAt-label receivedAt-time-hint"
									aria-describedby="receivedAt-desc"
									class={dateTimeOverlayClass}
									onclick={openNativePicker}
								/>
							</div>
							<span id="receivedAt-time-hint" class="sr-only">Time</span>
						</div>
					</div>
				</div>
			</section>

			<section class="mb-8" aria-labelledby="section-classification-heading">
				<h3 id="section-classification-heading" class="sn-section-title">Classification</h3>
				<div class="sn-field-row">
					<label for="action" class="sn-field-label">Action</label>
					<div class="sn-field-control">
						<select
							id="action"
							value={form.actionId ?? FK_EMPTY}
							onchange={(e) => setFkField('actionId', e.currentTarget.value)}
							class="{inputClass} uppercase"
						>
							<option value={FK_EMPTY}>— None —</option>
							{#if form.actionId && !fkInList(form.actionId, incidentActions)}
								<option value={form.actionId}>{incident?.action ?? 'Current action'}</option>
							{/if}
							{#each incidentActions as a}<option value={a.id} class="uppercase">{a.name}</option>{/each}
						</select>
					</div>
				</div>
				<div class="sn-field-row">
					<label for="type" class="sn-field-label">Type <span class="text-red-600">*</span></label>
					<div class="sn-field-control">
						<select
							id="type"
							value={form.typeId ?? FK_EMPTY}
							onchange={(e) => setFkField('typeId', e.currentTarget.value)}
							aria-required="true"
							aria-invalid={submitErrorField === 'type' ? 'true' : undefined}
							aria-describedby={submitErrorField === 'type' ? 'incident-submit-error' : undefined}
							class="{inputClass} uppercase"
						>
							<option value={FK_EMPTY}>— Select type —</option>
							{#if form.typeId && !fkInList(form.typeId, incidentTypes)}
								<option value={form.typeId}>{incident?.type ?? 'Current type'}</option>
							{/if}
							{#each incidentTypes as t}<option value={t.id} class="uppercase">{t.name}</option>{/each}
						</select>
					</div>
				</div>
				<div class="sn-field-row">
					<label for="marked" class="sn-field-label">Marked</label>
					<div class="sn-field-control">
						<select id="marked" bind:value={form.marked} class="{inputClass} uppercase">
							<option value="" class="uppercase">None</option>
							<option value="High" class="uppercase">High</option>
						</select>
					</div>
				</div>
			</section>

			<section class="mb-8" aria-labelledby="section-assignment-heading">
				<h3 id="section-assignment-heading" class="sn-section-title">Assignment</h3>
				<div class="sn-field-row">
					<label for="sender" class="sn-field-label">Sender</label>
					<div class="sn-field-control">
						<input id="sender" type="text" bind:value={form.sender} class={inputClass} />
					</div>
				</div>
				<div class="sn-field-row">
					<label for="teamLeader" class="sn-field-label">Team Leader</label>
					<div class="sn-field-control">
						<select
							id="teamLeader"
							value={form.teamLeaderId ?? FK_EMPTY}
							onchange={(e) => setFkField('teamLeaderId', e.currentTarget.value)}
							class={inputClass}
						>
							<option value={FK_EMPTY}>— None —</option>
							{#if form.teamLeaderId && !fkInList(form.teamLeaderId, teamLeaders)}
								<option value={form.teamLeaderId}>{incident?.teamLeader ?? 'Current team leader'}</option>
							{/if}
							{#each teamLeaders as tl}<option value={tl.id}>{tl.name}</option>{/each}
						</select>
					</div>
				</div>
				<div class="sn-field-row">
					<label for="driver" class="sn-field-label">Driver</label>
					<div class="sn-field-control">
						<select
							id="driver"
							value={form.driverId ?? FK_EMPTY}
							onchange={(e) => setFkField('driverId', e.currentTarget.value)}
							class={inputClass}
						>
							<option value={FK_EMPTY}>— None —</option>
							{#if form.driverId && !fkInList(form.driverId, drivers)}
								<option value={form.driverId}>{incident?.driver ?? 'Current driver'}</option>
							{/if}
							{#each drivers as d}<option value={d.id}>{d.username}</option>{/each}
						</select>
					</div>
				</div>
			</section>

			<section class="mb-2" aria-labelledby="section-response-heading">
				<h3 id="section-response-heading" class="sn-section-title">Response</h3>
				<div class="sn-field-row">
					<label for="response" class="sn-field-label">Response By</label>
					<div class="sn-field-control">
						<input id="response" type="text" bind:value={form.response} class={inputClass} />
					</div>
				</div>
				<div class="sn-field-row">
					<span id="respondedAt-label" class="sn-field-label">Responded</span>
					<div class="sn-field-control">
						<span id="respondedAt-desc" class="sr-only">{respondedAtDesc}</span>
						<div class={dateTimeControlClass} role="group" aria-labelledby="respondedAt-label">
							<div class="{dateTimeFieldClass} min-w-0 flex-1">
								<div
									class="{dateTimeDisplayClass} {form.dateResponse ? 'text-warm-700' : 'text-warm-400'}"
									aria-hidden="true"
								>
									{formatDate(form.dateResponse) || emptyDateTimeDisplay}
								</div>
								{@render dateTimeCalendarIcon()}
								<input
									id="respondedAt"
									type="date"
									bind:value={form.dateResponse}
									aria-labelledby="respondedAt-label respondedAt-date-hint"
									aria-describedby="respondedAt-desc"
									class={dateTimeOverlayClass}
									onclick={openNativePicker}
								/>
							</div>
							<span id="respondedAt-date-hint" class="sr-only">Date</span>
							<div class={timeFieldClass}>
								<div
									class="{dateTimeDisplayClass} {form.timeResponse ? 'text-warm-700' : 'text-warm-400'}"
									aria-hidden="true"
								>
									{formatTimeField(form.timeResponse) || emptyDateTimeDisplay}
								</div>
								{@render dateTimeClockIcon()}
								<input
									id="respondedAt-time"
									type="time"
									bind:value={form.timeResponse}
									aria-labelledby="respondedAt-label respondedAt-time-hint"
									aria-describedby="respondedAt-desc"
									class={dateTimeOverlayClass}
									onclick={openNativePicker}
								/>
							</div>
							<span id="respondedAt-time-hint" class="sr-only">Time</span>
						</div>
					</div>
				</div>
			</section>
		</div>
	</div>

	<footer class="sn-form-footer shrink-0 bg-white px-6 py-4 dark:bg-warm-100">
		<div class="mx-auto w-full max-w-3xl space-y-3">
			{#if submitError}
				<p
					id="incident-submit-error"
					class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
					role="alert"
				>
					{submitError}
				</p>
			{/if}

			{#if isEdit && showConfirm}
				<p class="rounded-md border border-amber-200 bg-amber-100 px-4 py-3 text-sm text-amber-700">
					Review your changes, then click <strong>Confirm Update</strong> to save.
				</p>
			{/if}

			<div class="flex flex-wrap items-center gap-3">
				{#if isEdit && showConfirm}
					<button
						type="button"
						onclick={handleSubmit}
						class="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
					>
						Confirm Update
					</button>
					<button
						type="button"
						onclick={() => {
							showConfirm = false;
							submitError = null;
							submitErrorField = null;
						}}
						class="rounded-md border border-warm-200 px-5 py-2 text-sm text-warm-600 hover:bg-warm-50 {footerBtnFocus}"
					>
						Cancel
					</button>
				{:else}
					<button
						type="submit"
						class="rounded-md bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500 {footerBtnFocus}"
					>
						{isEdit ? 'Update' : 'Add'} Incident
					</button>
					<button
						type="button"
						onclick={handleCancel}
						class="rounded-md border border-warm-300 bg-white px-5 py-2 text-sm text-warm-700 hover:bg-warm-50 dark:bg-warm-200 {footerBtnFocus}"
					>
						Cancel
					</button>
				{/if}
			</div>
		</div>
	</footer>
</form>
