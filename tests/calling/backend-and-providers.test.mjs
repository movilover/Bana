#!/usr/bin/env node
/**
 * BANA End-to-End Backend, WebSocket Signaling, Calling Token & Provider Probe Test Suite
 *
 * Executes real HTTP + WebSocket connections against the compiled Express/ws backend
 * (`backend/dist/server.js`) bound to an ephemeral localhost port (`0`).
 * Zero mocked network helpers; tests actual HS256 JWT auth, rate limiter, Coturn HMAC-SHA1,
 * LiveKit v2 JWT signing, Paid Billing Approval guard, and 2-client WebSocket signaling.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require(path.resolve(process.cwd(), 'backend/node_modules/ws/index.js'));
const { createBanaBackendServer } = await import(
  path.resolve(process.cwd(), 'backend/dist/server.js')
);

const TEST_AUTH_SECRET = 'bana-e2e-test-auth-secret-key-2026';
const LIVEKIT_API_KEY = 'lk_test_key';
const LIVEKIT_API_SECRET = 'lk_test_super_secret_hmac_256_value_12345';
const TURN_SHARED_SECRET = 'turn-shared-hmac-secret-test';
const HMS_ACCESS_KEY = 'hms_key_test';
const HMS_APP_SECRET = 'hms_secret_test_1234567890';

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signTestToken({ uid, email, email_verified = true, adminRole }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iss: 'bana-test',
      sub: uid,
      uid,
      email,
      email_verified,
      adminRole,
      iat: now,
      exp: now + 600,
    })
  );
  const sig = crypto.createHmac('sha256', TEST_AUTH_SECRET).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${base64Url(sig)}`;
}

function waitForWsFrame(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`Timed out waiting for WebSocket frame after ${timeoutMs}ms`));
    }, timeoutMs);

    function onMsg(raw) {
      const frame = JSON.parse(String(raw));
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(frame);
      }
    }

    ws.on('message', onMsg);
  });
}

async function runTests() {
  const results = [];
  const { server, hub } = createBanaBackendServer({
    testAuthHmacSecret: TEST_AUTH_SECRET,
    turnUrls: ['turn:turn.bana.example:3478?transport=udp'],
    turnSharedSecret: TURN_SHARED_SECRET,
    livekitWsUrl: 'wss://livekit.bana.example',
    livekitApiKey: LIVEKIT_API_KEY,
    livekitApiSecret: LIVEKIT_API_SECRET,
    hmsAccessKey: HMS_ACCESS_KEY,
    hmsAppSecret: HMS_APP_SECRET,
    // Operator-side approval (env APPROVED_PAID_PROVIDERS). Agora is deliberately NOT approved here.
    approvedPaidProviders: ['100ms'],
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsBaseUrl = `ws://127.0.0.1:${address.port}`;

  const aliceToken = signTestToken({
    uid: 'user_alice',
    email: 'alice@bana.test',
  });
  const bobToken = signTestToken({
    uid: 'user_bob',
    email: 'bob@bana.test',
  });
  const superAdminToken = signTestToken({
    uid: 'admin_founder',
    email: 'omor.faruk.sojol.2@gmail.com',
    adminRole: 'super_admin',
  });

  try {
    // 1. Health endpoint
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.service, 'bana-realtime-backend');
    results.push('PASS: GET /health returns 200 OK');

    // 2. Unauthenticated rejection (401)
    const unauthRes = await fetch(`${baseUrl}/api/calling/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'webrtc_builtin', roomName: 'room_1' }),
    });
    assert.equal(unauthRes.status, 401);
    results.push('PASS: Unauthenticated /api/calling/token blocked with 401');

    // 3. Non-admin rejection on /api/admin/status (403) + Admin success (200)
    const nonAdminRes = await fetch(`${baseUrl}/api/admin/status`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(nonAdminRes.status, 403);

    const adminRes = await fetch(`${baseUrl}/api/admin/status`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    assert.equal(adminRes.status, 200);
    const adminJson = await adminRes.json();
    assert.equal(adminJson.envPresence.turnConfigured, true);
    assert.equal(adminJson.envPresence.livekitConfigured, true);
    results.push('PASS: RBAC enforces 403 for standard user and 200 for super_admin on /api/admin/status');

    // 3b. Prompt 09: staff roles without manage_api_providers are denied on service-management routes
    for (const staffRole of ['moderator', 'support_staff', 'finance_manager', 'ad_manager']) {
      const staffToken = signTestToken({ uid: `staff_${staffRole}`, email: `${staffRole}@bana.test`, adminRole: staffRole });
      for (const [method, path] of [['GET', '/api/admin/status'], ['GET', '/api/admin/usage'], ['POST', '/api/admin/providers/test']]) {
        const staffRes = await fetch(`${baseUrl}${path}`, {
          method,
          headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
          ...(method === 'POST' ? { body: JSON.stringify({ category: 'calling', providerKey: 'webrtc_builtin' }) } : {}),
        });
        assert.equal(staffRes.status, 403, `${staffRole} must be denied on ${method} ${path}`);
      }
    }
    const adminRoleToken = signTestToken({ uid: 'staff_admin', email: 'admin@bana.test', adminRole: 'admin' });
    const adminRoleRes = await fetch(`${baseUrl}/api/admin/status`, { headers: { Authorization: `Bearer ${adminRoleToken}` } });
    assert.equal(adminRoleRes.status, 200);
    results.push('PASS: Prompt 09 per-route RBAC — moderator/support/finance/ad staff get 403, admin gets 200 on /api/admin/*');

    // 4. Built-in WebRTC ICE + Coturn HMAC-SHA1 credential verification
    const iceRes = await fetch(`${baseUrl}/api/calling/ice-servers`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(iceRes.status, 200);
    const iceJson = await iceRes.json();
    assert.equal(iceJson.turnConfigured, true);
    const turnEntry = iceJson.iceServers.find((s) => s.username && s.credential);
    assert.ok(turnEntry, 'TURN entry with ephemeral HMAC credential expected');
    const expectedTurnCred = crypto
      .createHmac('sha1', TURN_SHARED_SECRET)
      .update(turnEntry.username)
      .digest('base64');
    assert.equal(turnEntry.credential, expectedTurnCred);
    results.push('PASS: /api/calling/ice-servers signs valid Coturn HMAC-SHA1 TURN credentials');

    // 5. LiveKit Open-Source SFU v2 JWT AccessToken minting + signature verification
    const lkRes = await fetch(`${baseUrl}/api/calling/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        providerId: 'livekit_oss',
        roomName: 'group_room_alpha',
        displayName: 'Alice',
      }),
    });
    assert.equal(lkRes.status, 200);
    const lkJson = await lkRes.json();
    assert.equal(lkJson.configured, true);
    assert.equal(lkJson.wsUrl, 'wss://livekit.bana.example');
    const lkParts = lkJson.token.split('.');
    assert.equal(lkParts.length, 3);
    const lkPayload = JSON.parse(Buffer.from(lkParts[1], 'base64url').toString('utf8'));
    assert.equal(lkPayload.sub, 'user_alice');
    assert.equal(lkPayload.video.room, 'group_room_alpha');
    assert.equal(lkPayload.video.roomJoin, true);
    const expectedLkSig = base64Url(
      crypto.createHmac('sha256', LIVEKIT_API_SECRET).update(`${lkParts[0]}.${lkParts[1]}`).digest()
    );
    assert.equal(lkParts[2], expectedLkSig);
    results.push('PASS: LiveKit v2 JWT AccessToken signed with verifiable HMAC-SHA256 & room claims');

    // 6. Paid Provider Billing Approval Gate
    const blockedAgora = await fetch(`${baseUrl}/api/calling/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        providerId: 'agora',
        roomName: 'paid_room',
        billingApprovedByAdmin: false,
      }),
    });
    assert.equal(blockedAgora.status, 403);
    const blockedAgoraJson = await blockedAgora.json();
    assert.equal(blockedAgoraJson.requiresBillingApproval, true);

    // Regression test for the billing-gate bypass: a client-supplied flag must be ignored.
    const spoofedAgora = await fetch(`${baseUrl}/api/calling/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        providerId: 'agora',
        roomName: 'paid_room',
        billingApprovedByAdmin: true,
      }),
    });
    assert.equal(spoofedAgora.status, 403);
    const spoofedAgoraJson = await spoofedAgora.json();
    assert.equal(spoofedAgoraJson.configured, false);
    assert.equal(spoofedAgoraJson.requiresBillingApproval, true);

    const hmsApproved = await fetch(`${baseUrl}/api/calling/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        providerId: '100ms',
        roomName: 'hms_room',
      }),
    });
    assert.equal(hmsApproved.status, 200);
    const hmsJson = await hmsApproved.json();
    assert.equal(hmsJson.configured, true);
    assert.ok(hmsJson.token.split('.').length === 3);
    results.push('PASS: Paid Billing Guard is server-controlled: spoofed client flag ignored (403), operator-approved 100ms works');

    // 7. Admin Provider Connectivity Probe (/api/admin/providers/test)
    const webrtcProbeRes = await fetch(`${baseUrl}/api/admin/providers/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        category: 'voice_video_calling',
        providerKey: 'webrtc_builtin',
      }),
    });
    assert.equal(webrtcProbeRes.status, 200);
    const webrtcProbe = await webrtcProbeRes.json();
    assert.equal(webrtcProbe.connectionStatus, 'connected');

    const supaUnconfRes = await fetch(`${baseUrl}/api/admin/providers/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${superAdminToken}`,
      },
      body: JSON.stringify({
        category: 'realtime_messaging',
        providerKey: 'supabase_realtime',
      }),
    });
    assert.equal(supaUnconfRes.status, 200);
    const supaUnconf = await supaUnconfRes.json();
    assert.equal(supaUnconf.connectionStatus, 'unconfigured');
    results.push('PASS: Admin /api/admin/providers/test executes real probes without fake statuses');

    // 8. Real WebSocket Signaling E2E (unauth rejection + room join + SDP/ICE relay + host mute/kick + screen share + chat typing)
    const unauthWsStatus = await new Promise((resolve) => {
      const badWs = new WebSocket(`${wsBaseUrl}/ws`);
      badWs.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      badWs.on('error', () => {});
    });
    assert.equal(unauthWsStatus, 401);

    const wsAlice = new WebSocket(`${wsBaseUrl}/ws?token=${encodeURIComponent(aliceToken)}&name=Alice`);
    await waitForWsFrame(wsAlice, (f) => f.type === 'connected' && f.uid === 'user_alice');

    const wsBob = new WebSocket(`${wsBaseUrl}/ws?token=${encodeURIComponent(bobToken)}&name=Bob`);
    await waitForWsFrame(wsBob, (f) => f.type === 'connected' && f.uid === 'user_bob');

    // Alice joins room
    const aliceRoomStateP = waitForWsFrame(wsAlice, (f) => f.type === 'room:state' && f.roomId === 'e2e_room_1');
    wsAlice.send(
      JSON.stringify({
        type: 'room:join',
        roomId: 'e2e_room_1',
        conversationId: 'conv_group_1',
        hostUid: 'user_alice',
        callType: 'video',
        maxParticipants: 6,
        displayName: 'Alice',
      })
    );
    const aliceRoomState = await aliceRoomStateP;
    assert.equal(aliceRoomState.participants.length, 1);

    // Bob joins room -> Alice receives participant_joined
    const aliceJoinedNotifP = waitForWsFrame(
      wsAlice,
      (f) => f.type === 'room:participant_joined' && f.uid === 'user_bob'
    );
    const bobRoomStateP = waitForWsFrame(wsBob, (f) => f.type === 'room:state' && f.roomId === 'e2e_room_1');
    wsBob.send(
      JSON.stringify({
        type: 'room:join',
        roomId: 'e2e_room_1',
        conversationId: 'conv_group_1',
        hostUid: 'user_alice',
        displayName: 'Bob',
      })
    );
    const [aliceNotif, bobRoomState] = await Promise.all([aliceJoinedNotifP, bobRoomStateP]);
    assert.equal(aliceNotif.participants.length, 2);
    assert.equal(bobRoomState.participants.length, 2);

    // Offer / Answer / ICE relay
    const bobOfferP = waitForWsFrame(wsBob, (f) => f.type === 'signal:offer' && f.fromUid === 'user_alice');
    wsAlice.send(
      JSON.stringify({
        type: 'signal:offer',
        roomId: 'e2e_room_1',
        toUid: 'user_bob',
        sdp: { type: 'offer', sdp: 'v=0\r\nfake-test-sdp' },
      })
    );
    const bobOffer = await bobOfferP;
    assert.equal(bobOffer.sdp.type, 'offer');

    const aliceIceP = waitForWsFrame(wsAlice, (f) => f.type === 'signal:ice' && f.fromUid === 'user_bob');
    wsBob.send(
      JSON.stringify({
        type: 'signal:ice',
        roomId: 'e2e_room_1',
        toUid: 'user_alice',
        candidate: { candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 54321 typ host' },
      })
    );
    const aliceIce = await aliceIceP;
    assert.ok(aliceIce.candidate.candidate.includes('typ host'));

    // Screen sharing toggle broadcast
    const bobScreenP = waitForWsFrame(
      wsBob,
      (f) =>
        f.type === 'room:participants_updated' &&
        f.participants.some((p) => p.uid === 'user_alice' && p.screenSharing === true)
    );
    wsAlice.send(
      JSON.stringify({
        type: 'screen:toggle',
        roomId: 'e2e_room_1',
        screenSharing: true,
      })
    );
    await bobScreenP;

    // Non-host Bob cannot kick Alice
    const bobModErrP = waitForWsFrame(wsBob, (f) => f.type === 'error');
    wsBob.send(
      JSON.stringify({
        type: 'participant:kick',
        roomId: 'e2e_room_1',
        targetUid: 'user_alice',
      })
    );
    const bobModErr = await bobModErrP;
    assert.ok(bobModErr.message.includes('host'));

    // Host Alice mutes and kicks Bob
    const bobMutedP = waitForWsFrame(wsBob, (f) => f.type === 'room:force_muted' && f.byUid === 'user_alice');
    wsAlice.send(
      JSON.stringify({
        type: 'participant:mute',
        roomId: 'e2e_room_1',
        targetUid: 'user_bob',
      })
    );
    await bobMutedP;

    const bobKickedP = waitForWsFrame(wsBob, (f) => f.type === 'room:kicked' && f.byUid === 'user_alice');
    wsAlice.send(
      JSON.stringify({
        type: 'participant:kick',
        roomId: 'e2e_room_1',
        targetUid: 'user_bob',
      })
    );
    await bobKickedP;

    // Typing indicator delivery over WebSocket
    const bobTypingP = waitForWsFrame(wsBob, (f) => f.type === 'chat:typing' && f.fromUid === 'user_alice');
    wsAlice.send(
      JSON.stringify({
        type: 'chat:typing',
        conversationId: 'conv_group_1',
        targetUids: ['user_bob'],
        typing: true,
      })
    );
    const bobTyping = await bobTypingP;
    assert.equal(bobTyping.typing, true);

    wsAlice.close();
    wsBob.close();
    results.push('PASS: WebSocket /ws signaling verified (401 auth gate, group join, offer/ICE relay, screen toggle, host mute/kick RBAC, typing)');

    // 9. Rate limiter enforcement check (calling limit default 30 req/min -> trigger 429 cleanly)
    let got429 = false;
    let retryAfterHeader = '';
    for (let i = 0; i < 32; i += 1) {
      const r = await fetch(`${baseUrl}/api/calling/ice-servers`, {
        headers: { Authorization: `Bearer ${bobToken}` },
      });
      if (r.status === 429) {
        got429 = true;
        retryAfterHeader = r.headers.get('retry-after') || '';
        break;
      }
    }
    assert.equal(got429, true, 'Expected HTTP 429 when exceeding 30 req/min on /api/calling');
    assert.ok(Number(retryAfterHeader) >= 1, 'Expected Retry-After header on 429 response');
    results.push('PASS: Sliding-window rate limiter enforces 429 Too Many Requests with Retry-After');

    // 10. Supabase SQL & Provider Manifest Integrity Check
    const requiredSqlFiles = [
      'database/supabase/migrations/001_initial_schema.sql',
      'database/supabase/migrations/002_messenger_and_calling.sql',
      'database/supabase/migrations/003_api_providers_usage_logs.sql',
      'database/supabase/migrations/004_rls_and_storage_policies.sql',
      'database/supabase/seed.sql',
    ];
    for (const rel of requiredSqlFiles) {
      const full = path.resolve(process.cwd(), rel);
      assert.ok(fs.existsSync(full), `Missing SQL migration: ${rel}`);
      assert.ok(fs.statSync(full).size > 200, `SQL file unexpectedly small: ${rel}`);
    }
    results.push('PASS: Supabase PostgreSQL migrations (001-004) + seed.sql verified present');
  } finally {
    hub.close();
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n=== BANA BACKEND & CALLING E2E TEST SUITE ===');
  results.forEach((line) => console.log(` - ${line}`));
  console.log(`TOTAL PASSED: ${results.length}/${results.length}\n`);
}

runTests().catch((err) => {
  console.error('BANA E2E TEST FAILED:', err);
  process.exit(1);
});
