import type { IncidentType, IncidentAction, RespondedByOption } from '$lib/data/incidents';

export interface PageData {
	incidentTypes: IncidentType[];
	incidentActions: IncidentAction[];
	respondedByOptions: RespondedByOption[];
	loadError: string | null;
}
