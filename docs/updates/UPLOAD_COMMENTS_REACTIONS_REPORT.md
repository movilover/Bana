# Upload progress, comments, reactions, loading, offline & 404 update

Scope: User Website only. Admin Panel, Firebase config, Firestore/Storage rules, auth, routes, upload providers: untouched.
A safe copy of the source before editing was kept as `user_src_backup` in the working environment (not shipped); use Git to branch before applying.

## Changed files
New: `src/lib/uploadTracker.ts`, `src/lib/reactionSound.ts`, `src/lib/commentReactions.ts`, `src/components/common/UploadStatusDock.tsx`, `ConnectivityBanner.tsx`, `Skeletons.tsx`, `tests/ui/upload-tracker-and-sound.test.mjs`.
Edited: `src/App.tsx` (404 page, branded route loader, mounts banner + upload dock), `components/feed/ReactionBar.tsx`, `components/feed/PostCard.tsx` (comments), `components/reels/ReelCommentsPanel.tsx`, `components/reels/ReelUploadModal.tsx`, `components/create/CreateModal.tsx`, `pages/SettingsPage.tsx` (sound toggle), `src/index.css` (loader animation), `package.json` (`test:ui` script).
Unchanged: auth, AuthContext, Firebase config, upload providers/storage code, routes, Admin Panel, all other pages.

## What was done
- **Upload progress**: a global upload card (BANA logo, file name, real % from the existing uploader callbacks, status, Retry, Cancel for Reels). Success is shown only after the upload and Firestore write finish. Errors show the existing friendly message plus Retry. Duplicate submission is blocked (Post/Story/Reel). Closing the upload screen no longer cancels an upload.
- **Background upload (honest limits)**: uploads keep running while the user navigates inside BANA (single-page app, upload promises are not tied to the screen). They stop if the tab is closed/reloaded or the OS kills the browser. There is no service worker or resumable-after-reload upload; building that would be an architecture change, so it was not done.
- **Comments** (posts, photos, videos, reels): count of visible comments in the header, avatar/name/time, Reply and threaded replies, delete own comment/reply (existing soft-delete), skeleton loading, friendly error with Retry (15 s timeout), empty state.
- **Comment reactions**: Like/Love/Haha/Wow/Sad/Angry via press-and-hold (touch and mouse) or hover on desktop; tap toggles; change or remove. One reaction per user per comment (document id `commentId_uid`).
- **Post/Video reactions**: same six reactions; tray stays inside the screen, closes on outside tap, long-press works on touch, context menu suppressed.
- **Sounds**: original synthesized tones (Web Audio) played only after a tap, very quiet, toggle in Settings ("Reaction Sound Effects"). No audio files are required, so no assets to add.
- **Loading**: shared skeletons and a branded loader (stops spinning after 20 s and offers Try again). Existing skeleton screens on Discover, Profile and Saved were kept.
- **Offline**: banner "No Internet Connection" with Try Again; already-loaded content stays visible; auto "Back online" on reconnect.
- **404**: BANA branded Page Not Found with Go Back and Home. Routes unchanged.
- **Design**: new pieces use neutral black/white. The site-wide brand colour set in the previous step was not changed because you asked not to redesign the whole site.

## Backend / Firebase changes to review (NOT applied)
1. `commentLikes`: the current `firestore.rules` (checked by reading, not by running the emulator) already allows creating the extra `reactionType` field and deleting; it does not allow updates, so switching reaction type uses delete + create automatically. No rule change is needed.
2. Per-type comment counts are NOT stored: only the existing total `likesCount` (still changed with `increment`, as before) and the user's own reaction are shown. A per-type breakdown would need a `reactionSummary` update permission or server-side counters.
3. Counts are still maintained by client `increment`, as the existing app already did. Fully trusting only server counts needs rules/Cloud Functions, which was out of scope.
4. Admin moderation of comments stays where it is today (Admin Panel). No new moderator controls were added to the feed.

## Remaining issues
- Not tested in a real browser or against real Firebase (see testing report).
- `dist/` is built for base `/`; deploy through your GitHub Actions workflow so it uses `/<repo>/`.
