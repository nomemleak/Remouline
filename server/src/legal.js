// Terms of use, privacy notice and legal notice shown to users, plus the statement a
// maintainer accepts at every testsuite import. The operator edits the three pages
// in Admin > Settings; these defaults apply until then. Placeholders replaced at read
// time: {{APP}}, {{CONTACT}}, {{DATA_DAYS}}, {{ACCOUNT_DAYS}}, {{LOG_DAYS}}, {{BACKUP_DAYS}}.
import { config } from './config.js';
import { getSetting, setSetting, logActivity } from './db.js';

export const PAGES = ['terms', 'privacy', 'legal'];

const DEFAULTS = {
  terms: `# Terms of use

{{APP}} is an independent, non-commercial service that automatically tests C code pushed by its users. It is run by private individuals and is available on invitation only.

## Your responsibility

- You are solely responsible for the code you push and for the way you use the results.
- Only push code you wrote yourself or have the right to share with this server.
- Before pushing code written for a course, check the rules of your school or institution: some forbid sending coursework to third-party servers. Respecting them is your responsibility.
- Follow the academic integrity rules that apply to you. Results are for self-assessment only: never present them as an official grade, and never use the service to copy or share solutions.

## No guarantee

- The service is provided "as is", without any guarantee of availability, accuracy or continuity. Results are indicative and may be wrong.
- The service is independent: it is not affiliated with, endorsed by or connected to any school, course or official grading system.
- The service may be paused, a testsuite removed or an account closed at any time.

## Your account

- Keep your password to yourself. You can change it, export your data or delete your account at any time from the Account page.
- Accounts and data are deleted automatically after a period of inactivity (see the privacy notice).

## Testsuites

Testsuites are imported by maintainers, who confirm that they have the right to use the material they are derived from. To request the removal of a testsuite, write to: {{CONTACT}}.

## Changes

These terms may change. You will be asked to accept the new version before using the service again.`,

  privacy: `# Privacy notice

What is stored, where, for how long, and who can see it.

## Data

- Account: login, optional email address, creation and last login dates, the version of the terms you accepted. Your password is stored hashed by the Git server, never in plain text.
- The code you push, in your private Git repository on this server.
- The results of each push: test results and build logs.
- The reports and votes you post about tests. Other users never see who posted them.
- Technical logs, used to run and secure the service.

No tracking, no analytics, no advertising: the only cookie is the session cookie.

## Where

Everything is stored on the operator's own server. Traffic goes through Cloudflare (network provider). Nothing is sold or shared with anyone else.

## Who can see it

- Only you see your code and your results.
- The operator can see accounts and results, to run the service and help you.
- Maintainers, who write the tests, never see who you are: they only see anonymous reports and totals.

## How long

- Pushes and their results: deleted {{DATA_DAYS}} days after the push. Repositories: deleted after {{DATA_DAYS}} days without a push.
- Accounts: deleted with all their data after {{ACCOUNT_DAYS}} days without any login or push.
- Technical logs: {{LOG_DAYS}} days.
- Deleted data can remain in encrypted backups for up to {{BACKUP_DAYS}} days.

## Your rights

From the Account page you can export all your data and delete your account at any time. Deletion is immediate and includes your repositories. For any other request (access, correction, objection), write to: {{CONTACT}}. You can also lodge a complaint with your data protection authority.`,

  legal: `# Legal notice

{{APP}} is a private, non-commercial, invitation-only service. It is not affiliated with any school, course or official grading system.

- Contact: {{CONTACT}}
- Hosting: the operator's own server.
- Network provider: Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA.`,
};

// Accepted by the maintainer at every import; recorded (pseudonymous login, version).
export const ATTESTATION_VERSION = 1;
export const ATTESTATION_TEXT =
  'I confirm that I have the right to use the material these tests are derived from, and that this ' +
  'testsuite contains neither a solution nor a copy of that material (subject text, statements).';

function fill(text) {
  const contact = getSetting('contact', '') || 'the operator (contact not set yet)';
  const values = {
    APP: config.appName,
    CONTACT: contact,
    DATA_DAYS: String(config.dataRetentionDays),
    ACCOUNT_DAYS: String(config.accountRetentionDays),
    LOG_DAYS: String(config.logRetentionDays),
    BACKUP_DAYS: String(config.backupRetentionDays),
  };
  return text.replace(/\{\{(APP|CONTACT|DATA_DAYS|ACCOUNT_DAYS|LOG_DAYS|BACKUP_DAYS)\}\}/g, (_, key) => values[key]);
}

export function getTermsVersion() {
  return Number.parseInt(getSetting('terms_version', '1'), 10) || 1;
}

/** Raw page (as edited by the operator, placeholders kept). */
export function getPageSource(name) {
  return getSetting(`page_${name}`, null) ?? DEFAULTS[name];
}

/** Page shown to users (placeholders replaced). */
export function getPage(name) {
  if (!PAGES.includes(name)) return null;
  return { name, text: fill(getPageSource(name)), termsVersion: getTermsVersion() };
}

/**
 * Saves a page. Changing the terms bumps their version: every user must accept the
 * new version at their next visit. `reset` restores the default text.
 */
export function savePage(name, text, operator, { reset = false } = {}) {
  if (!PAGES.includes(name)) throw Object.assign(new Error('Unknown page.'), { status: 404 });
  const next = reset ? DEFAULTS[name] : String(text ?? '').trim();
  if (next.length < 20) throw Object.assign(new Error('The page is too short.'), { status: 400 });
  if (next.length > 50_000) throw Object.assign(new Error('The page is too long.'), { status: 400 });
  if (next === getPageSource(name)) return getTermsVersion();
  setSetting(`page_${name}`, next);
  if (name === 'terms') setSetting('terms_version', getTermsVersion() + 1);
  logActivity('admin_action', { student: operator, detail: `${name} page updated${name === 'terms' ? ` (terms version ${getTermsVersion()})` : ''}` });
  return getTermsVersion();
}

export function getContact() {
  return getSetting('contact', '');
}

export function setContact(value, operator) {
  const contact = String(value ?? '').trim();
  if (contact.length > 200) throw Object.assign(new Error('Contact too long.'), { status: 400 });
  setSetting('contact', contact);
  logActivity('admin_action', { student: operator, detail: 'contact updated' });
}
