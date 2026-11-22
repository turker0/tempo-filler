import { jiraClient, tempoClient, ApiError } from './tempo.js';
import { saveProfile, savedToken, saveToken } from './store.js';
import { addDays, dateAtZone, duration } from './week.js';
import { ask, displayDate, formatHours, interactive, select, t, ui } from './ui.js';

const tempoGuide = 'https://help.tempo.io/timesheets/latest/using-rest-api-integrations';
const jiraTokens = 'https://id.atlassian.com/manage-profile/security/api-tokens';
const jiraGuide = 'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/';
const weekdayNames = () => t(
  ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
);

export const tempoPrompt = () => t('Tempo API token’ı', 'Tempo API token');
export const jiraPrompt = () => t('Atlassian API token’ı', 'Atlassian API token');

function explain(...lines) {
  for (const line of lines) console.log(`  ${ui.dim(line)}`);
}

function section(number, label, ...lines) {
  console.log(`\n${ui.title(`${number}/4  ${label}`)}`);
  explain(...lines);
}

async function field(label, fallback, { hint, validate } = {}) {
  if (hint) explain(hint);
  while (true) {
    const value = await ask(label, fallback);
    const message = validate?.(value);
    if (!message) return value;
    console.log(ui.warn(message));
  }
}

export async function credential(name, label, replace = false) {
  const existing = savedToken(name);
  if (existing && !replace) return { value: existing, fresh: false };
  if (!interactive) throw new Error(t(`${name} ortam değişkenini tanımla.`, `Set the ${name} environment variable.`));
  const instructions = name === 'TEMPO_API_TOKEN' ? [
    t('Tempo → Settings → Data Access → API Integration bölümünde bir token oluştur.',
      'Create a token in Tempo → Settings → Data Access → API Integration.'),
    tempoGuide,
  ] : [
    t('Jira’da kullandığın Atlassian hesabıyla giriş yap ve Create API token seç.',
      'Sign in with your Jira account and choose Create API token.'),
    jiraTokens,
  ];
  explain(...instructions, t('Token’ı yapıştır ve Enter’a bas. Yazdıkların görünmez.',
    'Paste the token and press Enter. Input is hidden.'));
  if (existing) explain(t('Kayıtlı token’ı kullanmak için boş bırak.', 'Press Enter to keep the saved token.'));
  while (true) {
    const value = await ask(label, existing ?? '', { secret: true });
    if (value) return { value, fresh: value !== existing };
    console.log(ui.warn(t('Token boş olamaz.', 'Paste a token to continue.')));
  }
}

async function connectionError(error, hint) {
  if (!(error instanceof ApiError)) throw error;
  console.log(ui.warn(error.message));
  if ([401, 403].includes(error.status)) explain(hint);
  return await select(t('Bağlantı kurulamadı', 'Could not connect'), [
    { label: t('Tekrar dene', 'Try again'), value: true },
    { label: t('Kurulumdan çık', 'Exit setup'), value: false },
  ]);
}

async function connectTempo(day, write, replace) {
  const permission = write ? 'Manage Access' : 'View Access';
  explain(t(`Token’da Worklogs → ${permission} seç. Diğer kapsamlar zorunlu değil.`,
    `Set Worklogs to ${permission}. Other scopes are optional.`));
  while (true) {
    const token = await credential('TEMPO_API_TOKEN', tempoPrompt(), replace);
    const tempo = tempoClient(token.value);
    explain(t('Tempo bağlantısı kontrol ediliyor…', 'Checking the Tempo connection…'));
    try {
      const visible = await tempo.worklogs(null, addDays(day, -14), day, { firstPage: true });
      console.log(ui.ok(t('✓ Tempo bağlantısı doğrulandı.', '✓ Tempo connection verified.')));
      return { tempo, token, visible };
    } catch (error) {
      const retry = await connectionError(error, t(
        `Token’ın süresini ve Tempo’daki Worklogs → ${permission} ayarını kontrol et.`,
        `Check the token’s expiration and Worklogs → ${permission} in Tempo.`,
      ));
      if (!retry) return null;
      if ([401, 403].includes(error.status)) replace = true;
    }
  }
}

