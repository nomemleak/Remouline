// Single-use links (invitations, password resets): random tokens, stored ONLY as a
// SHA-256 hash.
import crypto from 'node:crypto';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const randomToken = () => crypto.randomBytes(24).toString('base64url');
