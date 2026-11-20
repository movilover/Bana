# Firestore Security Rules Summary for Calling & API Management

All Firestore rules live in root `/firestore.rules` and Storage rules in `/storage.rules`.

## Key Protections Applied

1. **`messages` receipts & voice notes (`type: 'audio'`)**:
   - Senders must match `request.auth.uid` and belong to the parent conversation.
   - Recipients can update `deliveredTo` and `readBy` receipt arrays without altering message text or sender identity.
2. **`calls` (1-to-1) & Call Waiting (`on_hold`, `screenSharingBy`)**:
   - Strictly readable/writable by `callerId` or `calleeId`.
3. **`groupCalls/{roomId}` + `participants/{participantUid}` + `signals/{signalId}`**:
   - Only `hostUid`, `invitedParticipantIds`, or conversation members can read or join rooms.
   - Participants can write their own state (`micMuted`, `camOff`, `screenSharing`); hosts can mute/kick participants or mark the room `ended`.
   - WebRTC SDP/ICE `signals` are strictly scoped to `fromUid` and `toUid`.
4. **`apiProviders`, `apiProviderActive`, `apiUsageRecords`, `apiErrorLogs`**:
   - Helper `hasNoSecretFields()` explicitly rejects keys like `secretKey`, `apiSecret`, `appCertificate`, `privateKey`, `serviceRoleKey`, `turnSharedSecret`, or `webhookSecret` so secrets can never accidentally land in Firestore.
   - Admin writes require `isActiveAdmin()`.
