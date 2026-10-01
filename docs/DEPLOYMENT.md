# Deployment guide

From an empty Linux VM to a working instance. Everything runs with Docker Compose on one machine;
the only way in from the Internet is an outbound Cloudflare Tunnel.

Replace `example.com` with your domain everywhere. Commands run on the VM unless stated otherwise.

## 0. Requirements

- A VM with **2 vCPU, 4 GB RAM, 30 GB disk**, Debian 12 or Ubuntu 24.04, reachable over SSH.
  Keep it separate from your other services: it runs untrusted code (sandboxed, but still).
- A domain managed by **Cloudflare** (free plan), for two hostnames:
  - `app.example.com`: the dashboard;
  - `git.example.com`: Git over HTTPS.
- A backup destination for `rclone`: another machine over SFTP, a NAS, or object storage (B2, S3...).

Pick neutral names for the instance (`APP_NAME`), the hostnames and the operator login: they are
what users see.

## 1. System

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git sqlite3 rclone ufw
```

Docker Engine and the Compose plugin, from Docker's repository (Debian shown; for Ubuntu replace
`debian` with `ubuntu`):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Rotate Docker logs by default:

```bash
printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Firewall: nothing needs to be reachable from outside (the tunnel is outbound). Allow SSH from your
local network only, e.g.:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp
sudo ufw enable
```

Log out and back in (for the `docker` group), then check with `docker run --rm hello-world`.

Some recent kernels make AddressSanitizer loop on `DEADLYSIGNAL`; if so:

```bash
echo 'vm.mmap_rnd_bits=28' | sudo tee /etc/sysctl.d/99-asan.conf && sudo sysctl --system
```

## 2. Code, data folders, `.env`

```bash
sudo mkdir -p /opt/remouline && sudo chown "$USER": /opt/remouline
git clone <repository URL> /opt/remouline && cd /opt/remouline
sudo mkdir -p /srv/remouline/{data,gitea,redis,jobs,backups}
sudo chown -R 1000:1000 /srv/remouline/gitea
cp .env.example .env && chmod 600 .env
```

Give the job folder (where user code runs) its own small filesystem, so a program writing
without end can only fill that one, never the VM's disk:

```bash
sudo fallocate -l 4G /srv/remouline/jobs.img
sudo mkfs.ext4 -q /srv/remouline/jobs.img
echo '/srv/remouline/jobs.img /srv/remouline/jobs ext4 loop,nodev,nosuid 0 0' | sudo tee -a /etc/fstab
sudo mount /srv/remouline/jobs
```

Generate the secrets:

```bash
for n in GITEA_WEBHOOK_SECRET API_TOKEN ADMIN_API_TOKEN; do echo "$n=$(openssl rand -hex 32)"; done
echo "NEXTAUTH_SECRET=$(openssl rand -base64 48)"
```

Edit `.env` (`nano .env`):

- `APP_NAME`, `TIMEZONE`;
- `APP_DOMAIN=app.example.com`, `GITEA_DOMAIN=git.example.com`, `GITEA_PUBLIC_URL=https://git.example.com`;
- the four generated secrets;
- `OPERATOR_LOGINS`: the login of your operator account (created in step 5), e.g. `operator`;
- the retention periods if the defaults do not suit you;
- leave `GITEA_ADMIN_TOKEN` and `GITEA_CLONE_TOKEN` empty for now (step 5).

## 3. Build and start Gitea

```bash
docker compose build                                   # backend + dashboard
docker compose --profile build-only build runner       # correction image (gcc, Criterion, valgrind)
docker compose up -d gitea redis
```

Gitea is fully configured by `docker-compose.yml` (no install wizard): no sign-up, private accounts
and repositories, no user list, no mail, push-to-create, webhooks only to the internal `webhook`
service. Its web UI is bound to the VM's loopback only; if you ever need it, use an SSH tunnel from
your computer (`ssh -L 3000:127.0.0.1:3000 <vm>`, then `http://localhost:3000`).

## 4. Cloudflare Tunnel

Two options. Either way, only two hostnames are exposed, and on `git.` only the Git protocol.

### Option A: a tunnel dedicated to this VM (default)

Keep `COMPOSE_PROFILES=tunnel` in `.env`. Install `cloudflared` on the VM (only to create the
tunnel; it then runs in a container):

```bash
curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared tunnel login                      # open the URL, pick your domain
cloudflared tunnel create remouline           # prints the tunnel UUID
cp ~/.cloudflared/<UUID>.json tunnel/credentials.json && chmod 644 tunnel/credentials.json
cloudflared tunnel route dns remouline app.example.com
cloudflared tunnel route dns remouline git.example.com
cp tunnel/config.yml.example tunnel/config.yml && nano tunnel/config.yml
```

