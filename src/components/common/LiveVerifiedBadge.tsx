import React from 'react';
import { VerifiedBadge } from '@/src/components/common/BanaLogo';
import { useLiveVerified } from '@/src/lib/verifiedStatus';

/**
 * Verified badge driven by the server-side users/{uid}.isVerified flag (live).
 * Renders nothing until the server confirms — a stale or forged `authorVerified` field on a
 * post/comment/reel is intentionally ignored.
 */
export function LiveVerifiedBadge({ uid, size = 14 }: { uid?: string | null; size?: number }) {
  const verified = useLiveVerified(uid);
  if (!verified) return null;
  return <VerifiedBadge size={size} />;
}
