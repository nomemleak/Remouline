#!/usr/bin/env bash
# Nightly backup of what must survive a VM loss: Gitea (repositories + its DB),
# the Remouline SQLite database and the assignments (tests + headers).
# The archive is pushed OFF the VM with rclone, through an ENCRYPTED "crypt" remote
# (the storage provider can never read it). Configure it once with `rclone config`:
# see docs/DEPLOYMENT.md > Backups.
#
# Cron (as root):  30 3 * * * /opt/remouline/scripts/backup.sh >> /var/log/remouline-backup.log 2>&1
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/remouline}"
# BACKUP_RETENTION_DAYS and the storage paths come from the instance's .env.
if [ -f "$REPO_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . <(grep -E '^(REMOULINE_DATA|GITEA_DATA|BACKUP_RETENTION_DAYS)=' "$REPO_DIR/.env")
  set +a
fi
DATA_DIR="${REMOULINE_DATA:-/srv/remouline/data}"
GITEA_DIR="${GITEA_DATA:-/srv/remouline/gitea}"
LOCAL_DIR="${BACKUP_LOCAL_DIR:-/srv/remouline/backups}"
REMOTE="${RCLONE_REMOTE:-offsite-crypt:}"   # rclone remote:path (a "crypt" remote)
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-3}"
KEEP_REMOTE_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Refuse to send plain archives to a third party.
REMOTE_NAME="${REMOTE%%:*}"
REMOTE_TYPE="$(rclone listremotes --long | awk -v n="$REMOTE_NAME:" '$1 == n { print $2 }')"
if [ "$REMOTE_TYPE" != "crypt" ] && [ "${BACKUP_ALLOW_UNENCRYPTED:-0}" != "1" ]; then
  echo "[$(date -Is)] refusing to upload: rclone remote '$REMOTE_NAME' is '${REMOTE_TYPE:-missing}', not 'crypt'" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$LOCAL_DIR/$STAMP"
mkdir -p "$WORK"
chmod 700 "$LOCAL_DIR"
cd "$REPO_DIR"

echo "[$(date -Is)] backup $STAMP starting"

# 1. Remouline database: online, consistent copy (safe while services run).
sqlite3 "$DATA_DIR/remouline.db" ".backup '$WORK/remouline.db'"

# 2. Assignments (published tests, staging tests, headers).
tar -C "$DATA_DIR" -czf "$WORK/assignments.tar.gz" assignments

# 3. Gitea: official dump (repositories + database + config), written inside its volume.
docker compose exec -T -u git gitea gitea dump \
  --config /data/gitea/conf/app.ini --type tar.gz --file "/data/gitea-dump-$STAMP.tar.gz" --skip-log >/dev/null
mv "$GITEA_DIR/gitea-dump-$STAMP.tar.gz" "$WORK/"

# 4. One archive, then off the VM (encrypted by the crypt remote).
tar -C "$LOCAL_DIR" -cf "$LOCAL_DIR/remouline-$STAMP.tar" "$STAMP"
rm -rf "$WORK"
rclone copy "$LOCAL_DIR/remouline-$STAMP.tar" "$REMOTE" --transfers 1
echo "[$(date -Is)] uploaded remouline-$STAMP.tar to $REMOTE"

# 5. Retention (also announced in the privacy notice).
find "$LOCAL_DIR" -maxdepth 1 -name 'remouline-*.tar' -mtime +"$KEEP_LOCAL_DAYS" -delete
rclone delete "$REMOTE" --min-age "${KEEP_REMOTE_DAYS}d" --include 'remouline-*.tar'
echo "[$(date -Is)] backup $STAMP done"