In `tunnel/config.yml`, set the UUID and the two hostnames. Keep the `path:` rule on the Git
hostname: it only lets the Git protocol through, so Gitea's web UI and API are never exposed.

In the Cloudflare dashboard, for your domain:

- **Security > Bots**: turn **Bot Fight Mode off** (it challenges `git` clients, which then fail
  without a clear message);
- **SSL/TLS > Edge Certificates**: **Always Use HTTPS** on;
- **Security > WAF > Rate limiting rules**: one rule, `URI Path` contains `.git/`, counted per IP,
  30 requests per 10 seconds, action *Block* for 10 seconds (what the free plan allows). The
  dashboard limits failed logins itself, but Git over HTTPS checks passwords directly in Gitea,
  which has no limit: this caps password guessing through Git to a few attempts per second. Users
  behind one shared address (a school network) share the counter: raise the threshold if needed.

On the free plan, Cloudflare refuses request bodies over 100 MB: a single push cannot be larger.

`tunnel/` stays on the VM and is never committed.

### Option B: a cloudflared you already run elsewhere

For example one `cloudflared` in a container or LXC that serves all your machines. In `.env`:

```
COMPOSE_PROFILES=
WEB_PUBLISH=<vm-ip>:3080
GITEA_PUBLISH=<vm-ip>:3001
```

In Cloudflare Zero Trust > Networks > Tunnels > your tunnel > Public hostnames:

| Hostname | Path | Service |
| --- | --- | --- |
| `app.example.com` | (empty) | `http://<vm-ip>:3080` |
| `git.example.com` | `^/[^/]+/[^/]+\.git/(info/refs\|git-upload-pack\|git-receive-pack)$` | `http://<vm-ip>:3001` |

**Do not** add a rule for `git.example.com` without the path: that would expose Gitea's web UI.

Then allow those two ports **only from the cloudflared host**. Docker-published ports bypass `ufw`,
so filter before Docker: in your hypervisor's firewall (e.g. the Proxmox firewall of the VM), or
with rules in the `DOCKER-USER` chain:

```bash
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 3080 ! -s <cloudflared-ip> -j DROP
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 3001 ! -s <cloudflared-ip> -j DROP
```

(make them persistent, e.g. with `iptables-persistent`).

### Cloudflare settings (both options)

## 5. Accounts and tokens

**Service account** (a Gitea admin used only through its tokens, never to log in):

```bash
docker compose exec -u git gitea gitea admin user create --admin --username remouline-bot --email bot@noreply.localhost --random-password --must-change-password=false
docker compose exec -u git gitea gitea admin user generate-access-token --username remouline-bot --token-name admin --scopes write:admin,write:user,write:repository --raw
docker compose exec -u git gitea gitea admin user generate-access-token --username remouline-bot --token-name clone --scopes read:repository --raw
```

Put the two tokens in `.env`: `GITEA_ADMIN_TOKEN` (first) and `GITEA_CLONE_TOKEN` (second).

**Operator account** (you), with the login listed in `OPERATOR_LOGINS`:

```bash
docker compose exec -u git gitea gitea admin user create --username operator --email operator@noreply.localhost --password '<a long password>' --must-change-password=false
```

It is a regular account, not a Gitea admin. Do not enable Gitea's two-factor authentication on
accounts that log into the dashboard: the dashboard checks passwords through Gitea's API, which
would then refuse them. Use a long, unique password (and see *Hardening* below).

Start everything and create the system webhook:

```bash
docker compose up -d
docker compose run --rm api node src/scripts/setup-gitea.js
docker compose ps          # gitea, redis, api, webhook, worker, web (+ cloudflared with option A): Up
```

Checks from any computer:

- `https://app.example.com` shows the login page;
- `https://git.example.com` answers **404** (the web UI is not exposed): expected.

## 6. First login and settings

1. Log in at `https://app.example.com` with the operator account and accept the terms of use.
2. **Admin > Settings**:
   - set the **contact** shown in the terms, privacy and legal pages (a dedicated address);
   - review the three pages. They are defaults for an independent, non-commercial instance:
     adapt them to your situation. Changing the terms makes every user accept the new version.
3. **Admin > Maintainers > New maintainer link**: invite whoever will import testsuites (possibly
   yourself, with a second, pseudonymous account). Open the link in a private window, choose a
   password, accept the terms.
4. **Admin > Access**: `closed` (only operators invite) or `sharing` (students can invite a limited
   number of people).

## 7. End-to-end test

