export interface TeamLeader {
	id: string;
	name: string;
	email?: string;
	phone?: string;
	created_at?: string;
}

export interface Driver {
	id: string;
	name: string;
	username: string;
	email?: string;
	phone?: string;
	teamLeaderId?: string;
	created_at?: string;
}

export type TeamLeaderInsert = Omit<TeamLeader, 'id' | 'created_at'>;
export type TeamLeaderUpdate = Partial<TeamLeaderInsert>;
export type DriverInsert = Omit<Driver, 'id' | 'created_at'>;
export type DriverUpdate = Partial<DriverInsert>;
