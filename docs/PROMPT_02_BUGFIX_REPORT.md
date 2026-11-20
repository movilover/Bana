# BANA — Prompt 02 Bug-Fix Report (static review)

**Testing limitation.** The review environment has no npm registry access, so dependencies could not be installed.
`npm run lint`, `npm run build`, browser, console and responsive-device testing were **NOT run**. Changes below were
found by reading code and were only syntax-checked (TypeScript parse of each edited file). Please run
`npm install && npm run lint && npm run build` and click through the flows before deploying.

**Security scope.** No security file was touched in this phase (`firestore.rules`, `storage.rules`, `functions/`,
`backend/` auth/permission code, Supabase RLS, `.firebaserc`, `firebase.json` are unchanged since Prompt 01).

## Fixed (application code only)
| Area | File | Problem | Fix |
|---|---|---|---|
| Like / reaction | `src/components/feed/PostCard.tsx` | On a failed write only the user's reaction was rolled back; the like count and reaction summary stayed wrong. Rapid taps could fire overlapping writes. Failure was silent. | In-flight guard, full rollback of reaction + count + summary, error toast |
| Save post / video | same | Double-tap could issue duplicate writes. If the `savedVideos` write failed after `savedPosts` succeeded, the two collections diverged. Failure was silent. | In-flight guard, cleanup of the partial write, error toast |
| Poll vote | same | Failed vote left the UI showing a vote that was never saved. | Roll back options and voted state, error toast |
| Comment | same | Double submit possible; on failure the typed text was lost with no message. | In-flight guard, restore text/reply target, error toast |
| Header popups | `src/components/layout/AppShell.tsx` | Outside-click used `mousedown` (unreliable for touch/pen). Page used `min-h-screen` (iOS toolbar overflow). | `pointerdown`; `min-h-dvh` |
| Notifications | `NotificationPopup.tsx`, `NotificationsPage.tsx` | `linkUrl` was passed straight to the router (external / protocol-relative values mis-route). "Mark all read" reported success even if updates failed. | Only in-app `/…` paths are followed; failed updates are counted and reported |

## Inspected, no defect found (by code reading only)
- Admin Panel: tabs/sidebar routing, all 3 data tables already sit in `overflow-x-auto` containers, confirm-dialog actions surface errors via toast, user moderation uses the Cloud Function with a Firestore fallback and audit log.
- Post creation: has a `submitting` guard, writes `authorId` from the signed-in uid, shows preview/loading state.
- Messenger shortcut: links to `/messages`, hidden when the admin disables messaging.
- Stories viewer: keyboard (Esc/arrows) navigation and progress bars present.
- Search popup: Esc close, Ctrl/Cmd+K shortcut, routes to `/discover?q=`.

## Not verified / needs runtime testing
Responsive layout on Android/iPhone/tablet, popup positioning, animation performance, real Firestore reads/writes, Story data display, share flow, video posts, every admin management function. No hardcoded or mock data was added.

## Issues that need a security-prompt change (left untouched)
- Post `likesCount` / `commentsCount` / `sharesCount` can only be written by the post author under current rules, so other users' reactions and comments update only their local counter (`setLikesCount`) and the stored counts rely on Cloud Functions (off on the Spark plan). Counts may look correct locally but stay stale in the database for other viewers.
- Event RSVP counter rule introduced in Prompt 01 (±1 limit) should be re-verified with the emulator.
- `savedPosts` rules only allow updating `collectionName`, so re-saving an already saved post via `setDoc` is rejected; the new in-flight guard reduces but does not remove this edge case.
