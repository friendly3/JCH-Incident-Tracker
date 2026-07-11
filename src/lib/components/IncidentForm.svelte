<script lang="ts">
	import type { Incident, IncidentType, IncidentAction } from '$lib/data/incidents';
	import type { Driver, TeamLeader } from '$lib/data/team';
	import {
		formatDateTimeFields,
		isValidDateOnly,
		normalizeDateOnly,
		normalizeTimeField
	} from '$lib/formatDate';
	import DatePickerPopover from '$lib/components/DatePickerPopover.svelte';
	import TimePickerPopover from '$lib/components/TimePickerPopover.svelte';
	import {
		matchDriverUsername,
		matchIncidentTypeName,
		parseEmailSubject,
		parseEmailSubjectLocation
	} from '$lib/parseEmailSubjectLocation';
	import { INCIDENT_PRIORITIES, normalizePriority } from '$lib/pillClasses';

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
	type SubmitErrorField = 'dateReceived' | 'dateResponse' | 'type' | 'location';
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
			locationStreet: source.locationStreet?.trim() ?? '',
			locationSuburb: source.locationSuburb?.trim() ?? '',
			sender: source.sender?.trim() ?? '',
			marked: normalizePriority(source.marked),
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
			locationStreet: '',
			locationSuburb: '',
			dateReceived: '',
			time: '',
			sender: '',
			teamLeaderId: null,
			typeId: null,
			marked: 'Normal',
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
		locationStreet: string;
		locationSuburb: string;
	};

	/**
	 * Dirty-check snapshot: keep raw trimmed date text so partial/invalid free typing
	 * (e.g. "abc", "2024-0") counts as unsaved. Strict normalizeDateOnly is for load/submit/apply only.
	 */
	function toSnapshot(value: Incident): FormSnapshot {
		return {
			source: value.source === 'import' ? 'import' : 'ui',
			dateReceived: value.dateReceived?.trim() ?? '',
			time: normalizeTimeField(value.time),
			sender: value.sender?.trim() ?? '',
			teamLeaderId: value.teamLeaderId,
			typeId: value.typeId,
			marked: normalizePriority(value.marked),
			referenceNo: value.referenceNo?.trim() ?? '',
			referenceText: value.referenceText?.trim() ?? '',
			driverId: value.driverId,
			response: value.response?.trim() ?? '',
			dateResponse: value.dateResponse?.trim() ?? '',
			timeResponse: normalizeTimeField(value.timeResponse),
			actionId: value.actionId,
			emailSender: value.emailSender?.trim() ?? '',
			emailSubject: value.emailSubject?.trim() ?? '',
			locationStreet: value.locationStreet?.trim() ?? '',
			locationSuburb: value.locationSuburb?.trim() ?? ''
		};
	}

	let form = $state<Incident>({
		id: '',
		source: 'ui',
		emailSender: '',
		emailSubject: '',
		locationStreet: '',
		locationSuburb: '',
		dateReceived: '',
		time: '',
		sender: '',
		teamLeaderId: null,
		typeId: null,
		marked: 'Normal',
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

	/** Which custom time/date popover is open (null = closed). Declared early for requestClose/reset. */
	type TimePickerField = 'time' | 'timeResponse';
	type DatePickerField = 'dateReceived' | 'dateResponse';
	let openTimePickerField = $state<TimePickerField | null>(null);
	let openDatePickerField = $state<DatePickerField | null>(null);

	/** Synchronous dirty check for parent dismiss handlers (backdrop/Escape). */
	export function getHasUnsavedChanges(): boolean {
		return computeHasUnsavedChanges();
	}

	/** Report dirty state to parent for close/discard flow. */
	export function requestClose(): void {
		// Nested pickers must not stay logically open under discard/close.
		openTimePickerField = null;
		openDatePickerField = null;
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
		openTimePickerField = null;
		openDatePickerField = null;
		const source = incident;
		const initial = source ? normalizeIncident(source) : emptyIncident();
		form = initial;
		baselineSnapshot = JSON.stringify(toSnapshot(initial));
	});

	function handleSubmit() {
		submitError = null;
		submitErrorField = null;

		const typeId = normalizeFkId(form.typeId);
		const dateReceived = normalizeDateOnly(form.dateReceived);
		const dateResponse = normalizeDateOnly(form.dateResponse);

		if (!form.dateReceived?.trim()) {
			submitError = 'Date Received is required.';
			submitErrorField = 'dateReceived';
			return;
		}
		if (!dateReceived) {
			submitError = 'Date Received must be a valid date (yyyy-mm-dd).';
			submitErrorField = 'dateReceived';
			return;
		}
		// Optional responded date: empty is fine; non-empty must be a real calendar day.
		if (form.dateResponse?.trim() && !dateResponse) {
			submitError = 'Responded date must be a valid date (yyyy-mm-dd).';
			submitErrorField = 'dateResponse';
			return;
		}
		if (!typeId) {
			submitError = 'Type is required — please select an incident type.';
			submitErrorField = 'type';
			return;
		}

		const locationStreet = form.locationStreet?.trim() ?? '';
		const locationSuburb = form.locationSuburb?.trim() ?? '';
		// Street without suburb is not enough to place on the map
		if (locationStreet && !locationSuburb) {
			submitError = 'Suburb is required when a street is set (for the NSW map).';
			submitErrorField = 'location';
			return;
		}

		// Persist normalized values so free-typed prefixes become clean YYYY-MM-DD.
		form.dateReceived = dateReceived;
		form.dateResponse = dateResponse;
		form.locationStreet = locationStreet;
		form.locationSuburb = locationSuburb;

		const payload: Incident = {
			...form,
			source: form.source === 'import' ? 'import' : 'ui',
			dateReceived,
			dateResponse,
			locationStreet,
			locationSuburb,
			marked: normalizePriority(form.marked),
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
	/**
	 * Text date field for typed YYYY-MM-DD entry. No native date picker chrome —
	 * the calendar icon opens DatePickerPopover (warm custom UI). Field click keeps caret for typing.
	 */
	const dateTextClass =
		'form-field-surface input-focus relative w-full min-h-[2.375rem] rounded-md border border-warm-200 bg-white px-3 py-2 pr-10 text-sm text-warm-700 dark:bg-warm-200';
	/**
	 * Native time control for typed HH:mm entry. No full-field webkit indicator —
	 * the clock icon opens TimePickerPopover (reliable custom UI).
	 */
	const nativeTimeClass =
		'native-time form-field-surface input-focus relative w-full min-h-[2.375rem] rounded-md border border-warm-200 bg-white px-3 py-2 pr-10 text-sm text-warm-700 dark:bg-warm-200';
	/** Clickable icon button that opens the custom date or time popover. */
	const dateTimeIconBtnClass =
		'absolute right-1 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md border border-warm-200 bg-white text-warm-600 shadow-sm hover:bg-warm-50 hover:text-warm-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-warm-300 dark:bg-warm-200 dark:text-warm-800 dark:hover:bg-warm-300';
	const dateTimeControlClass = 'flex flex-col gap-2 sm:flex-row sm:items-stretch';
	const timeFieldWrapClass = 'relative w-full sm:w-[9.5rem] sm:shrink-0';
	const dateFieldWrapClass = 'relative min-w-0 flex-1';

	const datePickerDialogId = {
		dateReceived: 'receivedAt-date-picker-dialog',
		dateResponse: 'respondedAt-date-picker-dialog'
	} as const;

	const timePickerDialogId = {
		time: 'receivedAt-time-picker-dialog',
		timeResponse: 'respondedAt-time-picker-dialog'
	} as const;

	/** Anchor wraps for positioning date/time popovers under each field. */
	let dateReceivedWrapEl = $state<HTMLDivElement | undefined>(undefined);
	let dateResponseWrapEl = $state<HTMLDivElement | undefined>(undefined);
	let timeReceivedWrapEl = $state<HTMLDivElement | undefined>(undefined);
	let timeResponseWrapEl = $state<HTMLDivElement | undefined>(undefined);

	function openDatePicker(field: DatePickerField, event?: Event) {
		event?.preventDefault();
		event?.stopPropagation();
		openTimePickerField = null;
		openDatePickerField = field;
	}

	function toggleDatePicker(field: DatePickerField, event?: Event) {
		event?.preventDefault();
		event?.stopPropagation();
		openTimePickerField = null;
		openDatePickerField = openDatePickerField === field ? null : field;
	}

	function closeDatePicker() {
		openDatePickerField = null;
	}

	/** Apply chosen YYYY-MM-DD and close — single close ownership (parent of popover). */
	function applyDatePicker(field: DatePickerField, date: string) {
		const normalized = normalizeDateOnly(date);
		if (!normalized) return;
		if (field === 'dateReceived') form.dateReceived = normalized;
		else form.dateResponse = normalized;
		if (submitErrorField === field) {
			submitError = null;
			submitErrorField = null;
		}
		openDatePickerField = null;
	}

	/** Alt+ArrowDown opens the custom calendar without stealing caret on plain click. */
	function onDateTextKeydown(field: DatePickerField, event: KeyboardEvent) {
		if (event.key === 'ArrowDown' && event.altKey) {
			event.preventDefault();
			openDatePicker(field, event);
		}
	}

	function openTimePicker(field: TimePickerField, event?: Event) {
		event?.preventDefault();
		event?.stopPropagation();
		openDatePickerField = null;
		openTimePickerField = field;
	}

	function toggleTimePicker(field: TimePickerField, event?: Event) {
		event?.preventDefault();
		event?.stopPropagation();
		openDatePickerField = null;
		openTimePickerField = openTimePickerField === field ? null : field;
	}

	function closeTimePicker() {
		openTimePickerField = null;
	}

	/** Apply chosen HH:mm and close — single close ownership (parent of popover). */
	function applyTimePicker(field: TimePickerField, time: string) {
		const normalized = normalizeTimeField(time);
		if (field === 'time') form.time = normalized;
		else form.timeResponse = normalized;
		openTimePickerField = null;
	}

	/**
	 * Normalize free-typed date text on blur.
	 * Empty → clear; valid calendar YYYY-MM-DD → normalize; invalid → keep text + field error.
	 */
	function onDateTextBlur(field: DatePickerField) {
		// Do not validate while focus is moving into the open popover for this field.
		if (openDatePickerField === field) return;

		const raw = field === 'dateReceived' ? form.dateReceived : form.dateResponse;
		const trimmed = raw?.trim() ?? '';
		const label = field === 'dateReceived' ? 'Date Received' : 'Responded date';

		if (!trimmed) {
			if (field === 'dateReceived') form.dateReceived = '';
			else form.dateResponse = '';
			if (submitErrorField === field) {
				submitError = null;
				submitErrorField = null;
			}
			return;
		}

		const normalized = normalizeDateOnly(trimmed);
		if (normalized) {
			if (field === 'dateReceived') form.dateReceived = normalized;
			else form.dateResponse = normalized;
			if (submitErrorField === field) {
				submitError = null;
				submitErrorField = null;
			}
			return;
		}

		// Leave invalid text for the user to fix; flag the field immediately.
		if (field === 'dateReceived') form.dateReceived = trimmed;
		else form.dateResponse = trimmed;
		submitError = `${label} must be a valid date (yyyy-mm-dd).`;
		submitErrorField = field;
	}

	const receivedAtDesc = $derived(
		isValidDateOnly(form.dateReceived)
			? formatDateTimeFields(form.dateReceived, form.time) || 'Date and time not set'
			: form.dateReceived?.trim()
				? 'Invalid date'
				: 'Date and time not set'
	);
	const respondedAtDesc = $derived(
		isValidDateOnly(form.dateResponse)
			? formatDateTimeFields(form.dateResponse, form.timeResponse) || 'Date and time not set'
			: form.dateResponse?.trim()
				? 'Invalid date'
				: 'Date and time not set'
	);
	const emailFieldsEditable = $derived((form.source ?? 'ui') === 'ui');
	/** Plain text for read-only values — not styled as form controls. */
	const readonlyValueClass =
		'block w-full select-text break-words text-sm leading-relaxed text-warm-700 dark:text-warm-800';
	const readonlyEmptyClass = 'block w-full text-sm italic text-warm-400';
	const footerBtnFocus =
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';

	/** Full subject parse (ref / type / driver / location). */
	const subjectParsed = $derived(parseEmailSubject(form.emailSubject));
	const subjectParsedLocation = $derived(parseEmailSubjectLocation(form.emailSubject));
	const subjectMatchedType = $derived(
		matchIncidentTypeName(subjectParsed?.typeName, incidentTypes)
	);
	const subjectMatchedDriver = $derived(
		matchDriverUsername(subjectParsed?.driver, drivers)
	);
	const hasManualLocation = $derived(
		!!(form.locationSuburb?.trim() || form.locationStreet?.trim())
	);
	const locationStatusText = $derived.by(() => {
		const suburb = form.locationSuburb?.trim();
		const street = form.locationStreet?.trim();
		if (suburb) {
			return street
				? `Map will use: ${street}, ${suburb}, NSW`
				: `Map will use suburb centre: ${suburb}, NSW`;
		}
		if (subjectParsedLocation) {
			const st = subjectParsedLocation.street
				? `${subjectParsedLocation.street}, `
				: '';
			return `Map will use subject: ${st}${subjectParsedLocation.suburb}, NSW`;
		}
		return 'No map location yet — enter suburb (and optional street) below, or use a matching email subject.';
	});

	const subjectDetectSummary = $derived.by(() => {
		const p = subjectParsed;
		if (!p) return null;
		const bits: string[] = [];
		if (p.referenceNo) bits.push(`Ref ${p.referenceNo}`);
		if (p.typeName) {
			bits.push(
				subjectMatchedType
					? `Type “${subjectMatchedType.name}”`
					: `Type “${p.typeName}” (no exact match)`
			);
		}
		if (p.driver) {
			bits.push(
				subjectMatchedDriver
					? `Driver ${subjectMatchedDriver.username}`
					: `Driver ${p.driver} (not in list)`
			);
		}
		if (p.suburb) {
			bits.push(
				p.street ? `${p.street}, ${p.suburb}` : p.suburb
			);
		}
		return bits.length ? bits.join(' · ') : null;
	});

	function applySubjectLocation() {
		const parsed = parseEmailSubject(form.emailSubject);
		if (!parsed?.suburb) return;
		form.locationStreet = parsed.street ?? '';
		form.locationSuburb = parsed.suburb;
		if (submitErrorField === 'location') {
			submitError = null;
			submitErrorField = null;
		}
	}

	function applySubjectReference() {
		const ref = subjectParsed?.referenceNo;
		if (!ref) return;
		form.referenceNo = ref;
	}

	function applySubjectType() {
		if (!subjectMatchedType) return;
		form.typeId = subjectMatchedType.id;
		if (submitErrorField === 'type') {
			submitError = null;
			submitErrorField = null;
		}
	}

	function applySubjectDriver() {
		if (!subjectMatchedDriver) return;
		form.driverId = subjectMatchedDriver.id;
	}

	/** Apply every field we can confidently map from the subject. */
	function applyAllFromSubject() {
		const p = subjectParsed;
		if (!p) return;
		if (p.referenceNo) form.referenceNo = p.referenceNo;
		if (subjectMatchedType) {
			form.typeId = subjectMatchedType.id;
			if (submitErrorField === 'type') {
				submitError = null;
				submitErrorField = null;
			}
		}
		if (subjectMatchedDriver) form.driverId = subjectMatchedDriver.id;
		if (p.suburb) {
			form.locationStreet = p.street ?? '';
			form.locationSuburb = p.suburb;
			if (submitErrorField === 'location') {
				submitError = null;
				submitErrorField = null;
			}
		}
	}

	function clearManualLocation() {
		form.locationStreet = '';
		form.locationSuburb = '';
		if (submitErrorField === 'location') {
			submitError = null;
			submitErrorField = null;
		}
	}

	const receivedAtDescribedBy = $derived(
		submitErrorField === 'dateReceived'
			? 'receivedAt-desc incident-submit-error'
			: 'receivedAt-desc'
	);
	const respondedAtDescribedBy = $derived(
		submitErrorField === 'dateResponse'
			? 'respondedAt-desc incident-submit-error'
			: 'respondedAt-desc'
	);
</script>

{#snippet dateTimeCalendarButton(field: DatePickerField, label: string)}
	<button
		type="button"
		class={dateTimeIconBtnClass}
		aria-label={label}
		aria-haspopup="dialog"
		aria-expanded={openDatePickerField === field}
		aria-controls={datePickerDialogId[field]}
		data-date-picker-trigger
		data-date-field={field}
		onclick={(e) => toggleDatePicker(field, e)}
	>
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
	</button>
{/snippet}

{#snippet dateTimeClockButton(field: TimePickerField, label: string)}
	<button
		type="button"
		class={dateTimeIconBtnClass}
		aria-label={label}
		aria-haspopup="dialog"
		aria-expanded={openTimePickerField === field}
		aria-controls={timePickerDialogId[field]}
		data-time-picker-trigger
		data-time-field={field}
		onclick={(e) => toggleTimePicker(field, e)}
	>
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
	</button>
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
					{#if emailFieldsEditable}
						<label for="emailSender" class="sn-field-label">Email Sender</label>
						<div class="sn-field-control">
							<input
								id="emailSender"
								type="text"
								bind:value={form.emailSender}
								class={inputClass}
							/>
						</div>
					{:else}
						<span class="sn-field-label" id="emailSender-ro-label">Email Sender</span>
						<div class="sn-field-control" role="group" aria-labelledby="emailSender-ro-label">
							{#if form.emailSender?.trim()}
								<p class={readonlyValueClass}>{form.emailSender}</p>
							{:else}
								<p class={readonlyEmptyClass}>Not set</p>
							{/if}
						</div>
					{/if}
				</div>
				<div class="sn-field-row">
					{#if emailFieldsEditable}
						<label for="emailSubject" class="sn-field-label">Email Subject</label>
						<div class="sn-field-control">
							<input
								id="emailSubject"
								type="text"
								bind:value={form.emailSubject}
								class={inputClass}
								placeholder="SOD Disputed Delivery: 72956318 N22226 Menai DRIVER - Street"
							/>
						</div>
					{:else}
						<span class="sn-field-label" id="emailSubject-ro-label">Email Subject</span>
						<div class="sn-field-control" role="group" aria-labelledby="emailSubject-ro-label">
							{#if form.emailSubject?.trim()}
								<p class={readonlyValueClass}>{form.emailSubject}</p>
							{:else}
								<p class={readonlyEmptyClass}>Not set</p>
							{/if}
						</div>
					{/if}
				</div>

				{#if subjectDetectSummary}
					<div
						class="mb-4 mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-950 dark:border-sky-700/50 dark:bg-sky-950/40 dark:text-sky-100"
						role="status"
					>
						<p class="font-semibold text-sky-900 dark:text-sky-100">Detected from email subject</p>
						<p class="mt-1 leading-snug opacity-95">{subjectDetectSummary}</p>
						<div class="mt-2 flex flex-wrap gap-1.5">
							<button
								type="button"
								class="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100 {footerBtnFocus} dark:border-sky-600 dark:bg-sky-900 dark:text-sky-50"
								onclick={applyAllFromSubject}
							>
								Apply all matched fields
							</button>
							{#if subjectParsed?.referenceNo}
								<button
									type="button"
									class="rounded-md border border-sky-200 bg-white/80 px-2 py-1 text-xs text-sky-900 hover:bg-sky-100 {footerBtnFocus} dark:border-sky-700 dark:bg-sky-900/80 dark:text-sky-100"
									onclick={applySubjectReference}
								>
									Ref
								</button>
							{/if}
							{#if subjectMatchedType}
								<button
									type="button"
									class="rounded-md border border-sky-200 bg-white/80 px-2 py-1 text-xs text-sky-900 hover:bg-sky-100 {footerBtnFocus} dark:border-sky-700 dark:bg-sky-900/80 dark:text-sky-100"
									onclick={applySubjectType}
								>
									Type
								</button>
							{/if}
							{#if subjectMatchedDriver}
								<button
									type="button"
									class="rounded-md border border-sky-200 bg-white/80 px-2 py-1 text-xs text-sky-900 hover:bg-sky-100 {footerBtnFocus} dark:border-sky-700 dark:bg-sky-900/80 dark:text-sky-100"
									onclick={applySubjectDriver}
								>
									Driver
								</button>
							{/if}
							{#if subjectParsed?.suburb}
								<button
									type="button"
									class="rounded-md border border-sky-200 bg-white/80 px-2 py-1 text-xs text-sky-900 hover:bg-sky-100 {footerBtnFocus} dark:border-sky-700 dark:bg-sky-900/80 dark:text-sky-100"
									onclick={applySubjectLocation}
								>
									Location
								</button>
							{/if}
						</div>
						{#if subjectParsed?.typeName && !subjectMatchedType}
							<p class="mt-1.5 text-[11px] text-amber-800 dark:text-amber-200">
								Type “{subjectParsed.typeName}” is not in the type list — pick the closest
								manually or add it under Admin.
							</p>
						{/if}
						{#if subjectParsed?.driver && !subjectMatchedDriver}
							<p class="mt-1 text-[11px] text-amber-800 dark:text-amber-200">
								Driver “{subjectParsed.driver}” is not in the team list — add them under Team
								or assign manually.
							</p>
						{/if}
					</div>
				{/if}

				<div class="mb-2 mt-6" role="group" aria-labelledby="section-location-heading">
					<h3 id="section-location-heading" class="sn-section-title">Map location (NSW)</h3>
					<p class="mb-3 text-xs leading-snug text-warm-500" id="location-status">
						{locationStatusText}
					</p>
					{#if subjectParsedLocation && !hasManualLocation}
						<p class="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-700/50 dark:bg-sky-950/40 dark:text-sky-100">
							Detected from email subject:
							<strong>
								{subjectParsedLocation.street
									? `${subjectParsedLocation.street}, `
									: ''}{subjectParsedLocation.suburb}
							</strong>
							— use <em>Apply</em> above or edit the fields below.
						</p>
					{:else if !subjectParsedLocation && !hasManualLocation}
						<p class="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
							Location undetermined from the email subject. Enter a suburb (street optional)
							so this incident appears on the dashboard map.
						</p>
					{/if}
					<div class="sn-field-row">
						<label for="locationStreet" class="sn-field-label">Street</label>
						<div class="sn-field-control">
							<input
								id="locationStreet"
								type="text"
								bind:value={form.locationStreet}
								placeholder="e.g. Blaxland Dr"
								autocomplete="street-address"
								aria-describedby="location-status"
								aria-invalid={submitErrorField === 'location' ? 'true' : undefined}
								class={inputClass}
							/>
						</div>
					</div>
					<div class="sn-field-row">
						<label for="locationSuburb" class="sn-field-label">Suburb</label>
						<div class="sn-field-control">
							<input
								id="locationSuburb"
								type="text"
								bind:value={form.locationSuburb}
								placeholder="e.g. Menai"
								autocomplete="address-level2"
								aria-describedby="location-status"
								aria-invalid={submitErrorField === 'location' ? 'true' : undefined}
								class={inputClass}
							/>
						</div>
					</div>
					<div class="sn-field-row">
						<span class="sn-field-label sr-only">Location actions</span>
						<div class="sn-field-control flex flex-wrap gap-2">
							{#if subjectParsedLocation}
								<button
									type="button"
									class="rounded-md border border-warm-200 bg-white px-2.5 py-1.5 text-xs font-medium text-warm-700 hover:bg-warm-50 {footerBtnFocus}"
									onclick={applySubjectLocation}
								>
									Use subject location
								</button>
							{/if}
							{#if hasManualLocation}
								<button
									type="button"
									class="rounded-md border border-warm-200 bg-white px-2.5 py-1.5 text-xs font-medium text-warm-700 hover:bg-warm-50 {footerBtnFocus}"
									onclick={clearManualLocation}
								>
									Clear map location
								</button>
							{/if}
						</div>
					</div>
				</div>

				<div class="sn-field-row">
					<span id="receivedAt-label" class="sn-field-label">
						Email received <span class="text-red-600">*</span>
					</span>
					<div class="sn-field-control">
						<span id="receivedAt-desc" class="sr-only">{receivedAtDesc}</span>
						<p class="mb-1.5 text-xs text-warm-500" id="receivedAt-help">
							Date and time the email was received (stored as date + time on the incident).
						</p>
						<div
							class={dateTimeControlClass}
							role="group"
							aria-labelledby="receivedAt-label"
							aria-describedby="receivedAt-help {receivedAtDescribedBy}"
						>
							<div
								class={dateFieldWrapClass}
								data-datetime-wrap
								bind:this={dateReceivedWrapEl}
							>
								<input
									id="receivedAt"
									type="text"
									placeholder="yyyy-mm-dd"
									autocomplete="off"
									spellcheck="false"
									bind:value={form.dateReceived}
									aria-labelledby="receivedAt-label receivedAt-date-hint"
									aria-describedby={receivedAtDescribedBy}
									aria-required="true"
									aria-invalid={submitErrorField === 'dateReceived' ? 'true' : undefined}
									class={dateTextClass}
									onkeydown={(e) => onDateTextKeydown('dateReceived', e)}
									onblur={() => onDateTextBlur('dateReceived')}
								/>
								{@render dateTimeCalendarButton(
									'dateReceived',
									'Open date picker for email received date'
								)}
								<DatePickerPopover
									open={openDatePickerField === 'dateReceived'}
									value={form.dateReceived}
									title="Email received date"
									idPrefix="receivedAt-date-picker"
									anchorEl={dateReceivedWrapEl}
									onApply={(d) => applyDatePicker('dateReceived', d)}
									onClose={closeDatePicker}
								/>
							</div>
							<span id="receivedAt-date-hint" class="sr-only">Date</span>
							<div
								class={timeFieldWrapClass}
								data-datetime-wrap
								bind:this={timeReceivedWrapEl}
							>
								<input
									id="receivedAt-time"
									type="time"
									bind:value={form.time}
									aria-labelledby="receivedAt-label receivedAt-time-hint"
									aria-describedby="receivedAt-desc receivedAt-help"
									class={nativeTimeClass}
									onclick={(e) => openTimePicker('time', e)}
								/>
								{@render dateTimeClockButton('time', 'Open time picker for email received time')}
								<TimePickerPopover
									open={openTimePickerField === 'time'}
									value={form.time}
									title="Email received time"
									idPrefix="receivedAt-time-picker"
									anchorEl={timeReceivedWrapEl}
									onApply={(t) => applyTimePicker('time', t)}
									onClose={closeTimePicker}
								/>
							</div>
							<span id="receivedAt-time-hint" class="sr-only">Time (email received)</span>
						</div>
					</div>
				</div>
			</section>

			<section class="mb-8" aria-labelledby="section-classification-heading">
				<h3 id="section-classification-heading" class="sn-section-title">Classification</h3>
				<div class="sn-field-row">
					<label for="action" class="sn-field-label">Action Status</label>
					<div class="sn-field-control">
						<select
							id="action"
							value={form.actionId ?? FK_EMPTY}
							onchange={(e) => setFkField('actionId', e.currentTarget.value)}
							class="{inputClass} uppercase"
						>
							<option value={FK_EMPTY}>— None —</option>
							{#if form.actionId && !fkInList(form.actionId, incidentActions)}
								<option value={form.actionId}>{incident?.action ?? 'Current action status'}</option>
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
					<label for="priority" class="sn-field-label">Priority</label>
					<div class="sn-field-control">
						<select
							id="priority"
							bind:value={form.marked}
							class="{inputClass} uppercase"
							aria-label="Priority"
						>
							{#each INCIDENT_PRIORITIES as p (p)}
								<option value={p} class="uppercase">{p}</option>
							{/each}
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
							<div
								class={dateFieldWrapClass}
								data-datetime-wrap
								bind:this={dateResponseWrapEl}
							>
								<input
									id="respondedAt"
									type="text"
									placeholder="yyyy-mm-dd"
									autocomplete="off"
									spellcheck="false"
									bind:value={form.dateResponse}
									aria-labelledby="respondedAt-label respondedAt-date-hint"
									aria-describedby={respondedAtDescribedBy}
									aria-invalid={submitErrorField === 'dateResponse' ? 'true' : undefined}
									class={dateTextClass}
									onkeydown={(e) => onDateTextKeydown('dateResponse', e)}
									onblur={() => onDateTextBlur('dateResponse')}
								/>
								{@render dateTimeCalendarButton(
									'dateResponse',
									'Open date picker for responded'
								)}
								<DatePickerPopover
									open={openDatePickerField === 'dateResponse'}
									value={form.dateResponse}
									title="Date responded"
									idPrefix="respondedAt-date-picker"
									anchorEl={dateResponseWrapEl}
									onApply={(d) => applyDatePicker('dateResponse', d)}
									onClose={closeDatePicker}
								/>
							</div>
							<span id="respondedAt-date-hint" class="sr-only">Date</span>
							<div
								class={timeFieldWrapClass}
								data-datetime-wrap
								bind:this={timeResponseWrapEl}
							>
								<input
									id="respondedAt-time"
									type="time"
									bind:value={form.timeResponse}
									aria-labelledby="respondedAt-label respondedAt-time-hint"
									aria-describedby="respondedAt-desc"
									class={nativeTimeClass}
									onclick={(e) => openTimePicker('timeResponse', e)}
								/>
								{@render dateTimeClockButton('timeResponse', 'Open time picker for responded')}
								<TimePickerPopover
									open={openTimePickerField === 'timeResponse'}
									value={form.timeResponse}
									title="Time responded"
									idPrefix="respondedAt-time-picker"
									anchorEl={timeResponseWrapEl}
									onApply={(t) => applyTimePicker('timeResponse', t)}
									onClose={closeTimePicker}
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
