import { ApiError } from '@/lib/api';

/** Friendly rendering of API failures inside a page. */
export function ErrorState({ error }: { error: unknown }) {
  let message = 'The results server is unreachable right now. Try again in a minute.';
  if (error instanceof ApiError) {
    if (error.status === 403) message = 'Your account is disabled. Contact the administrator.';
    else if (error.status === 404) message = 'Not found.';
    else message = error.message;
  }
  return <div className="notice error">{message}</div>;
}
