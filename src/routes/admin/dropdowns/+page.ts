import type { IncidentType, IncidentAction } from '$lib/data/incidents';

export interface PageData {
  incidentTypes: IncidentType[];
  incidentActions: IncidentAction[];
}