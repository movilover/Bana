import React, { useEffect, useState } from 'react';
import {
  Phone,
  Video,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { useCall } from '@/src/contexts/CallContext';
import { useToast } from '@/src/contexts/ToastContext';
import type { CallRecord } from '@/src/types/calling';
import { fetchUserCallHistory, hideCallFromHistory } from '@/src/lib/webrtcCalling';
import { Avatar } from '@/src/components/common/Avatar';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import { formatDurationClock } from '@/src/lib/videoUtils';

export function CallHistoryView({
  onSelectConversation,
}: {
  onSelectConversation?: (conversationId: string) => void;
}) {
  const { firebaseUser } = useAuth();
  const { startCall } = useCall();
  const toast = useToast();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!firebaseUser) return;
    setLoading(true);
    const list = await fetchUserCallHistory(firebaseUser.uid, 40);
    setCalls(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid]);

  if (!firebaseUser) return null;

  const handleDelete = async (callId: string) => {
    try {
      await hideCallFromHistory(callId, firebaseUser.uid);
      setCalls((prev) => prev.filter((c) => c.id !== callId));
      toast.info('Removed from your call history.');
    } catch (err: any) {
      toast.error(err?.message || 'Unable to delete call log.');
    }
  };

  if (loading) {
    return (
      <div className="p-6 text-center text-xs text-neutral-500">
        Loading call history...
      </div>
    );
  }

  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-900">
      <div className="px-4 py-2.5 flex items-center justify-between text-[11px] text-neutral-500">
        <span>Recent Audio & Video Calls ({calls.length})</span>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {calls.length === 0 ? (
        <div className="p-8 text-center space-y-1.5">
          <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">No calls recorded yet</p>
          <p className="text-[11px] text-neutral-500">
            Audio and video calls placed in BANA Messenger will appear here.
          </p>
        </div>
      ) : (
        calls.map((c) => {
          const isOutgoing = c.callerId === firebaseUser.uid;
          const peerUid = isOutgoing ? c.calleeId : c.callerId;
          const peerName = isOutgoing ? c.calleeName : c.callerName;
          const peerAvatar = isOutgoing ? c.calleeAvatar : c.callerAvatar;
          const isMissed = c.status === 'missed' || c.status === 'rejected' || c.status === 'failed';

          return (
            <div
              key={c.id}
              className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors"
            >
              <button
                type="button"
                onClick={() => c.conversationId && onSelectConversation?.(c.conversationId)}
                className="flex items-center gap-3 min-w-0 text-left flex-1"
              >
                <Avatar src={peerAvatar} name={peerName || 'BANA Member'} size="md" />
                <div className="min-w-0">
                  <p className={`text-sm font-semibold truncate ${isMissed ? 'text-red-600 dark:text-red-400' : ''}`}>
                    {peerName || 'BANA Member'}
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 mt-0.5">
                    {isMissed ? (
                      <PhoneMissed className="w-3 h-3 text-red-500 shrink-0" />
                    ) : isOutgoing ? (
                      <PhoneOutgoing className="w-3 h-3 text-emerald-500 shrink-0" />
                    ) : (
                      <PhoneIncoming className="w-3 h-3 text-brand shrink-0" />
                    )}
                    <span className="capitalize">
                      {isOutgoing ? 'Outgoing' : 'Incoming'} {c.callType} · {c.status}
                    </span>
                    {typeof c.durationSeconds === 'number' && c.durationSeconds > 0 && (
                      <span className="font-mono tabular-nums">· {formatDurationClock(c.durationSeconds)}</span>
                    )}
                    <span>· {formatRelativeTime(c.createdAt)}</span>
                  </div>
                </div>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    startCall({
                      conversationId: c.conversationId,
                      callType: c.callType,
                      callee: { uid: peerUid, displayName: peerName, avatarUrl: peerAvatar },
                    })
                  }
                  aria-label={`Call back ${peerName}`}
                  title={`Call back (${c.callType})`}
                  className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-brand flex items-center justify-center"
                >
                  {c.callType === 'video' ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(c.id)}
                  aria-label="Delete call log entry"
                  title="Delete from call history"
                  className="h-9 w-9 rounded-full hover:bg-red-50 dark:hover:bg-red-950/30 text-neutral-400 hover:text-red-600 flex items-center justify-center"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