async function connectJira(previous, replace) {
  let site = previous?.site;
  let email = previous?.email;
  explain(t('Bu bağlantıyla Jira hesabını, iş anahtarını ve kalan tahmini okuruz.',
    'This connection reads your Jira account, issue key, and current remaining estimate.'),
  t('Bu sürüm site adresine bağlandığı için kapsamlı token seçeneği yerine Create API token kullan.',
    'This version connects to your Jira site. Choose Create API token rather than Create API token with scopes.'),
  jiraGuide);
  while (true) {
    const siteInput = await field(t('Jira site adresi', 'Jira site'), site, {
      hint: t('Örnek: şirket.atlassian.net. Jira’da açık olan sayfanın bağlantısını da yapıştırabilirsin.',
        'Example: company.atlassian.net. You can also paste the URL of a Jira page.'),
      validate: value => jiraSite(value) ? '' : t('Geçerli bir atlassian.net adresi gir.', 'Enter a valid atlassian.net site.'),
    });
    site = jiraSite(siteInput);
    email = await field(t('Atlassian e-posta adresi', 'Atlassian email'), email, {
      hint: t('Token’ı oluşturduğun hesabın e-posta adresi.', 'Use the email for the account that created the token.'),
      validate: value => /^[^\s@:]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : t('Geçerli bir e-posta adresi gir.', 'Enter a valid email address.'),
    });
    const token = await credential('JIRA_API_TOKEN', jiraPrompt(), replace);
    const jira = jiraClient(site, email, token.value);
    explain(t('Jira bağlantısı kontrol ediliyor…', 'Checking the Jira connection…'));
    try {
      const account = await jira.myself();
      if (!account.accountId) throw new Error(t('Jira hesap kimliği okunamadı.', 'Could not read the Jira account ID.'));
      console.log(ui.ok(`${t('✓ Jira bağlantısı doğrulandı', '✓ Jira connection verified')}${account.displayName ? ' · ' + account.displayName : ''}`));
      return { jira, token, site, email, accountId: account.accountId };
    } catch (error) {
      const retry = await connectionError(error, t(
        'Jira adresini, token’ı oluşturan e-postayı ve token türünü kontrol et.',
        'Check the Jira site, the email that created the token, and the token type.',
      ));
      if (!retry) return null;
      if ([401, 403].includes(error.status)) replace = true;
    }
  }
}

function jiraSite(value) {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/i.test(url.hostname)) return url.hostname;
  } catch {
    return null;
  }
  return null;
}

function historicalTemplates(logs, accountId, previous) {
  const saved = previous?.accountId === accountId ? {
    startTime: previous.start,
    issue: { id: previous.issueId, key: previous.issueKey },
    attributes: { values: previous.attributes },
    timeSpentSeconds: duration(previous.start, previous.end),
  } : null;
  const candidates = saved ? [saved] : [];
  const signature = log => JSON.stringify([log.issue.id, log.attributes.values.map(({ key, value }) => [key, value]).sort()]);
  const seen = new Set(saved ? [signature(saved)] : []);
  for (const log of [...logs].sort((a, b) => b.startDate.localeCompare(a.startDate))) {
    if (log.author?.accountId !== accountId || !Number.isSafeInteger(log.issue?.id) || log.issue.id <= 0) continue;
    const attributes = log.attributes?.values;
    if (!Array.isArray(attributes) || attributes.some(value => typeof value.key !== 'string' || typeof value.value !== 'string')) continue;
    const key = signature(log);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(log);
    if (candidates.length === 10) break;
  }
  return candidates;
}

async function workProfile(tempo, jira, accountId, previous, day) {
  section(3, t('Baz efor kaydı', 'Base worklog'),
    t('Jira işi ve Tempo alanları için daha önce doğru girdiğin bir kaydı seç.',
      'Pick a worklog you entered correctly to reuse its Jira issue and Tempo fields.'),
    t('Bu şablon, daha sonra seçtiğin tarihlere uygulanır.', 'This template will be applied to the dates you select later.'));
  explain(t('Son 60 gündeki efor kayıtların okunuyor…', 'Reading your worklogs from the past 60 days…'));
  const logs = await tempo.worklogs(accountId, addDays(day, -60), day);
  const templates = historicalTemplates(logs, accountId, previous);
  if (!templates.length) {
    console.log(ui.warn(t('Son 60 günde şablon bulunamadı.', 'No template found in the last 60 days.')));
    explain(t('Tempo’da bir iş gününe efor gir ve npx tempo-filler setup komutunu tekrar çalıştır.',
      'Log one workday in Tempo, then run npx tempo-filler setup again.'));
    return null;
  }

  const definitions = await tempo.workAttributes().catch(() => []);
  const labels = (values, shorten = false) => values.map(({ key, value }) => {
    const definition = definitions?.find(attribute => attribute.key === key);
    const displayValue = definition?.names?.[value] ?? value;
    return shorten ? displayValue : `${definition?.name ?? key}: ${displayValue}`;
  });
  const sample = await select(t('Şablon seç', 'Choose a template'), templates.map(log => ({
    value: log,
    label: log.startDate
      ? `${displayDate(log.startDate)} · ${log.issue.key || 'Jira #' + log.issue.id} · ${formatHours(log.timeSpentSeconds)} · ${labels(log.attributes.values, true).join(' / ')}`
      : t(`Mevcut profil · ${log.issue.key || log.issue.id}`, `Current profile · ${log.issue.key || log.issue.id}`),
  })));
  if (!sample) return null;
  const attributes = sample.attributes.values.map(({ key, value }) => ({ key, value }));
  const attributeLabels = labels(attributes);
  if (attributeLabels.length) explain(attributeLabels.join(' · '));

  let issueId = sample.issue.id;
  let issueKey = sample.issue.key ?? '';
  if (jira) {
    const templateIssue = await jira.issue(issueId).catch(error => {
      if ([403, 404].includes(error.status)) return null;
      throw error;
    });
    while (true) {
      const value = await field(t('Jira iş anahtarı', 'Jira issue key'), templateIssue?.key ?? issueKey, {
        hint: t('Örnek: PROJECT-123. Şablondaki işi kullanmak için Enter’a bas.',
          'Example: PROJECT-123. Press Enter to keep the issue from the template.'),
        validate: input => /^[a-z][a-z0-9_]*-[0-9]+$/i.test(input) ? '' : t('PROJECT-123 biçiminde bir iş anahtarı gir.', 'Enter an issue key like PROJECT-123.'),
      });
      try {
        const issue = value === templateIssue?.key ? templateIssue : await jira.issue(value);
        issueId = Number(issue.id);
        if (!Number.isSafeInteger(issueId) || issueId <= 0) throw new Error(t('Jira işi doğrulanamadı.', 'The Jira issue could not be verified.'));
        issueKey = issue.key;
        break;
      } catch (error) {
        if (![403, 404].includes(error.status)) throw error;
        console.log(ui.warn(t('Bu iş bulunamadı. Anahtarı ve erişimini kontrol et.',
          'This issue could not be found. Check its key and your access.')));
      }
    }
  }
  return { sample, issueId, issueKey, attributes, attributeLabels };
}

