# BANA — Storage Architecture Report (Prompt 12)

## 1. Current architecture (confirmed in code)

```
Browser ──(compress/validate)──► Cloudflare Worker "Media Broker" ──► Cloudflare R2 (primary)
                                        │                               │
                                        └── backup job (backupJobs) ──► Backblaze B2 (backup)
Firestore: mediaAssets (metadata + checksum + lifecycle), backupJobs, storageProviders (non-secret config)
```

- Upload path: `uploadToMultiCloudStorage()` in `src/lib/storage/storageManager.ts`. It computes a SHA-256, writes a `mediaAssets` row in `uploading` state, uploads through the active adapter, then marks the row `ready` or `backup_pending`.
- Primary and backup selection: `selectPrimaryAndBackup()` in `src/lib/storage/providerSelection.ts`. Paid providers are eligible only when `billingApproved` is true.
- Secrets: never in the browser or in Firestore. R2 and B2 keys live in `wrangler secret put` for the Worker. `saveStorageProviderConfig()` whitelists non-secret fields only, and `firestore.rules` rejects secret-named fields.
- Firebase Cloud Storage is **not** used for active uploads (see `FIREBASE_SPARK_COMPATIBILITY.md`).

## 2. Storage paths (`storage.rules`)

Size and type helpers at the top of `storage.rules`: images ≤ 15 MB (JPEG, PNG, WebP, GIF); video ≤ 150 MB (MP4, WebM, QuickTime); audio ≤ 15 MB (WebM, Ogg, MP4, MPEG, WAV, AAC); documents ≤ 25 MB (PDF, plain text, ZIP); captions ≤ 2 MB (VTT, text).

| Path | Allowed content (write) | Read access | Delete |
|---|---|---|---|
| `users/{uid}` (profile, cover) | Images | Public | Owner |
| `posts/{uid}` | Images, video, audio | Public | Owner |
| `reels/{uid}` | Video, images, captions | Public | Owner |
| `stories/{uid}` | Images, video | Signed-in users | Owner |
| `voice/{uid}` | Audio | Public | Owner |
| `messages/{conversationId}/{uid}` | Images, video, audio, documents | Signed-in users | Owner |
| `groups/{uid}` | Images | Signed-in users | Owner |
| `market/{uid}` (marketplace) | Images | Public | Owner |
| `stores/{uid}` | Images | Public | Owner |
| `reviews/{uid}` | Images | Public | Owner |
| `communities/{uid}` | Images, video | Public | Owner |
| `ads/{uid}` | Images, video | Public | Owner |
| `verifications/{uid}` | Images, documents | Owner, or admin roles | Not allowed |
| anything else | Denied | Denied | Denied |

The `verifications` read rule also contains a hard-coded bootstrap email address. That is a known item from Prompt 11 and must be replaced before launch.

Note: the table above lists the Firebase Storage rule paths kept for compatibility and existing references. New uploads go through the R2/B2 broker, so the sizes that apply to new media are the client validation limits in `src/lib/videoUtils.ts` (video: 150 MB, 180 s) and `src/lib/mediaUtils.ts` (image: 1600 px wide, JPEG quality 0.82).

## 3. Provider roles

| Role | Provider | Default | Notes |
|---|---|---|---|
| Primary | Cloudflare R2 | Enabled | Zero egress fee on R2 (verify). Free allowance: 10 GB-month storage |
| Secondary backup | Backblaze B2 | Enabled | Free storage allowance (verify). Used for copies, not for serving |
| Optional | Supabase Storage | Disabled | 50 MB per-file limit on the free tier (verify); not for video |
| Optional | Generic S3 (MinIO, Wasabi, Spaces, self-hosted) | Disabled | Your own account and costs |
| Paid | Google Cloud Storage | Disabled, billing approval required | Needs a billing account |
| Paid (transcoding role) | Cloudflare Stream | Disabled, billing approval required | About $5 per 1,000 minutes stored (verify) |

## 4. Media cost controls in code

| Control | Where | Effect |
|---|---|---|
| Image resize and JPEG re-encode | `compressImageFile()` in `src/lib/mediaUtils.ts` | Max width 1600 px, JPEG quality 0.82 |
| Video poster extraction | `extractVideoThumbnail()` in `src/lib/mediaUtils.ts` | Client-side poster frame; no server transcode |
| Video validation | `src/lib/videoUtils.ts` | Rejects files over 150 MB and reels over 180 s; checks codecs in the browser |
| Spark size advisory | `SPARK_RECOMMENDED_VIDEO_MB` (35 MB) | Warning in the upload UI; not a hard block |
| In-flight duplicate guard | `uploadToMultiCloudStorage()` | Blocks a second identical upload while the first is running |
| Checksum | `computeBlobSha256()` | Stored per asset; enables integrity checks and future de-duplication |
| Lazy loading | `loading="lazy"` on feed, profile, marketplace, messenger, and community images | Defers off-screen image downloads (Prompt 12) |
| Preload control | Reels: `preload` set by distance from the active slide | Limits video bytes fetched ahead of playback |

**Gap (documented, not fixed):** duplicate detection is only in-flight. A file uploaded twice in separate sessions is stored twice. Fixing that needs a lookup by checksum before upload, which means a new Firestore query per upload.

## 5. Quota alerts

`evaluateQuotaAlerts()` compares `estimatedUsedBytes` with the free allowance and raises alerts at 70%, 85%, and 95% (`DEFAULT_RETENTION_POLICY`).

**Important:** `estimatedUsedBytes` is a counter BANA maintains. It is not read from the provider. The admin panel labels it as an estimate. Live provider usage is not fetched automatically; check the R2 and B2 dashboards for real numbers.

## 6. What storage does not do

- It does **not** transcode video or create HLS or adaptive streams.
- It does **not** resize images on the server.
- It does **not** delete expired media automatically. Story expiry and retention are handled by the existing backup and retention settings.

## 7. Integration requirements (manual)

1. Create the R2 bucket and an API token scoped to that bucket. Store the keys with `wrangler secret put`.
2. Create the B2 bucket and application key. Store with `wrangler secret put`.
3. Deploy `workers/bana-media-broker` and set `VITE_MEDIA_BROKER_URL`.
4. In **Admin → Storage & Recovery**, confirm the R2 provider is enabled and the B2 provider is the secondary backup.
5. Set `ALLOWED_ORIGINS` on the Worker to your real domain. The current `wrangler.toml` uses `"*"` (see `KNOWN_LIMITATIONS.md`).

See `STORAGE_PROVIDER_SETUP.md` for the step-by-step guide.
