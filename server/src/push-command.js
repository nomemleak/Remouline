// One-shot push command: no remote, no alias, no config change on the user's side.
// REPO_NAME is derived at run time from the repository's own "origin" remote, so the
// same command works for every assignment; only the login is personalized.
// HTTPS only: Git over HTTPS is the one thing Gitea exposes through the tunnel.
import { config } from './config.js';

const REPO_EXPR = '$(basename -s .git "$(git remote get-url origin)")';

export function pushCommand(login) {
  return `git push "${config.giteaPublicUrl}/${login}/${REPO_EXPR}.git" HEAD:main`;
}
