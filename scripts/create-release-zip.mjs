#!/usr/bin/env node
/**
 * BANA Multi-Bundle Secret-Free Release Archive Generator (Pure Node.js PKZIP)
 * Produces 5 verified downloadable ZIP archives in the project root:
 *  1. BANA-FULL-PROJECT.zip  - Complete unified project (Frontend, Admin, Backend, Workers, Supabase SQL, Security, Docs)
 *  2. BANA-USER-WEBSITE.zip  - User-facing Vite + React web application files
 *  3. BANA-ADMIN-PANEL.zip   - Super Admin Control Panel, RBAC, Calling/API Management modules
 *  4. BANA-BACKEND.zip       - Standalone Express + WebSocket Calling/Messaging Backend, Workers & Render config
 *  5. BANA-SECURITY.zip      - Firestore/Storage Security Rules, Supabase RLS/Migrations & Security Architecture Docs
 *
 * Strictly excludes node_modules, dist, .env*, private keys, and existing .zip files.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.firebase',
  '.wrangler',
  '.aistudio',
]);

const EXCLUDED_FILES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.dev.vars',
]);

const SECRET_PATTERNS = [
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/i,
  /"private_key"\s*:\s*"[^"]+"/i,
  /"secretAccessKey"\s*:\s*"[^"]{8,}"/i,
  /R2_SECRET_ACCESS_KEY\s*=\s*"[^"]{8,}"/i,
  /B2_APPLICATION_KEY\s*=\s*"[^"]{8,}"/i,
  /AWS_SECRET_ACCESS_KEY\s*=\s*"[^"]{8,}"/i,
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*"[^"]{16,}"/i,
  /LIVEKIT_API_SECRET\s*=\s*"[^"]{16,}"/i,
];

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function walkFiles(dir, relPrefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const collected = [];
  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      collected.push(...walkFiles(absPath, relPath));
    } else if (entry.isFile()) {
      if (EXCLUDED_FILES.has(entry.name)) continue;
      if (entry.name.endsWith('.zip')) continue;
      if (entry.name.startsWith('.env') && entry.name !== '.env.example') continue;
      if (/service[-_]?account.*\.json$/i.test(entry.name)) continue;
      collected.push({ absPath, relPath: relPath.replace(/\\/g, '/') });
    }
  }
  return collected;
}

function buildZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const file of files) {
    const data = fs.readFileSync(file.absPath);
    const nameBuf = Buffer.from(file.relPath, 'utf8');
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    localParts.push(lfh, nameBuf, payload);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(payload.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt16LE(0, 34);
    cdh.writeUInt16LE(0, 36);
    cdh.writeUInt32LE(0, 38);
    cdh.writeUInt32LE(offset, 42);

    centralParts.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + payload.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

const allFiles = walkFiles(ROOT);
const secretViolations = [];
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.ico', '.mp4', '.webm']);

for (const f of allFiles) {
  if (BINARY_EXTS.has(path.extname(f.relPath).toLowerCase())) continue;
  const content = fs.readFileSync(f.absPath, 'utf8');
  for (const pat of SECRET_PATTERNS) {
    if (pat.test(content)) {
      secretViolations.push(`${f.relPath} matched ${pat}`);
    }
  }
}

if (secretViolations.length > 0) {
  console.error('ABORTING ZIP BUILD: Potential secret material found in packaged files:');
  secretViolations.forEach((v) => console.error(` - ${v}`));
  process.exit(2);
}

const ADMIN_FILE_SET = new Set([
  'src/pages/AdminPage.tsx',
  'src/lib/adminRbac.ts',
  'src/types/apiManagement.ts',
]);

const BUNDLES = [
  {
    name: 'BANA-FULL-PROJECT.zip',
    filter: () => true,
  },
  {
    name: 'BANA-USER-WEBSITE.zip',
    filter: (p) =>
      p === 'index.html' ||
      p === 'package.json' ||
      p === 'tsconfig.json' ||
      p === 'vite.config.ts' ||
      p === 'metadata.json' ||
      p === '.env.example' ||
      p === 'README.md' ||
      p === 'DEPLOYMENT.md' ||
      p === 'TESTING.md' ||
      (p.startsWith('src/') && !p.startsWith('src/components/admin/') && p !== 'src/pages/AdminPage.tsx'),
  },
  {
    name: 'BANA-ADMIN-PANEL.zip',
    filter: (p) =>
      p.startsWith('src/components/admin/') ||
      ADMIN_FILE_SET.has(p) ||
      p.startsWith('api-providers/') ||
      p === 'README.md',
  },
  {
    name: 'BANA-BACKEND.zip',
    filter: (p) =>
      p.startsWith('backend/') ||
      p.startsWith('workers/') ||
      p === 'render.yaml' ||
      p.startsWith('deployment/') ||
      p === '.github/workflows/ci-and-deploy.yml' ||
      p === 'README.md' ||
      p === 'DEPLOYMENT.md',
  },
  {
    name: 'BANA-SECURITY.zip',
    filter: (p) =>
      p === 'firestore.rules' ||
      p === 'storage.rules' ||
      p === 'firestore.indexes.json' ||
      p === 'firebase.json' ||
      p.startsWith('database/supabase/') ||
      p.startsWith('security/') ||
      p.startsWith('tests/security/') ||
      p === 'FIREBASE_SPARK_COMPATIBILITY.md',
  },
];

const report = [];
for (const bundle of BUNDLES) {
  const matched = allFiles.filter((f) => bundle.filter(f.relPath));
  const outPath = path.join(ROOT, bundle.name);
  const zipBuffer = buildZipBuffer(matched);
  fs.writeFileSync(outPath, zipBuffer);
  report.push({
    archive: bundle.name,
    totalFiles: matched.length,
    archiveBytes: zipBuffer.length,
    secretScanPassed: true,
  });
}

console.log(JSON.stringify({ archivesGenerated: report.length, archives: report }, null, 2));
