export interface IncidentType {
    id: string;
    name: string;
}

export interface IncidentAction {
    id: string;
    name: string;
}

export type IncidentSource = 'ui' | 'import';

export interface Incident {
    id: string;
    /** How the incident was created — UI incidents allow editing email fields. Create-only; not updatable. */
    source: IncidentSource;
    emailSender?: string;
    emailSubject?: string;
    dateReceived: string;
    time: string;
    sender: string;
    /** ID referencing team_leaders.id */
    teamLeaderId: string | null;
    /** Resolved name for display (joined from team_leaders) */
    teamLeader?: string;
    /** ID referencing incident_types.id */
    typeId: string | null;
    /** Resolved name for display (joined from incident_types) */
    type?: string;
    marked: string;
    referenceNo: string;
    referenceText: string;
    /** ID referencing drivers.id */
    driverId: string | null;
    /** Resolved name/username for display (joined from drivers) */
    driver?: string;
    response: string;
    dateResponse: string;
    timeResponse: string;
    /** ID referencing incident_actions.id */
    actionId: string | null;
    /** Resolved name for display (joined from incident_actions) */
    action?: string;
}

// Data is now stored in Supabase.
// This file only contains the TypeScript interface and derived filter lists.
// The original seed data has been migrated to the database.

export const allTypes = [
    'DELIVERY COMPLAINT', 'Disputed Delivery', 'Feedback', 'Incident Report',
    'Investigation', 'Missing item', 'STOP DELIVERY', 'CARDING ISSUE',
    'Redelivery Request', 'Delivery Request', 'Incorrect Delivery'
].sort();

export const allDrivers = [
    'SANTANGELONDN', 'PACHARASJ', 'KONGTHONP', 'PHAMT60', 'DETVONGSK',
    'NANPANYAT', 'PARMENTEM', 'PHAMJ8', 'VOH7', 'STEWARTR9', 'TRUONGW',
    'NGUYENM72', 'KHAMPORNC', 'DONTITHIW', 'GRICIN', 'HUYNHD13', 'LOUD3',
    'TRANR11', 'CHUAIPHAC', 'SOCACIUD', 'PATELD133', 'NGUYENS35', 'DANGINP'
].sort();

export const allTeamLeaders = [
    'Andrew Tran', 'Jake Pham', 'Brett Hopgood'
].sort();

export const allActions = [
    'New', 'LIT', 'LPO', 'Resolved', 'Ack', 'AP staff'
].sort();