async function schedule(previous, sample, zone) {
  section(4, t('Çalışma düzeni', 'Work schedule'),
    t('CLI, eksik efor ararken yalnızca bu iş günlerini önerir.',
      'The CLI suggests only these working days when scanning for missing worklogs.'));
  const names = weekdayNames();
  const defaultDays = previous?.days ?? [1, 2, 3, 4, 5];
  const weekdays = Array.from({ length: 7 }, (_, index) => (defaultDays[0] + index) % 7);
  const days = await select(t('Normalde hangi günler çalışırsın?', 'Which days do you normally work?'),
    weekdays.map(day => ({ value: day, label: names[day] })),
    { multiple: true, initial: weekdays.flatMap((day, index) => defaultDays.includes(day) ? [index] : []) });
  if (!days) return null;
  const firstDay = days.length === 1 ? days[0] : await select(t('Çalışma haftasının ilk günü', 'First day of your workweek'),
    days.map(day => ({ value: day, label: names[day] })));
  if (firstDay === null) return null;

  const validateTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? '' : t('24 saat biçiminde bir saat gir. Örnek: 09:30.', 'Use a 24-hour time such as 09:30.');
  const start = await field(t('Başlangıç saati', 'Start time'), previous?.start ?? sample.startTime?.slice(0, 5) ?? '09:00', {
    hint: t(`Saatleri ${zone} saat diliminde gir.`, `Enter times in your ${zone} time zone.`),
    validate: validateTime,
  });
  const [hour, minute] = start.split(':').map(Number);
  const endMinutes = Math.min(23 * 60 + 59, hour * 60 + minute + Math.round(sample.timeSpentSeconds / 60));
  const calculatedEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  const end = await field(t('Bitiş saati', 'End time'), previous?.end ?? calculatedEnd, {
    validate: value => validateTime(value) || (value <= start
      ? t('Bitiş saati başlangıçtan sonra olmalı.', 'End time must be after the start time.') : ''),
  });
  const descriptionInput = await field(t('Açıklama', 'Description'), previous?.description, {
    hint: previous?.description ? t('Temizlemek için - gir.', 'Enter - to clear it.')
      : t('İsteğe bağlı. Boş bırakmak için Enter’a bas.', 'Optional. Press Enter to leave it blank.'),
  });
  const description = previous?.description && descriptionInput === '-' ? '' : descriptionInput;
  return { days: [firstDay, ...days.filter(day => day !== firstDay)], start, end, description };
}

