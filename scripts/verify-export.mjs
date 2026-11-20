#!/usr/bin/env node
/**
 * BANA export sanity check (no dependencies, no network).
 * 1. Required files exist.  2. No obvious secret material.  3. No forbidden files (.env, service accounts, node_modules).
 * Exit code 0 = pass, 1 = fail.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'lib']);
const REQUIRED = [
  'README.md', 'INSTALLATION.md', 'DEPLOYMENT.md', 'ENVIRONMENT.md', 'DATABASE.md', 'SECURITY.md',
  'API_DOCUMENTATION.md', 'TESTING.md', 'PROJECT_STRUCTURE.md', 'KNOWN_LIMITATIONS.md',
  '.env.example', 'backend/.env.example', 'workers/bana-media-broker/.dev.vars.example', '.gitignore',
  'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'src/main.tsx', 'src/App.tsx',
  'src/pages/AdminPage.tsx', 'backend/src/server.ts', 'backend/package.json', 'functions/src/index.ts',
  'firestore.rules', 'storage.rules', 'firestore.indexes.json', 'firebase.json', 'render.yaml',
  'database/supabase/migrations/001_initial_schema.sql', 'database/supabase/migrations/004_rls_and_storage_policies.sql',
  'workers/bana-media-broker/src/index.ts', '.github/workflows/ci-and-deploy.yml',
];
const SECRET_PATTERNS = [
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key block'],
  [/"private_key"\s*:\s*"[^"]{20,}"/, 'service-account private_key'],
  [/\bsk_live_[0-9A-Za-z]{10,}/, 'Stripe live secret'],
  [/\bsk_test_[0-9A-Za-z]{10,}/, 'Stripe test secret'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, 'Slack token'],
  [/\bghp_[0-9A-Za-z]{30,}/, 'GitHub token'],
  [/\b(SERVICE_ROLE_KEY|JWT_SECRET|API_SECRET|APP_SECRET|SECRET_ACCESS_KEY|APPLICATION_KEY|PRIVATE_KEY|APP_CERTIFICATE|SHARED_SECRET)\s*=\s*"[^"$<{][^"]{11,}"/, 'non-empty secret assignment'],
];
// Public Firebase web config is intentionally bundled (src/firebase.ts); allow that single file for AIza keys.
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.mp4', '.webm', '.zip']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || SKIP_DIRS.has(e.name) && e.name !== 'lib') { out.push({ forbiddenDir: path.relative(ROOT, p), name: e.name }); continue; }
      walk(p, out);
    } else out.push({ file: path.relative(ROOT, p), name: e.name });
  }
  return out;
}

const problems = [];
for (const f of REQUIRED) if (!fs.existsSync(path.join(ROOT, f))) problems.push(`missing required file: ${f}`);

const entries = walk(ROOT);
let scanned = 0;
for (const e of entries) {
  if (e.forbiddenDir) {
    if (e.name === 'node_modules') problems.push(`node_modules present: ${e.forbiddenDir}`);
    continue;
  }
  const f = e.file;
  if (/^\.env(\..+)?$/.test(e.name) && e.name !== '.env.example') problems.push(`env file present: ${f}`);
  if (e.name === '.dev.vars') problems.push(`.dev.vars present: ${f}`);
  if (/service[-_]?account.*\.json$/i.test(e.name) || /firebase-adminsdk.*\.json$/i.test(e.name)) problems.push(`service account file: ${f}`);
  if (/\.(pem|p12|key)$/i.test(e.name)) problems.push(`key file: ${f}`);
  if (e.name.endsWith('.zip')) problems.push(`nested zip: ${f}`);
  if (BINARY.has(path.extname(e.name).toLowerCase()) || e.name === 'package-lock.json') continue;
  let text;
  try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  scanned += 1;
  for (const [re, label] of SECRET_PATTERNS) {
    if (f === 'scripts/verify-export.mjs' || f === 'scripts/create-release-zip.mjs') continue;
    if (re.test(text)) problems.push(`possible secret (${label}) in ${f}`);
  }
}

console.log(JSON.stringify({ requiredFilesChecked: REQUIRED.length, textFilesScanned: scanned, problems: problems.length }, null, 2));
problems.forEach((p) => console.error(' - ' + p));
process.exit(problems.length ? 1 : 0);
