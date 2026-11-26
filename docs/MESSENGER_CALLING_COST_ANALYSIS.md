# BANA — Messenger & Calling Cost Analysis (Prompt 12)

This report covers realtime messaging and voice/video calling: what each part costs, what the free options can and cannot do, and what must never be claimed as "free". No paid provider is activated by this document.

**Important:** "free" in this report means "no platform fee for the listed usage". Calls always consume bandwidth, and bandwidth always has a cost for someone: the participants' data plan, a TURN host, or an SFU host. No calling setup in this repository is unlimited.

---

## 1. Components in the code

| Component | Where | Role | Cost driver |
|---|---|---|---|
| Message storage and realtime sync | Firestore `messages`, `conversations`; listeners in `MessengerPage` and `GroupChatPanel` | Text messages, unread counters, group chat | Firestore reads and writes (Spark quota) |
| Call signaling (built-in) | Firestore call documents and listeners (`src/lib/webrtcCalling.ts`) | SDP offer/answer and ICE candidates | Firestore writes per candidate (small) |
| Call signaling (WebSocket) | `backend/src/ws/signalingServer.ts` on Render | Presence and ping (`realtimeClient.ts` pings every 20 s) | Render instance hours (sleeps on free tier) |
| STUN | Public STUN servers (built-in) | Discovers public addresses | Free, no SLA |
| TURN (optional) | Coturn, configured by `TURN_URLS` and `TURN_SHARED_SECRET` | Relays media when a direct path fails | **Bandwidth on the TURN host** |
| Ephemeral TURN credentials | `backend/src/services/tokenService.ts` (HMAC-SHA1, REST style) | Short-lived credentials; the shared secret stays on the server | None |
| SFU (optional) | LiveKit, configured by `LIVEKIT_*`; tokens signed in `tokenService.ts` | Forwards media for group calls | **Server CPU and bandwidth** |
| Paid calling providers | Agora RTC and 100ms (catalog only, disabled) | Managed media | Per-minute billing above free minutes |
| Group call limit | `maxGroupCallParticipants` default 8; clamped to 2–50 in `webrtcCalling.ts` | Caps mesh size | Upload bandwidth per participant |

---

## 2. Option comparison

| Option | Free? | Works for | Limitations | Recommended use |
|---|---|---|---|---|
| Built-in P2P WebRTC + Firestore signaling | No platform fee | 1:1 calls and small group mesh | Fails behind some corporate and symmetric NATs; each participant uploads a copy to every other participant | Default; 1:1 and small groups |
| Built-in + public STUN only | No platform fee | Calls on friendly networks | Not reliable on mobile carriers and strict firewalls | Testing only |
| Built-in + self-hosted Coturn (TURN) | VPS cost + relay bandwidth | Reliable calls across networks | Needs a host with public UDP. Render free web services do not provide this. Relayed traffic counts against the VPS allowance (verify) | Recommended once calls must work reliably |
| LiveKit OSS (self-hosted SFU) | Software is free; you pay for the server | Groups beyond the mesh limit | Needs a VPS with enough CPU and bandwidth; you operate it | Group calls above about 8 people |
| LiveKit Cloud | Free tier with limits (verify) | Groups without operating a server | Limits and overage (verify) | Trial before self-hosting |
| Agora / 100ms | Free minutes per month, then paid (verify) | Managed calls | Paid overage; disabled by default | Only after admin billing approval |

---

## 3. Bandwidth estimates

These are formulas with stated assumptions, not measurements. Replace the assumptions with real figures after a test call.

Assumptions: video at **1 Mbps per direction**, call length **30 minutes**. 1 Mbps for 30 minutes = 225 MB.

| Scenario | Media moved | Who pays for it (approximate) |
|---|---|---|
| 1:1 P2P, direct path | About 225 MB up and 225 MB down per participant (about 450 MB per participant total) | Participants' data plans; no BANA server cost |
| 1:1 through TURN relay | About 900 MB total through the TURN host (each participant uploads and downloads through the relay) | TURN host bandwidth |
| Group mesh, 5 people, P2P | Each participant uploads 4 streams: about 900 MB up per participant | Participants' upload bandwidth; often the bottleneck on mobile |
| Group via LiveKit SFU, 5 people | Each participant uploads 1 stream; the server forwards 4 streams to each: about 4.5 GB out of the SFU per 30 minutes | SFU host bandwidth |

**Takeaway:** the mesh is free for the server but expensive for participants' upload links. The SFU protects upload links but moves the bill to the server.

---

## 4. Messaging cost

- Each text message creates one `messages` document. Conversation summaries are updated on send (verify in the send path in `MessengerPage.tsx`).
- Rough write budget: about 2 writes per message (message plus summary). At the Spark cap of 20,000 writes per day, that is about 10,000 messages per day for the whole app, before other writes. This is an estimate.
- Realtime delivery uses listeners, so reads depend on how many devices are open. Limit each listener with `limit()` (already done for unread counters).
- Voice notes and attachments go to R2 through the broker, not to Firestore. Their cost is storage and egress on R2/B2 (see `STORAGE_ARCHITECTURE_REPORT.md`).

---

## 5. Security notes for calling

- TURN credentials are time-limited and computed server-side. The shared secret is never sent to the browser.
- LiveKit API secrets stay on the backend. Frontend variables must never contain them.
- Paid provider keys (`AGORA_*`, `HMS_*`) are server-only and must not be placed in `VITE_*` variables.

---

## 6. Recommendations

1. Keep built-in P2P as the default for 1:1 calls. It has no platform fee.
2. Before a public launch, test calls across mobile data and Wi-Fi. If they fail, configure Coturn on a VPS. Do not use the Render free tier for TURN.
3. Keep the group limit at 8 until an SFU is configured and tested. Raising it on the mesh multiplies every participant's upload.
4. Activate LiveKit only after an owner decision on hosting cost. Activate Agora or 100ms only after billing approval in **Admin → API Management**.
5. Record real call bandwidth in the provider dashboard (Coturn logs or LiveKit metrics) and replace the estimates in §3.

---

## 7. What this report does not claim

- It does not claim TURN or SFU traffic is free.
- It does not claim the built-in P2P mode works for every network.
- It does not claim any paid calling provider is free beyond its published free minutes (verify).
