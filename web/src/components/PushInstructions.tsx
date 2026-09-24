import { CommandBox } from './CopyButton';
import { IconAlert, IconTerminal } from './Icons';

export function PushInstructions({ command, paused = false }: { command: string; paused?: boolean }) {
  return (
    <section className="card stack">
      <h3 className="row"><IconTerminal /> Test your code</h3>
      {paused ? <div className="notice error small">The service is paused: pushes are not graded for now.</div> : null}
      <p className="small muted">
        Paste this single command in a terminal, <strong>inside your assignment repository</strong>. It pushes your current
        commit once to this server, without touching your repository&apos;s configuration: your next normal{' '}
        <code>git push</code> still goes to your usual remote only.
      </p>
      <CommandBox command={command} />
      <p className="small faint">
        Git asks for your login and password: the same ones as for this dashboard. Only committed changes are sent. Results
        appear on this page within a minute.
      </p>
      <p className="small row" style={{ alignItems: 'start', color: 'var(--c-warn)' }}>
        <IconAlert />
        <span>
          Only push code you wrote and are allowed to share with this server. If this is coursework, check first that the rules
          of your school or course allow it. Results are indicative, not a grade.
        </span>
      </p>
    </section>
  );
}