export async function setup(previous, language) {
  console.log(`\n${ui.title(t('Tempo Filler kurulumu', 'Set up Tempo Filler'))}`);
  explain(t('Bağlantılarını doğrula ve tekrar kullanacağın baz efor kaydını ayarla.',
    'Verify your connections and configure a worklog to reuse.'),
  t('Kurulum sırasında efor kaydı gönderilmez. Çıkmak için Ctrl+C.',
    'Setup does not submit worklogs. Press Ctrl+C to exit.'));

  section(1, t('Kullanım şekli ve Tempo bağlantısı', 'Usage and Tempo connection'));
  const modes = [
    { label: t('Önizle ve onayla kaydet · Tempo + Atlassian', 'Preview and submit · Tempo + Atlassian'), value: true },
    { label: t('Yalnızca önizle · Tempo', 'Preview only · Tempo'), value: false },
  ];
  if (previous && !previous.email) modes.reverse();
  const write = await select(t('Tempo Filler’ı nasıl kullanacaksın?', 'How will you use Tempo Filler?'), modes);
  if (write === null) return null;
  const replace = previous ? await select(t('Kayıtlı token’lar', 'Saved tokens'), [
    { label: t('Mevcut token’ları kullan', 'Keep existing tokens'), value: false },
    { label: t('Yeni token gir', 'Enter new tokens'), value: true },
  ]) : false;
  if (replace === null) return null;
  const zone = await field(t('Saat dilimi', 'Time zone'), previous?.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, {
    hint: t('Haftanın günlerini ve bugün ve yarının tarihini belirlemek için kullanılır. Örnek: Europe/Istanbul.',
      'Used for your workweek and for today and tomorrow. Example: Europe/Istanbul.').replace('yaran', 'yarın'),
    validate: value => {
      try { dateAtZone(value); return ''; } catch { return t('Geçerli bir saat dilimi gir. Örnek: Europe/Istanbul.', 'Enter a valid time zone, such as Europe/Istanbul.'); }
    },
  });
  const day = dateAtZone(zone).date;
  const connection = await connectTempo(day, write, replace);
  if (!connection) return null;
  const { tempo, visible, token: tempoToken } = connection;

  let site = '';
  let email = '';
  let jira;
  let jiraToken;
  let accountId;
  if (write) {
    section(2, t('Jira bağlantısı', 'Jira connection'));
    const connection = await connectJira(previous, replace);
    if (!connection) return null;
    ({ jira, site, email, accountId, token: jiraToken } = connection);
  } else {
    section(2, t('Tempo hesabın', 'Your Tempo account'),
      t('Yalnızca kendi kayıtlarının gösterilmesi için Atlassian hesap kimliğin gerekir.',
        'Your Atlassian account ID ensures the CLI shows only your worklogs.'));
    const accounts = [...new Set(visible.map(log => log.author?.accountId).filter(Boolean))];
    const proposed = previous?.accountId ?? (accounts.length === 1 ? accounts[0] : '');
    accountId = await field(t('Atlassian hesap kimliği', 'Atlassian account ID'), proposed, {
      hint: proposed ? t('Önerilen kimliği yalnızca senin hesabına aitse kullan.', 'Use the suggested ID only if it belongs to your account.')
        : t('Jira profilini aç ve adresin sonundaki hesap kimliğini kopyala.',
          'Open your Jira profile and copy the account ID at the end of the URL.'),
      validate: value => value ? '' : t('Hesap kimliği gerekli.', 'An account ID is required.'),
    });
  }
  const work = await workProfile(tempo, jira, accountId, previous, day);
  if (!work) return null;
  const { sample, ...base } = work;
  const hours = await schedule(previous, sample, zone);
  if (!hours) return null;

  const profile = { ...base, ...hours, language, zone, site, email, accountId };
  const names = weekdayNames();
  console.log(`\n${ui.title(t('Profil özeti', 'Review your profile'))}`);
  console.log(`  ${profile.issueKey || 'Jira #' + profile.issueId} · ${profile.start}–${profile.end} · ${formatHours(duration(profile.start, profile.end))} · ${zone}`);
  console.log(`  ${profile.days.map(day => names[day]).join(', ')}`);
  if (profile.attributeLabels.length) explain(profile.attributeLabels.join(' · '));
  explain(`${t('Açıklama', 'Description')}: ${profile.description || t('boş', 'empty')}`);
  const save = await select(t('Bu profili kaydet?', 'Save this profile?'), [
    { label: t('Kaydet ve devam et', 'Save and continue'), value: true },
    { label: t('Kaydetmeden çık', 'Exit without saving'), value: false },
  ]);
  if (!save) return null;

  await saveProfile(profile);
  for (const [name, token] of [['TEMPO_API_TOKEN', tempoToken], ['JIRA_API_TOKEN', jiraToken]]) {
    if (token?.fresh && !saveToken(name, token.value)) {
      explain(t(`${name} güvenli depoya kaydedilemedi. Sonraki açılışta yeniden girilebilir.`,
        `${name} could not be saved securely. You can enter it again next time.`));
    }
  }
  console.log(ui.ok(t('✓ Profil kaydedildi.', '✓ Profile saved.')));
  explain(t('Başka zaman düzenlemek için npx tempo-filler setup çalıştır.',
    'Run npx tempo-filler setup to edit this profile later.'));
  return { profile, tempo, jira };
}