1. As the **maintainer**: *New assignment*, slug `DemoMission` → *Tests & publishing* → upload
   `examples/DemoMission/bundle.txt` (or paste it) → confirm the attestation → *Import*. The
   validation passes in about a minute → *Publish*.
2. As the **operator**: *Admin > Students > Invite > One person*, login `test.student` → open the
   link in a private window, choose a password.
3. On any machine with Git, a fake repository:

   ```bash
   mkdir c-course-test && cd c-course-test && git init -b main
   cp -r <repo>/examples/DemoMission/correct DemoMission && echo "*.o" > .gitignore
   git remote add origin https://example.org/c-course-test.git
   git add . && git commit -m demo
   ```

4. As `test.student`, open *Demo mission* on the dashboard, copy the command and run it in that
   folder (Git asks for the same login and password). The result appears within a minute: 11 / 11.
5. Replace `DemoMission/Fundamentals/add_numbers.c` with the one from `examples/DemoMission/broken`,
   commit, push again: the failing tests show expected vs actual values.
6. Follow a job on the VM with `docker compose logs -f worker`; logs are also in *Admin > Logs*.

## 8. Backups (encrypted)

`scripts/backup.sh` backs up the Gitea dump, the database and the assignments, and refuses to upload
anything except through an rclone **crypt** remote.

```bash
sudo rclone config
```

1. Create the storage remote, e.g. `offsite` (`sftp`, `b2`, `s3`...).
2. Create a second remote `offsite-crypt`, type **crypt**, remote `offsite:remouline-backups`,
   with a generated password and salt. **Keep both in your password manager**: without them the
   backups cannot be read, by anyone.

```bash
sudo /opt/remouline/scripts/backup.sh          # last line: "backup ... done"
echo '30 3 * * * root /opt/remouline/scripts/backup.sh >> /var/log/remouline-backup.log 2>&1' | sudo tee /etc/cron.d/remouline-backup
```

Retention: 3 days on the VM, `BACKUP_RETENTION_DAYS` on the destination (announced in the privacy
notice). To restore: redo steps 1-4, put `remouline.db` and `assignments/` back in
`/srv/remouline/data/`, and restore the Gitea dump with Gitea's *Backup and Restore* procedure.

## 9. Operating

- **Update**: `cd /opt/remouline && git pull && docker compose build && docker compose --profile build-only build runner && docker compose up -d`.
- **Logs**: `docker compose logs -f worker` (or `api`, `webhook`, `web`, `gitea`, `cloudflared`), or
  *Admin > Logs* (kept `LOG_RETENTION_DAYS`).
- **Emergency pause**: *Admin > Settings > Pause the service*. Grading and invitations stop at once
  and every page shows your message. For a complete stop: `docker compose stop web gitea` (nothing is reachable any more).
- **Removal requests**: unpublish or delete the assignment (*Unpublish* / *Delete* on its page).
- **Lost password**: *Admin > Students* (or *Maintainers*) > the account > *Password reset link*.
- **More throughput**: raise `WORKER_CONCURRENCY` (keep `WORKER_CONCURRENCY × CONTAINER_CPUS` ≤ vCPUs)
  or `docker compose up -d --scale worker=2`.

## Hardening (optional)

- **Protect the admin panel with Cloudflare Access**: a self-hosted application on
  `app.example.com/admin` and `app.example.com/api/admin` with an allow policy for your operators and
  maintainers (email one-time PIN, or an IP list). Students are not affected.
- Keep the VM on its own network segment, and update it regularly (`unattended-upgrades`).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Login page: "The service is unreachable" | `api` not running (`docker compose ps`, `docker compose logs api`). |
| 401 errors in `docker compose logs api` | `API_TOKEN` / `ADMIN_API_TOKEN` changed without restarting `web` (`docker compose up -d`). |
| "Wrong login or password" for a valid account | The account has two-factor authentication enabled in Gitea, or was disabled by an operator. |
| `git push` fails with a Cloudflare challenge or 403 | Bot Fight Mode is on. |
| A push is accepted but no submission appears | System webhook missing or failing: rerun `setup-gitea.js`; if `GITEA_WEBHOOK_SECRET` changed, delete the old webhook through Gitea's UI (SSH tunnel) first. |
| Every submission is an *Infrastructure error* | Runner image missing (`docker compose --profile build-only build runner`) or Docker unavailable to the worker. The exact message is in the job log; fix, then *Re-run*. |
| Tests all crash with `AddressSanitizer:DEADLYSIGNAL` | See the `vm.mmap_rnd_bits` note in step 1. |
| Backup: "refusing to upload" | `RCLONE_REMOTE` does not point to a `crypt` remote (default `offsite-crypt:`). |
