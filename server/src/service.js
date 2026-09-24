// Emergency pause ("kill switch"), set by an operator from the admin panel. While
// paused: new pushes are not graded (the webhook ignores them), queued jobs wait,
// invitation links cannot be used, and every page shows the pause message.
import { getSetting, setSetting, logActivity } from './db.js';

const DEFAULT_MESSAGE = 'The service is paused. Pushes are not graded for now.';

export function getServiceState() {
  const paused = getSetting('service_paused', '0') === '1';
  return { paused, message: paused ? getSetting('pause_message', '') || DEFAULT_MESSAGE : null };
}

export function setServicePaused(paused, message, operator) {
  setSetting('service_paused', paused ? '1' : '0');
  setSetting('pause_message', String(message ?? '').trim().slice(0, 500));
  logActivity('admin_action', { student: operator, detail: paused ? 'service PAUSED' : 'service resumed' });
}

export const isPaused = () => getSetting('service_paused', '0') === '1';
