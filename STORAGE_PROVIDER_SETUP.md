# Multi-Cloud Storage Provider Setup Guide

BANA decouples media delivery from Firebase Cloud Storage and supports **multiple S3-compatible providers** brokered via `workers/bana-media-broker`.

---

## 1. Cloudflare R2 (Recommended Primary — $0.00 Egress)

**Verified Free Tier:** 10 GB-month Standard storage, 1,000,000 Class A ops/mo, 10,000,000 Class B ops/mo, **$0.00 internet egress**.

1. In Cloudflare Dashboard → **R2 Object Storage**, create bucket `bana-media-primary`.
2. Add a **CORS Policy** on the bucket to allow direct browser presigned PUT uploads and Range video playback:
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://bana-a5770.web.app"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["Content-Type", "Range"],
       "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
3. Under **Manage R2 API Tokens**, create a scoped **Object Read & Write** token for `bana-media-primary`.
4. Bind secrets to Cloudflare Worker:
   - `R2_ENDPOINT` = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - `R2_BUCKET` = `bana-media-primary`
   - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   - Optional custom public domain (`R2_PUBLIC_BASE_URL`, e.g., `https://media.yourdomain.com`)

---

## 2. Backblaze B2 (Recommended Secondary Backup)

**Verified Free Tier:** 10 GB storage ongoing free, free Class A/B/C transactions, free egress up to 3x avg monthly stored data (S3-compatible endpoint).

1. Create private bucket `bana-media-backup` in Backblaze B2.
2. Generate an Application Key restricted to `bana-media-backup` with Read/Write capability.
3. Configure Worker secrets:
   - `B2_ENDPOINT` = `https://s3.<region>.backblazeb2.com` (e.g. `https://s3.us-west-004.backblazeb2.com`)
   - `B2_BUCKET` = `bana-media-backup`
   - `B2_KEY_ID`, `B2_APPLICATION_KEY`

---

## 3. Supabase Storage S3 (Optional — Strict 50 MB Limit)

**Verified Free Plan:** 1 GB total storage, **50 MB maximum single upload size**, 5 GB uncached + 5 GB cached egress/mo.
- `SupabaseStorageAdapter` enforces the 50 MB single-file hard limit before requesting a presigned PUT URL so large Reels fail clearly rather than timing out mid-stream.

---

## 4. Generic S3-Compatible (MinIO / Wasabi / DigitalOcean Spaces / Self-Hosted)

Works with any S3 SigV4 path-style or virtual-host bucket:
- Worker env keys: `GENERIC_S3_ENDPOINT`, `GENERIC_S3_BUCKET`, `GENERIC_S3_REGION`, `GENERIC_S3_ACCESS_KEY_ID`, `GENERIC_S3_SECRET_ACCESS_KEY`, `GENERIC_S3_PUBLIC_BASE_URL`.

---

## 5. Google Cloud Storage & Cloudflare Stream (Billing Guarded)

- Both `google_cloud_storage` and `cloudflare_stream` are flagged `requiresBilling: true` and **cannot** be used until an admin explicitly unlocks billing approval in Admin Panel.
- Never enter secret keys into Firestore `storageProviders` documents — Firestore Security Rules block secret keys at the database layer (`hasNoSecretFields()`).
