# Tempo Filler

A dependency-free CLI for reviewing and filling missing worklogs in Tempo Timesheets for Jira Cloud. Available in English and Türkçe.

## Quick start

Requires Node.js 22 or later.

```sh
npx tempo-filler@latest
```

On the first run, choose a language and follow the setup prompts. Later runs show missing workdays from the last 30 calendar days.

## Connect your accounts

1. Choose **Preview only** or **Preview and submit**. Setup reads existing records and saves a local profile.
2. In the Tempo app, open **Settings → Data Access → API Integration**. Create a token with **Worklogs → View Access** for previews or **Worklogs → Manage Access** for submitting. Paste it into the hidden terminal prompt. [Tempo API integration guide](https://help.tempo.io/timesheets/latest/using-rest-api-integrations)
3. For submitting, enter your Jira site URL and the Atlassian email that created the token. Choose **Create API token** on the Atlassian token page. This CLI connects directly to your Jira site, so use a token without scopes. The Jira connection verifies your identity and reads the issue’s current remaining estimate. Preview-only users enter their Atlassian account ID instead. [Create an Atlassian token](https://id.atlassian.com/manage-profile/security/api-tokens) · [Atlassian token guide](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/)
4. Pick a worklog from the last 60 days to reuse its Jira issue and Tempo fields. Set your working days, week start, hours, and optional description. Review the profile before saving. If there’s no template, add one worklog in Tempo and run setup again.

The profile is stored in `~/.config/tempo-filler/profile.json`, or under `XDG_CONFIG_HOME` if configured. On macOS, the CLI uses Keychain for tokens when available. Elsewhere it prompts again as needed. It also accepts `TEMPO_API_TOKEN` and `JIRA_API_TOKEN` environment variables.

## Review and submit

Select missing days or jump to **Today**, **Tomorrow**, **Yesterday**, **This whole week**, **Last whole week**, or a specific date.

- Use **↑ / ↓** to move, **Space** to toggle dates, **Enter** to continue, and **Esc** to go back. Use `NO_COLOR=1` to disable color or `TERM=dumb` for numbered menus.
- Days with existing worklogs and days outside your schedule are skipped. Deselect any holidays or leave. Upcoming dates and shifts still in progress are marked in the review.
- Review the selected dates and total hours before confirming. The CLI rechecks each date before submitting and stops if it can’t read the Jira remaining estimate.

| Command | What it does |
| --- | --- |
| `npx tempo-filler@latest` | Start setup or open the missing-days summary |
| `npx tempo-filler@latest setup` | Edit language, tokens, or the work profile |
| `npx tempo-filler@latest --dry-run` | Preview the last 30 days without submitting |
| `npx tempo-filler@latest --last-week` | Open last week |
| `npx tempo-filler@latest --week 2026-11-15 --dry-run` | Preview the week containing that date |

## Türkçe hızlı başlangıç

`npx tempo-filler@latest` ile başlatıp **Türkçe** seç. Kurulum, gereken token’ların nereden alınacağını terminalde gösterir. Baz kaydı bir kez kaydettikten sonra CLI son 30 gündeki eksik iş günlerini listeler. Ok tuşlarıyla gezin, **Space** ile günleri seç ve **Enter** ile son onaya geç. Ayarları değiştirmek için `npx tempo-filler@latest setup` çalıştır.

## Local development

```sh
node src/cli.js --help
npm test
npm pack --dry-run
```
