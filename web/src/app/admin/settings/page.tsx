import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import { ErrorState } from '@/components/ErrorState';
import { ContactForm, PageEditor, PauseSwitch } from './SettingsControls';

export const metadata = { title: 'Settings' };

type Settings = {
  service: { paused: boolean; message: string | null };
  contact: string;
  termsVersion: number;
  pages: { terms: string; privacy: string; legal: string };
  retention: { dataDays: number; accountDays: number; logDays: number; backupDays: number };
};

export default async function SettingsPage() {
  const admin = await requireStaff('operator');
  let data: Settings;
  try {
    data = await adminApi<Settings>(admin.login, '/settings');
  } catch (error) {
    return <ErrorState error={error} />;
  }
  const r = data.retention;
  return (
    <div className="stack-lg">
      <h1>Settings</h1>
      <PauseSwitch paused={data.service.paused} message={data.service.message ?? ''} />
      <ContactForm contact={data.contact} />
      <section className="card stack">
        <h3>Data retention</h3>
        <p className="small muted">
          Set in the server&apos;s <code>.env</code>, applied automatically every few hours:
        </p>
        <ul className="small" style={{ margin: 0, paddingLeft: 'var(--s-5)' }}>
          <li>pushes and results (after the push) and Git repositories (without a push): <strong>{r.dataDays || 'never'}</strong>{r.dataDays ? ' days' : ''} (<code>DATA_RETENTION_DAYS</code>);</li>
          <li>student accounts without login or push: <strong>{r.accountDays || 'never'}</strong>{r.accountDays ? ' days' : ''} (<code>ACCOUNT_RETENTION_DAYS</code>);</li>
          <li>logs, used links, closed reports: <strong>{r.logDays || 'never'}</strong>{r.logDays ? ' days' : ''} (<code>LOG_RETENTION_DAYS</code>);</li>
          <li>encrypted backups: <strong>{r.backupDays}</strong> days (<code>BACKUP_RETENTION_DAYS</code>).</li>
        </ul>
      </section>
      <section className="stack">
        <h2>Pages shown to users</h2>
        <p className="small muted">
          Markdown subset: <code>#</code> headings, <code>- </code> lists, <code>**bold**</code>, <code>`code`</code>. Placeholders:{' '}
          <code>{'{{APP}}'}</code>, <code>{'{{CONTACT}}'}</code>, <code>{'{{DATA_DAYS}}'}</code>, <code>{'{{ACCOUNT_DAYS}}'}</code>,{' '}
          <code>{'{{LOG_DAYS}}'}</code>, <code>{'{{BACKUP_DAYS}}'}</code>. Saving the terms of use creates a new version (currently{' '}
          {data.termsVersion}): every user must accept it again at their next visit.
        </p>
        <PageEditor name="terms" title="Terms of use" text={data.pages.terms} />
        <PageEditor name="privacy" title="Privacy notice" text={data.pages.privacy} />
        <PageEditor name="legal" title="Legal notice" text={data.pages.legal} />
      </section>
    </div>
  );
}
