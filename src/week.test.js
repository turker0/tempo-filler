import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorklog, dateRange, previewRange, submitDay } from './week.js';

const profile = {
  zone: 'Asia/Riyadh', days: [0, 1, 2, 3, 4], start: '09:30', end: '17:30',
  issueId: 1, accountId: 'test-user', description: '', billable: true, attributes: [],
};
const sunday = '2026-11-15';
const monday = '2026-11-16';

test('a whole Sunday-start week includes all blank working days and skips partial records', () => {
  const range = dateRange(monday, 0, true);
  assert.deepEqual(range, { start: sunday, end: '2026-11-21' });
  const log = { startDate: sunday, timeSpentSeconds: 7200 };
  const preview = previewRange(profile, range, [log]);
  assert.deepEqual(preview.map(day => day.status), ['logged', 'ready', 'ready', 'ready', 'ready', 'off', 'off']);
  assert.equal(preview[0].logged, 7200);
});

test('an explicit working day is eligible by itself and an explicit off day is skipped', () => {
  assert.deepEqual(previewRange(profile, dateRange(monday, 0), []), [
    { date: monday, logged: 0, status: 'ready' },
  ]);
  assert.equal(previewRange(profile, dateRange('2026-11-20', 0), [])[0].status, 'off');
});

test('a recheck with activity skips the POST entirely', async () => {
  const tempo = { worklogs: async () => [{}], create: () => assert.fail('must skip POST') };
  assert.match(await submitDay(tempo, {}, profile, monday), /Skipped/);
});

test('an unreadable estimate blocks the POST and a zero estimate is preserved', async () => {
  const tempo = { worklogs: async () => [], create: () => assert.fail('must skip POST') };
  await assert.rejects(submitDay(tempo, { issue: async () => ({ id: '1', fields: {} }) }, profile, monday), /remaining estimate/);
  const body = buildWorklog(profile, monday, 0);
  assert.equal(body.remainingEstimateSeconds, 0);
  assert.equal(body.timeSpentSeconds, 28800);
  assert.equal(Object.hasOwn(body, 'billableSeconds'), false);
});

test('a timeout is reconciled by reading the matching worklog without another POST', async () => {
  let posts = 0;
  const tempo = {
    worklogs: async () => posts ? [{
      tempoWorklogId: 42, issue: { id: 1 }, startTime: '09:30:00',
      timeSpentSeconds: 28800, billableSeconds: 28800, attributes: { values: [] },
    }] : [],
    create: async () => {
      posts++;
      throw new Error('timeout');
    },
  };
  const jira = { issue: async () => ({ id: '1', fields: { timetracking: { remainingEstimateSeconds: 3600 } } }) };
  assert.match(await submitDay(tempo, jira, profile, monday), /#42/);
  assert.equal(posts, 1);
});
