#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ApiError, jiraClient, tempoClient } from './tempo.js';
import { credential, jiraPrompt, setup, tempoPrompt } from './setup.js';
import { readProfile, saveProfile, withWriteLock } from './store.js';
import { addDays, dateAtZone, dateRange, duration, previewRange, submitDay, validateDate } from './week.js';

import { ask, confirm, displayDate, formatHours, interactive, select, setLanguage, t, ui } from './ui.js';

const dateLabel = ({ start, end }) => start === end ? displayDate(start) : `${displayDate(start)} – ${displayDate(end)}`;
const isUpcoming = (date, local, profile) => date > local.date || (date === local.date && local.time < profile.end);

function printProfile(profile) {
  console.log(`\n${ui.title('Tempo Filler')}  ${profile.issueKey || 'Jira #' + profile.issueId}  ${profile.start}–${profile.end}`);
  const labels = profile.attributeLabels ?? profile.attributes.map(({ key, value }) => `${key}: ${value}`);
  if (labels.length) console.log(ui.dim(labels.join(' · ')));
  console.log(ui.dim(t(
    `Açıklama: ${profile.description || 'boş'}`,
    `Description: ${profile.description || 'empty'}`,
  )));
}

async function reviewDays(profile, range, logs, local, seconds, { automatic = false, dryRun = false } = {}) {
  const days = previewRange(profile, range, logs);
  const ready = days.filter(day => day.status === 'ready');
  console.log(`\n${ui.title(dateLabel(range))}`);
  if (dryRun || !automatic) {
    for (const day of days) {
      const status = day.status === 'logged' ? ui.ok(t(`${formatHours(day.logged)} kayıtlı`, `${formatHours(day.logged)} logged`))
        : day.status === 'off' ? ui.dim(t('Çalışma günü dışı', 'Day off'))
        : ui.warn(t('Kayıt eksik', 'Missing worklog'));
      console.log(`  ${displayDate(day.date)}  ${status}`);
    }
  }
  console.log(ui.warn(t(`${ready.length} boş iş günü · ${formatHours(ready.length * seconds)}`,
    `${ready.length} missing workdays · ${formatHours(ready.length * seconds)}`)));
  if (!ready.length || dryRun) return [];
  return select(t('Kaydedilecek günleri seç', 'Select dates to submit'), ready.map(day => {
    const hint = !isUpcoming(day.date, local, profile) ? '' : day.date > local.date
      ? t(' · Gelecek tarih', ' · Future date') : t(' · Mesai devam ediyor', ' · Shift in progress');
    return { value: day, label: displayDate(day.date) + hint };
  }), {
    multiple: true,
    initial: ready.flatMap((day, i) => !automatic || !isUpcoming(day.date, local, profile) ? [i] : []),
  });
}

async function customDate() {
  while (true) {
    const answer = await ask(t('Tarih (YYYY-MM-DD, geri dönmek için boş bırak)', 'Date (YYYY-MM-DD, leave blank to go back)'));
    if (!answer) return null;
    try { return validateDate(answer); } catch (error) { console.log(ui.warn(error.message)); }
  }
}

