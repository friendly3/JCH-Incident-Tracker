<script lang="ts">
	import type { Incident, IncidentType, IncidentAction } from '$lib/data/incidents';
	import type { Driver, TeamLeader } from '$lib/data/team';
	import { formatDateTimeLocal } from '$lib/formatDate';

	interface Props {
		incident?: Incident;
		incidentTypes: IncidentType[];
		incidentActions: IncidentAction[];
		drivers: Driver[];
		teamLeaders: TeamLeader[];
		onSubmit: (incident: Incident) => void;
		onCancel: (hasUnsavedChanges: boolean) => void;
		onUnsavedChangesChange?: (hasChanges: boolean) => void;
	}

	let { incident, incidentTypes, incidentActions, drivers, teamLeaders, onSubmit, onCancel, onUnsavedChangesChange }: Props = $props();

	const isEdit = $derived(!!incident);
	let showConfirm = $state(false);
	let submitError = $state<string | null>(null);
	let receivedAt = $state('');
	let respondedAt = $state('');

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

	function normalizeOptionalTime(time: string): string {
		const trimmed = time?.trim().slice(0, 5) ?? '';
		return trimmed === '00:00' ? '' : trimmed;
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
			time: normalizeOptionalTime(source.time),
			timeResponse: normalizeOptionalTime(source.timeResponse),
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
			time: normalizeOptionalTime(value.time),
			sender: value.sender?.trim() ?? '',
			teamLeaderId: value.teamLeaderId,
			typeId: value.typeId,
			marked: value.marked?.trim() ?? '',
			referenceNo: value.referenceNo?.trim() ?? '',
			referenceText: value.referenceText?.trim() ?? '',
			driverId: value.driverId,
			response: value.response?.trim() ?? '',
			dateResponse: normalizeDateOnly(value.dateResponse),
			timeResponse: normalizeOptionalTime(value.timeResponse),
			actionId: value.actionId,
			emailSender: value.emailSender?.trim() ?? '',
			emailSubject: value.emailSubject?.trim() ?? ''
		};
	}

	function combineDateTime(date: string, time: string): string {
		if (!date?.trim()) return '';
		const normalizedTime = time?.trim() ? time.trim().slice(0, 5) : '00:00';
		return `${date}T${normalizedTime}`;
	}

	function splitDateTime(value: string): { date: string; time: string } {
		if (!value) return { date: '', time: '' };
		const [date, timePart] = value.split('T');
		return { date: date ?? '', time: normalizeOptionalTime(timePart ?? '') };
	}

	function syncReceivedAt() {
		const { date, time } = splitDateTime(receivedAt);
		form.dateReceived = date;
		form.time = time;
	}

	function syncRespondedAt() {
		const { date, time } = splitDateTime(respondedAt);
		form.dateResponse = date;
		form.timeResponse = time;
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
		const received = splitDateTime(receivedAt);
		const responded = splitDateTime(respondedAt);
		const snapshot = toSnapshot(form);
		const current = JSON.stringify({
			...snapshot,
			dateReceived: normalizeDateOnly(received.date),
			time: normalizeOptionalTime(received.time),
			dateResponse: normalizeDateOnly(responded.date),
			timeResponse: normalizeOptionalTime(responded.time)
		});
		return current !== baselineSnapshot;
	}

	const hasUnsavedChanges = $derived(computeHasUnsavedChanges());

	/** Synchronous dirty check for parent dismiss handlers (backdrop/Escape). */
	export function getHasUnsavedChanges(): boolean {
		return computeHasUnsavedChanges();
	}

	/** Sync datetimes, then report dirty state to parent for close/discard flow. */
	export function requestClose(): void {
		const dirty = computeHasUnsavedChanges();
		syncReceivedAt();
		syncRespondedAt();
		onCancel(dirty);
	}

	// UI indicator only — dismiss decisions use requestClose()/onCancel(liveFlag)
	$effect(() => {
		onUnsavedChangesChange?.(hasUnsavedChanges);
	});

	// Reset form when incident prop changes (only track `incident`, not form edits)
	$effect(() => {
		showConfirm = false;
		submitError = null;
		const source = incident;
		const initial = source ? normalizeIncident(source) : emptyIncident();
		form = initial;
		receivedAt = combineDateTime(initial.dateReceived, initial.time);
		respondedAt = combineDateTime(initial.dateResponse, initial.timeResponse);
		baselineSnapshot = JSON.stringify(toSnapshot(initial));
	});

	function handleSubmit() {
		syncReceivedAt();
		syncRespondedAt();
		submitError = null;

		const typeId = normalizeFkId(form.typeId);
		if (!form.dateReceived?.trim()) {
			submitError = 'Date Received is required.';
			return;
		}
		if (!typeId) {
			submitError = 'Type is required — please select an incident type.';
			return;
		}

		const payload: Incident = {
			...form,
			source: form.source === 'import' ? 'import' : 'ui',
			typeId,
			driverId: normalizeFkId(form.driverId),
			teamLeaderId: normalizeFkId(form.teamLeaderId),
			actionId: normalizeFkId(form.actionId),
			time: form.time.trim(),
			timeResponse: form.timeResponse.trim()
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

	const inputClass = 'w-full rounded-lg border border-warm-200 bg-warm-50 px-3 py-2 text-sm text-warm-700 input-focus';
	const labelClass = 'mb-1 block text-sm text-warm-500';
	const dateTimeFieldClass =
		'input-focus-within form-field-surface relative w-full rounded-lg border border-warm-200 bg-warm-50';
	const dateTimeDisplayClass =
		'pointer-events-none flex min-h-[2.375rem] items-center px-3 py-2 text-sm';
	const dateTimeOverlayClass = 'absolute inset-0 h-full w-full cursor-pointer opacity-0';

	const receivedAtDesc = $derived(formatDateTimeLocal(receivedAt) || 'Select date and time');
	const respondedAtDesc = $derived(formatDateTimeLocal(respondedAt) || 'Select date and time');
	const emailFieldsEditable = $derived((form.source ?? 'ui') === 'ui');
	const readonlyEmailClass = `${inputClass} bg-warm-100 text-warm-400 cursor-default select-all`;
</script>

<form novalidate onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
	<h2 id="incident-form-title" class="text-xl font-semibold text-warm-800">Incident Details</h2>

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
		<div>
			<label for="referenceNo" class={labelClass}>Reference No.</label>
			<input
				id="referenceNo"
				type="text"
				bind:value={form.referenceNo}
				class="{inputClass} text-accent-600"
			/>
		</div>
		<div>
			<label for="emailSender" class={labelClass}>Email Sender</label>
			<input
				id="emailSender"
				type="text"
				bind:value={form.emailSender}
				readonly={!emailFieldsEditable}
				class={emailFieldsEditable ? inputClass : readonlyEmailClass}
			/>
		</div>
		<div class="sm:col-span-2">
			<label for="emailSubject" class={labelClass}>Email Subject</label>
			<input
				id="emailSubject"
				type="text"
				bind:value={form.emailSubject}
				readonly={!emailFieldsEditable}
				class={emailFieldsEditable ? inputClass : readonlyEmailClass}
			/>
		</div>
		<div>
			<label for="action" class={labelClass}>Action</label>
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
		<div>
			<label for="type" class={labelClass}>Type *</label>
			<select
				id="type"
				value={form.typeId ?? FK_EMPTY}
				onchange={(e) => setFkField('typeId', e.currentTarget.value)}
				class="{inputClass} uppercase"
			>
				<option value={FK_EMPTY}>— Select type —</option>
				{#if form.typeId && !fkInList(form.typeId, incidentTypes)}
					<option value={form.typeId}>{incident?.type ?? 'Current type'}</option>
				{/if}
				{#each incidentTypes as t}<option value={t.id} class="uppercase">{t.name}</option>{/each}
			</select>
		</div>
		<div>
			<label for="marked" class={labelClass}>Marked</label>
			<select id="marked" bind:value={form.marked} class="{inputClass} uppercase">
				<option value="" class="uppercase">None</option>
				<option value="High" class="uppercase">High</option>
			</select>
		</div>
		<div class="col-span-full border-t border-warm-200/60"></div>
		<div>
			<label id="receivedAt-label" for="receivedAt" class={labelClass}>Date Received *</label>
			<span id="receivedAt-desc" class="sr-only">{receivedAtDesc}</span>
			<div class={dateTimeFieldClass}>
				<div
					class="{dateTimeDisplayClass} {receivedAt ? 'text-warm-700' : 'text-warm-400'}"
					aria-hidden="true"
				>
					{formatDateTimeLocal(receivedAt) || 'Select date & time'}
				</div>
				<input
					id="receivedAt"
					type="datetime-local"
					bind:value={receivedAt}
					oninput={syncReceivedAt}
					onchange={syncReceivedAt}
					aria-labelledby="receivedAt-label receivedAt-desc"
					class={dateTimeOverlayClass}
				/>
			</div>
		</div>
		<div>
			<label for="sender" class={labelClass}>Sender</label>
			<input id="sender" type="text" bind:value={form.sender} class={inputClass} />
		</div>
		<div>
			<label for="teamLeader" class={labelClass}>Team Leader</label>
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
		<div class="sm:col-span-2">
			<label for="referenceText" class={labelClass}>Reference Text</label>
			<input id="referenceText" type="text" bind:value={form.referenceText} class={inputClass} />
		</div>
		<div>
			<label for="driver" class={labelClass}>Driver</label>
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
		<div>
			<label for="response" class={labelClass}>Response By</label>
			<input id="response" type="text" bind:value={form.response} class={inputClass} />
		</div>
		<div>
			<label id="respondedAt-label" for="respondedAt" class={labelClass}>Responded</label>
			<span id="respondedAt-desc" class="sr-only">{respondedAtDesc}</span>
			<div class={dateTimeFieldClass}>
				<div
					class="{dateTimeDisplayClass} {respondedAt ? 'text-warm-700' : 'text-warm-400'}"
					aria-hidden="true"
				>
					{formatDateTimeLocal(respondedAt) || 'Select date & time'}
				</div>
				<input
					id="respondedAt"
					type="datetime-local"
					bind:value={respondedAt}
					oninput={syncRespondedAt}
					onchange={syncRespondedAt}
					aria-labelledby="respondedAt-label respondedAt-desc"
					class={dateTimeOverlayClass}
				/>
			</div>
		</div>
	</div>

	{#if submitError}
		<p class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
			{submitError}
		</p>
	{/if}

	{#if isEdit && showConfirm}
		<p class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
			Review your changes, then click <strong>Confirm Update</strong> to save.
		</p>
	{/if}

	<div class="flex gap-3 border-t border-warm-200 pt-4">
		{#if isEdit && showConfirm}
			<button type="button" onclick={handleSubmit}
				class="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-500">
				Confirm Update
			</button>
			<button type="button" onclick={() => { showConfirm = false; submitError = null; }}
				class="rounded-lg px-5 py-2 text-sm text-warm-500 hover:text-white">
				Cancel
			</button>
		{:else}
			<button type="submit"
				class="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500">
				{isEdit ? 'Update' : 'Add'} Incident
			</button>
			<button type="button" onclick={handleCancel}
				class="rounded-lg border-2 border-warm-400 px-5 py-2 text-sm text-warm-700 hover:bg-warm-50">
				Cancel
			</button>
		{/if}
	</div>

</form>
