# Upgrading

Migrations run automatically when the app starts (Docker Compose) or as the pre-deploy step (Railway). They only ever add or change structure; they never delete your data. Still, **back up first**: a migration can't be rolled back by itself.

## Docker Compose

```bash
# 1. Back up the database (and make sure you still have ENCRYPTION_KEYS)
docker compose exec -T db pg_dump -U jobtracker jobtracker | gzip > backup-$(date +%F).sql.gz

# 2. Get the new version
git pull

# 3. Rebuild and restart (migrations run before the server starts)
docker compose --profile app up -d --build

# 4. Check it
docker compose logs app | tail -20
curl -s https://your.domain/api/health
```

If the app doesn't come up, the log shows the failing migration. Restore the backup into the database and run the previous version (`git checkout <previous tag>`), then open an issue with the log.

## Railway

Push or merge to the deployed branch. The pre-deploy command runs migrations; if they fail, the old version keeps running and the deploy is marked failed. Railway's daily Postgres backups are under the Postgres service → Backups.

## Release notes

Each GitHub release lists new environment variables, migrations and anything that needs your action. New variables always have safe defaults, so an upgrade works without editing `.env`; new features stay off until you configure them.

## Encryption key rotation

Add a new key and switch the active one; old data stays readable with the old key:

```
ENCRYPTION_KEYS=k1:<old>,k2:<new>
ENCRYPTION_ACTIVE_KEY_ID=k2
```

Keep `k1` in the list as long as any data was written with it.
