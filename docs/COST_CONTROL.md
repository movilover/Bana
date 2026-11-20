# BANA — Cost Control Guide (Prompt 12)

This guide explains what can cost money, the safeguards already in the code, what the owner must do manually, and how to turn a paid feature off. Read it before adding any provider key or enabling any paid option.

---

## 1. Rules BANA follows

1. **No automatic Firebase Blaze upgrade.** The code never calls billing APIs. The upgrade is a manual action in the Firebase Console.
2. **No automatic paid provider activation.** Paid providers ship `enabled: false` and `billingApproved: false` (or `billingApprovedByAdmin: false`).
3. **No silent switching to paid.** Storage selection (`selectPrimaryAndBackup`) and API activation (`handleActivateProvider`) refuse a paid provider without approval. Earlier code had a fallback that could pick any provider; Prompt 12 removed it for storage.
4. **Explicit confirmation.** Activating a provider, approving billing, and rollback all open a confirmation dialog and write an audit entry.
5. **No purchase or subscription** is created by any code path.
6. **Secrets stay server-side.** Paid keys belong in server or Worker environment variables, never in `VITE_*` variables or Firestore.

---

## 2. What can cost money

| Item | When it costs money | Default state | How it is controlled |
|---|---|---|---|
| Firebase Blaze plan | Only after manual upgrade and use of paid products | Spark | `VITE_FIREBASE_PLAN_MODE="spark"`; Cloud Functions disabled |
| Cloud Functions | Requires Blaze | Disabled | `CLOUD_FUNCTIONS_ENABLED` is false unless both flags are set |
| Cloud Storage for Firebase, new bucket | May require Blaze (verify) | Not used for uploads | Uploads go to R2/B2 |
| Google Cloud Storage | Billing account required | Disabled, `requiresBilling: true` | `billingApproved` + enabled |
| Cloudflare Stream | Per minute stored and delivered (verify) | Disabled | `billingApproved` + enabled |
| Cloudflare R2 | Above the free allowance (storage and operations) | Enabled (free allowance) | Storage alerts at 70%, 85%, 95% |
| Backblaze B2 | Above the free allowance | Enabled as backup (free allowance) | Same alerts |
| Render | Paid instance removes sleep; free tier has limited hours | Optional | Manual |
| TURN host (VPS) | Monthly plan and relay bandwidth | Optional | Manual; configure only when needed |
| LiveKit (self-hosted or cloud) | Server cost or cloud overage | Catalog only (`requiresBillingApproval: false` for the OSS entries; the cloud entry follows the same approval flow if added) | Manual setup; no paid LiveKit entry is active |
| Agora RTC, 100ms | Above free minutes | Disabled, approval required | Admin billing approval in API Management |
| Payment gateways (SSLCOMMERZ, bKash, Nagad, Stripe) | Transaction fees | Not active | Keys absent; manual settlement by default |
| Domain name | Annual fee | Owner | Manual |

---

## 3. Safeguards in the code

| Safeguard | File | What it does |
|---|---|---|
| Spark plan gate | `src/lib/firebasePlan.ts` | `CloudFunctionsDisabledError` replaces network calls to disabled functions |
| Paid storage guard | `src/lib/storage/providerSelection.ts` | Paid providers are eligible only with `billingApproved` |
| Paid storage config guard | `src/lib/providerValidation.ts` → `validateStorageProviderConfig()` | Rejects enabling a paid provider without approval; rejects malformed or insecure URLs |
| Paid API activation guard | `src/lib/providerValidation.ts` → `validateApiProviderConfig()` | Requires `billingApprovedByAdmin` before activation |
| Confirmation dialogs | `AdminApiManagementSection.tsx`, `AdminStorageRecoverySection.tsx` | Activation, billing approval, and recovery require explicit confirmation |
| Quota alerts | `evaluateQuotaAlerts()` in `storageManager.ts` | Warnings at 70%, 85% and 95% of free storage (estimated usage) |
| Video size and duration limits | `src/lib/videoUtils.ts` | 150 MB and 180 seconds before upload |
| Image compression | `compressImageFile()` | Smaller uploads (max 1600 px, JPEG 0.82) |
| Cost labels | `src/types/apiManagement.ts` | Quota labels describe the free tier honestly (Prompt 12 removed "unlimited" wording) |
| Rollback | `handleRollbackProvider()` in `AdminApiManagementSection.tsx` | Restores the previous API provider, through the same approval checks |

---

## 4. Manual owner checklist before launch

- [ ] Confirm the Firebase project is on **Spark** (Usage and billing page). Do not link a billing account unless you have decided to pay.
- [ ] Set up a **budget alert** in your Google Cloud billing account, but only if one is linked. If none is linked, there is nothing to charge.
- [ ] Set a **spending or usage alert** in Cloudflare (R2 and Workers) and Backblaze (B2) dashboards, if those providers offer it.
- [ ] Check that **no paid provider** is enabled in Admin → Storage & Recovery and Admin → API Management.
- [ ] Confirm `.env` does not contain paid keys you have not approved (`AGORA_*`, `HMS_*`, `STRIPE_*`, `SSLCOMMERZ_*`, `BKASH_*`, `NAGAD_*`).
- [ ] Review the Firebase Usage tab daily during launch week.

---

## 5. How to turn a paid feature off

| Feature | Steps |
|---|---|
| Storage provider | Admin → Storage & Recovery → set the provider to disabled, then save. Primary selection falls back to R2 |
| API provider | Admin → API Management → **Activate** a free provider in the same category. Or use **Rollback to previous** |
| Cloud Functions | Set `VITE_ENABLE_CLOUD_FUNCTIONS="false"` and redeploy the frontend |
| Firebase Blaze | Downgrade in the Firebase Console. Check the final invoice and any Cloud resources you created |
| Render paid instance | Change the plan in the Render dashboard |
| TURN VPS | Cancel in the VPS provider dashboard |

---

## 6. Known gaps (do not assume they are solved)

- **Live usage is not fetched from providers.** Usage numbers in the admin panel are BANA's own estimates. Check R2, B2, Render, and Firebase dashboards for real figures.
- **No provider-side hard spending cap is set by BANA.** Vendors must provide that; BANA cannot enforce it.
- **Firestore write hot spot (W1).** A signed-in tab writes presence every 60 seconds. See `DATABASE_OPTIMIZATION_REPORT.md`.
- **Storage rollback is not implemented.** Only API provider switching has rollback. Storage role changes are reverted by setting them again manually.
- **Vendor free-tier numbers change.** Every number in these docs marked "verify" must be checked before a public claim.
