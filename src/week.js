import { t } from './ui.js';

const dayMs = 86_400_000;
const iso = date => date.toISOString().slice(0, 10);

export function addDays(value, days) {
  return iso(new Date(Date.parse(value) + days * dayMs));
}

export function dateAtZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

export function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || addDays(value, 0) !== value) {
    throw new Error(t('Tarih YYYY-MM-DD biçiminde ve geçerli olmalı.', 'Enter a valid date in YYYY-MM-DD format.'));
  }
  return value;
}

export function duration(start, end) {
  const minutes = value => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(t('Saat SS:DD biçiminde olmalı.', 'Enter a time in HH:MM format.'));
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  };
  const seconds = (minutes(end) - minutes(start)) * 60;
  if (seconds <= 0) throw new Error(t('Bitiş saati başlangıçtan sonra olmalı.', 'End time must be after start time.'));
  return seconds;
}

export function weekStart(date, firstDay) {
  return addDays(date, -((new Date(date).getUTCDay() - firstDay + 7) % 7));
}

export function dateRange(date, firstDay, wholeWeek = false) {
  if (!wholeWeek) return { start: date, end: date };
  const start = weekStart(date, firstDay);
  return { start, end: addDays(start, 6) };
}

export function previewRange(profile, range, logs) {
  const dates = [];
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) {
    const existing = logs.filter(log => log.startDate === date);
    const logged = existing.reduce((sum, log) => sum + log.timeSpentSeconds, 0);
    let status = 'ready';
    if (existing.length) status = 'logged';
    else if (!profile.days.includes(new Date(date).getUTCDay())) status = 'off';
    dates.push({ date, logged, status });
  }
  return dates;
}

export function buildWorklog(profile, date, remainingEstimateSeconds) {
  if (!Number.isSafeInteger(remainingEstimateSeconds) || remainingEstimateSeconds < 0) {
    throw new Error(t('Jira kalan tahmini okunamadı. Kayıt gönderilmedi.', 'The Jira remaining estimate could not be read. No worklog was submitted.'));
  }
  const timeSpentSeconds = duration(profile.start, profile.end);
  return {
    issueId: profile.issueId,
    authorAccountId: profile.accountId,
    startDate: date,
    startTime: `${profile.start}:00`,
    timeSpentSeconds,
    description: profile.description,
    attributes: profile.attributes,
    remainingEstimateSeconds,
  };
}

export async function submitDay(tempo, jira, profile, date) {
  if ((await tempo.worklogs(profile.accountId, date, date)).length) return t('Mevcut kayıt bulundu, atlandı.', 'Skipped because a worklog already exists.');
  const issue = await jira.issue(profile.issueId);
  if (String(issue.id) !== String(profile.issueId)) throw new Error(t('Jira işi doğrulanamadı.', 'The Jira issue could not be verified.'));
  const body = buildWorklog(profile, date, issue.fields?.timetracking?.remainingEstimateSeconds);
  try {
    const saved = await tempo.create(body);
    if (saved.tempoWorklogId) return t(`Kaydedildi (#${saved.tempoWorklogId}).`, `Saved (#${saved.tempoWorklogId}).`);
  } catch (error) {
    if (error.status && error.status < 500 && error.status !== 408) throw error;
  }
  const logs = await tempo.worklogs(profile.accountId, date, date).catch(() => []);
  const matching = logs.find(log => {
    const actual = log.attributes?.values ?? [];
    return log.issue?.id === body.issueId && log.startTime === body.startTime &&
      log.timeSpentSeconds === body.timeSpentSeconds &&
      (log.description ?? '') === body.description && actual.length === body.attributes.length &&
      body.attributes.every(attribute => actual.some(value => value.key === attribute.key && value.value === attribute.value));
  });
  if (matching) return t(`Tempo’da doğrulandı (#${matching.tempoWorklogId}).`, `Verified in Tempo (#${matching.tempoWorklogId}).`);
  throw new Error(t('Kayıt sonucu belirsiz. Tempo’yu kontrol etmeden bu günü tekrar gönderme.', 'Submission could not be verified. Check Tempo before retrying this day.'));
}
