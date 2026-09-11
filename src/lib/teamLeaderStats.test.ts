import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Incident } from './data/incidents.ts';
import {
	buildTeamLeaderStats,
	classifyTeamLeaderResolution
} from './teamLeaderStats.ts';

function incident(partial: Partial<Incident> & { action?: string; response?: string }): Incident {
	return {
		id: partial.id ?? 'x',
		source: 'ui',
		dateReceived: '2026-07-01',
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
		actionId: null,
		...partial
	};
}

test('classifyTeamLeaderResolution: Ongoing / New / other', () => {
	assert.equal(classifyTeamLeaderResolution('ONGOING'), 'ongoing');
	assert.equal(classifyTeamLeaderResolution('ongoing'), 'ongoing');
	assert.equal(classifyTeamLeaderResolution('NEW'), 'new');
	assert.equal(classifyTeamLeaderResolution('new'), 'new');
	assert.equal(classifyTeamLeaderResolution('Resolved'), 'resolved');
	assert.equal(classifyTeamLeaderResolution('LIT'), 'resolved');
	assert.equal(classifyTeamLeaderResolution(''), 'resolved');
	assert.equal(classifyTeamLeaderResolution(null), 'resolved');
});

test('Unassigned Ongoing + Resolved still exclude New; Unassigned Total includes them', () => {
	const incidents = [
		incident({ id: '1', response: '', action: 'NEW' }),
		incident({ id: '2', response: '   ', action: 'New' }),
		incident({ id: 'o', response: '', action: 'ONGOING' }),
		incident({ id: 'r', response: '', action: 'Resolved' })
	];
	const stats = buildTeamLeaderStats(incidents, ['CaringbahPDC']);
	assert.equal(stats.unassignedOngoing, 1);
	assert.equal(stats.unassignedResolved, 1);
	assert.equal(stats.unassignedNew, 2);
	assert.equal(stats.unassignedTotal, 4);
	assert.equal(stats.grandTotal, incidents.length);
});

test('mix of New/Ongoing/Resolved assigned + unassigned → grandTotal === incident count', () => {
	const incidents = [
		incident({ id: 'an', response: 'CaringbahPDC', action: 'NEW' }),
		incident({ id: 'ao', response: 'CaringbahPDC', action: 'ONGOING' }),
		incident({ id: 'ar', response: 'CaringbahPDC', action: 'Resolved' }),
		incident({ id: 'un', response: '', action: 'NEW' }),
		incident({ id: 'uo', response: '', action: 'ONGOING' }),
		incident({ id: 'ur', response: '', action: 'LIT' })
	];
	const stats = buildTeamLeaderStats(incidents, ['CaringbahPDC']);
	assert.equal(stats.grandTotal, incidents.length);
	assert.equal(stats.totalOngoing, 2);
	assert.equal(stats.totalResolved, 2);
	const row = stats.rows.find((r) => r.key === 'CARINGBAHPDC');
	assert.ok(row);
	assert.equal(row.ongoing + row.resolved + row.newCount, row.total);
	assert.equal(row.total + stats.unassignedTotal, stats.grandTotal);
});

test('assigned New appears in that leader’s Total, not Unassigned', () => {
	const official = ['CaringbahPDC'];
	const stats = buildTeamLeaderStats(
		[
			incident({ id: 'n', response: 'CaringbahPDC', action: 'NEW' }),
			incident({ id: 'o', response: 'Caringbah PDC', action: 'ONGOING' }),
			incident({ id: 'r', response: 'caringbahpdc', action: 'Resolved' }),
			incident({ id: 'u', response: '', action: 'ONGOING' })
		],
		official
	);
	const row = stats.rows.find((r) => r.key === 'CARINGBAHPDC');
	assert.ok(row);
	assert.equal(row.ongoing, 1);
	assert.equal(row.resolved, 1);
	assert.equal(row.newCount, 1);
	assert.equal(row.total, 3);
	assert.equal(stats.unassignedOngoing, 1);
	assert.equal(stats.unassignedResolved, 0);
	assert.equal(stats.unassignedNew, 0);
	assert.equal(stats.unassignedTotal, 1);
	assert.equal(stats.grandTotal, 4);
});