async function submitSelection(tempo, jira, profile, selected, local, seconds) {
  if (!profile.email) {
    console.log(ui.warn(t('Kayıt için Jira bağlantısı gerekli. tempo-filler setup ile ekle.',
      'Submitting requires a Jira connection. Add it with tempo-filler setup.')));
    return false;
  }
  console.log(ui.dim(selected.map(day => displayDate(day.date)).join(' · ')));
  if (selected.some(day => isUpcoming(day.date, local, profile))) {
    console.log(ui.warn(t('Seçimde ileri tarih veya mesaisi devam eden gün var.',
      'Selection includes a future date or a shift in progress.')));
  }
  const total = formatHours(selected.length * seconds);
  if (!(await confirm(t(`Tempo’ya ${selected.length} kayıt · ${total} gönderilsin mi?`,
    `Submit ${selected.length} worklogs · ${total} to Tempo?`)))) return false;
  if (!jira) jira = jiraClient(profile.site, profile.email, (await credential('JIRA_API_TOKEN', jiraPrompt())).value);
  if ((await jira.myself()).accountId !== profile.accountId) {
    throw new Error(t('Jira hesabı profille eşleşmiyor.', 'The Jira account does not match this profile.'));
  }
  await withWriteLock(async () => {
    for (const { date } of selected) {
      try {
        console.log(ui.ok(`${displayDate(date)}  ${await submitDay(tempo, jira, profile, date)}`));
      } catch (error) {
        console.error(ui.error(`${displayDate(date)}  ${error.message}`));
        console.error(t('İşlem durdu. Sonraki günler gönderilmedi.', 'Stopped. The remaining days were not submitted.'));
        process.exitCode = 1;
        break;
      }
    }
  });
  return true;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'last-week': { type: 'boolean' }, week: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    const saved = await readProfile().catch(() => null);
    if (saved?.language) setLanguage(saved.language);
    console.log(`
${ui.title('Tempo Filler')}  ${t('Tempo efor kayıtlarını kontrol et ve doldur', 'Review and fill Tempo worklogs')}

  npx tempo-filler                  ${t('İlk kurulum veya eksik günler ekranı', 'First-time setup or missing days')}
  npx tempo-filler setup            ${t('Dili, bağlantıları ve çalışma profilini düzenle', 'Edit language, connections, and work profile')}
  npx tempo-filler --last-week      ${t('Geçen haftayı aç', 'Review last week')}
  npx tempo-filler --week YYYY-MM-DD
  npx tempo-filler --dry-run        ${t('Yalnızca önizle', 'Preview without submitting')}

${t('Token oluşturma rehberleri', 'Where to create tokens')}
  Tempo      https://help.tempo.io/timesheets/latest/using-rest-api-integrations
  Atlassian  https://id.atlassian.com/manage-profile/security/api-tokens`);
    return;
  }
  let profile = await readProfile();
  if (profile?.language) setLanguage(profile.language);
  if (positionals.length > 1 || (positionals.length && positionals[0] !== 'setup')) {
    throw new Error(t('Kullanım için --help.', 'Run with --help for usage.'));
  }
  if (values.week !== undefined && values['last-week']) {
    throw new Error(t('--week ve --last-week birlikte kullanılamaz.', 'Use either --week or --last-week.'));
  }
  if (values.week !== undefined) validateDate(values.week);
  const configure = !profile || positionals[0] === 'setup';
  let language = profile?.language;
  if ((configure || !language) && interactive) {
    const languages = [{ value: 'en', label: 'English' }, { value: 'tr', label: 'Türkçe' }];
    if (language === 'tr') languages.reverse();
    language = await select('Language / Dil', languages);
    if (!language) return;
    setLanguage(language);
    if (profile && !configure) {
      profile = { ...profile, language };
      await saveProfile(profile);
    }
  }

  let tempo;
  let jira;
  if (configure) {
    if (!interactive) throw new Error(t('İlk kurulum için etkileşimli terminal gerekli.', 'First-time setup requires an interactive terminal.'));
    const configured = await setup(profile, language);
    if (!configured || positionals[0] === 'setup') return;
    ({ profile, tempo, jira } = configured);
  }
  if (!tempo) tempo = tempoClient((await credential('TEMPO_API_TOKEN', tempoPrompt())).value);

  const local = dateAtZone(profile.zone);
  const seconds = duration(profile.start, profile.end);
  const firstDay = profile.days[0];
  const missingRange = { start: addDays(local.date, -29), end: local.date };
  printProfile(profile);

  if (values.week !== undefined || values['last-week']) {
    const range = dateRange(values.week ?? addDays(local.date, -7), firstDay, true);
    const logs = await tempo.worklogs(profile.accountId, range.start, range.end);
    const selected = await reviewDays(profile, range, logs, local, seconds, { dryRun: values['dry-run'] || !interactive });
    if (selected?.length) await submitSelection(tempo, jira, profile, selected, local, seconds);
    return;
  }

  const logs = await tempo.worklogs(profile.accountId, missingRange.start, missingRange.end);
  if (values['dry-run'] || !interactive) {
    await reviewDays(profile, missingRange, logs, local, seconds, { automatic: true, dryRun: true });
    return;
  }

  const missing = previewRange(profile, missingRange, logs).filter(day => day.status === 'ready');
  console.log(`\n${ui.title(t('Son 30 gün', 'Last 30 days'))}  ${ui.dim(dateLabel(missingRange))}`);
  console.log(missing.length ? ui.warn(t(
    `${missing.length} eksik iş günü · ${formatHours(missing.length * seconds)}`,
    `${missing.length} missing workdays · ${formatHours(missing.length * seconds)}`,
  )) : ui.ok(t('Eksik iş günü yok.', 'No missing workdays.')));
  if (missing.length) {
    const recent = missing.slice(-5).map(day => displayDate(day.date)).join(' · ');
    console.log(ui.dim(recent + (missing.length > 5 ? `  +${missing.length - 5}` : '')));
  }
  console.log('');

  const options = [
    ...(missing.length ? [{ value: 'missing', label: t('Eksik günleri seç', 'Select missing days') }] : []),
    { value: 'today', label: t('Bugün', 'Today') + '  ·  ' + displayDate(local.date) },
    { value: 'tomorrow', label: t('Yarın', 'Tomorrow') + '  ·  ' + displayDate(addDays(local.date, 1)) },
    { value: 'yesterday', label: t('Dün', 'Yesterday') + '  ·  ' + displayDate(addDays(local.date, -1)) },
    { value: 'this-week', label: t('Bu haftanın tamamı', 'This whole week') },
    { value: 'last-week', label: t('Geçen haftanın tamamı', 'Last whole week') },
    { value: 'custom', label: t('Belirli bir tarih', 'Choose a date') },
    { value: null, label: t('Çık', 'Exit') },
  ];
  while (true) {
    const action = await select(t('Efor girişi', 'Log time'), options);
    if (!action) return;
    const date = action === 'custom' ? await customDate()
      : addDays(local.date, { tomorrow: 1, yesterday: -1, 'last-week': -7 }[action] ?? 0);
    if (!date) continue;
    const range = action === 'missing' ? missingRange : dateRange(date, firstDay, action.endsWith('-week'));
    const current = action === 'missing' ? logs : await tempo.worklogs(profile.accountId, range.start, range.end);
    const selected = await reviewDays(profile, range, current, local, seconds, { automatic: action === 'missing' });
    if (selected?.length && await submitSelection(tempo, jira, profile, selected, local, seconds)) return;
    console.log('');
  }
}

main().catch(error => {
  console.error(ui.error(error.message));
  if (error instanceof ApiError && [401, 403].includes(error.status)) {
    console.error(t('Token’ın geçerliliğini kontrol et veya npx tempo-filler setup ile yenile.',
      'Check that your token is valid, or replace it with npx tempo-filler setup.'));
  }
  process.exitCode = error.name === 'AbortError' ? 130 : 1;
});
