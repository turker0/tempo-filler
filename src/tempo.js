import { t } from './ui.js';

export class ApiError extends Error {
  constructor(service, status) {
    super(status ? t(`${service} isteği başarısız (HTTP ${status}).`, `${service} request failed (HTTP ${status}).`) : t(`${service} yanıtı alınamadı.`, `No response received from ${service}.`));
    this.status = status;
  }
}

async function request(url, authorization, service, body) {
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    if (!response.ok) throw new ApiError(service, response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(service);
  }
}

export function tempoClient(token) {
  const call = (path, body) => request(`https://api.tempo.io/4/${path}`, `Bearer ${token}`, 'Tempo', body);
  async function worklogs(account, from, to, { firstPage = false } = {}) {
    const path = account ? `worklogs/user/${encodeURIComponent(account)}` : 'worklogs';
    const results = [];
    let offset = 0;
    while (true) {
      const query = new URLSearchParams({ from, to, offset, limit: '100' });
      const page = await call(`${path}?${query}`);
      if (!Array.isArray(page.results) || !page.metadata) throw new Error(t('Tempo kayıt listesi doğrulanamadı.', 'The Tempo worklog list could not be verified.'));
      results.push(...page.results);
      if (firstPage || !page.metadata.next) return results;
      if (!page.results.length) throw new Error(t('Tempo kayıt listesi eksik.', 'The Tempo worklog list is incomplete.'));
      offset += page.results.length;
    }
  }
  return {
    worklogs,
    workAttributes: async () => (await call('work-attributes')).results,
    create: body => call('worklogs', body),
  };
}

export function jiraClient(site, email, token) {
  if (!/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/i.test(site)) throw new Error(t('Jira adresi ornek.atlassian.net biçiminde olmalı.', 'Enter a Jira site in the form example.atlassian.net.'));
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const call = path => request(`https://${site}/rest/api/3/${path}`, `Basic ${auth}`, 'Jira');
  return {
    myself: () => call('myself'),
    issue: id => call(`issue/${encodeURIComponent(id)}?fields=timetracking`),
  };
}
