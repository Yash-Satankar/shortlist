import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * One start command for hosts without a pre-deploy step (Render's free tier, Docker Compose, a
 * plain VM): `node apps/api/dist/scripts/start.js`. It runs the migrations, then (on a demo
 * instance, DEMO_MODE=true) rebuilds the fictional demo data, then starts the server in this
 * process. Each step must succeed, or the server doesn't start. No shell needed, so it works in
 * any "start command" field as is.
 */
const here = import.meta.dirname;
const step = (file: string) => execFileSync(process.execPath, [path.join(here, file)], { stdio: 'inherit', env: process.env });

step('migrate.js');
if (/^(true|1|yes|on)$/i.test(process.env.DEMO_MODE ?? '')) step('demo-seed.js');
await import('../server');
