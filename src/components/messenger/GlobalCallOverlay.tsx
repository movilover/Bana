import React, { useEffect, useRef, useState } from 'react';
import {
  Crown,
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneForwarded,
  PhoneOff,
  SwitchCamera,
  UserMinus,
  Users,
  Video,
  VideoOff,
  Volume2,
  Wifi,
} from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { useCall } from '@/src/contexts/CallContext';
import { Avatar } from '@/src/components/common/Avatar';
import { formatDurationClock } from '@/src/lib/videoUtils';

function RemotePeerTile({
  name,
  avatarUrl,
  stream,
  isSpeaker,
  micMuted,
  camOff,
  screenSharing,
  isHost,
  canModerate,
  onMute,
  onKick,
}: {
  name: string;
  avatarUrl?: string;
  stream?: MediaStream | null;
  isSpeaker: boolean;
  micMuted: boolean;
  camOff: boolean;
  screenSharing: boolean;
  isHost: boolean;
  canModerate: boolean;
  onMute: () => void;
  onKick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
    if (audioRef.current) audioRef.current.srcObject = stream || null;
  }, [stream]);

  const hasVideoTrack = Boolean(stream && stream.getVideoTracks().length > 0 && (!camOff || screenSharing));

  return (
    <div
      className={`relative aspect-video rounded-xl overflow-hidden bg-neutral-900 border transition-colors ${
        isSpeaker ? 'border-emerald-400 ring-2 ring-emerald-400/30' : 'border-neutral-800'
      }`}
    >
      {hasVideoTrack ? (
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <Avatar src={avatarUrl} name={name} size="lg" />
          <audio ref={audioRef} autoPlay />
        </div>
      )}

      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-[11px] text-white truncate">
          {isHost && <Crown className="w-3 h-3 text-amber-400 shrink-0" />}
          <span className="truncate">{name}</span>
          {screenSharing && <span className="text-emerald-400 font-semibold">· Screen</span>}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {micMuted && (
            <span className="p-1 rounded-full bg-amber-600/90 text-white" title="Muted">
              <MicOff className="w-3 h-3" />
            </span>
          )}
          {canModerate && (
            <>
              <button
                type="button"
                onClick={onMute}
                title="Host Mute Participant"
                className="p-1 rounded-full bg-black/70 hover:bg-amber-600 text-white"
              >
                <MicOff className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={onKick}
                title="Host Remove Participant"
                className="p-1 rounded-full bg-black/70 hover:bg-red-600 text-white"
              >
                <UserMinus className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function GlobalCallOverlay() {
  const { firebaseUser, profile } = useAuth();
  const {
    activeProviderId,
    activeCall,
    incomingCall,
    waitingCall,
    activeGroupCall,
    incomingGroupInvite,
    groupParticipants,
    activeSpeakerUid,
    callError,
    callDurationSeconds,
    micMuted,
    camOff,
    isScreenSharing,
    audioOutputs,
    selectedOutputId,
    localStream,
    remoteStream,
    remoteStreams,
    turnConfigured,
    networkQuality,
    acceptIncomingCall,
    rejectIncomingCall,
    acceptWaitingCall,
    rejectWaitingCall,
    endActiveCall,
    joinGroupCall,
    declineGroupInvite,
    leaveGroupCall,
    endGroupCallForAll,
    muteGroupParticipant,
    kickGroupParticipant,
    toggleMic,
    toggleCam,
    flipCamera,
    toggleScreenShare,
    selectAudioOutput,
    clearCallError,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [showParticipantsDrawer, setShowParticipantsDrawer] = useState(false);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, activeCall?.id, activeGroupCall?.id]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, activeCall?.id]);

  useEffect(() => {
    if (!selectedOutputId) return;
    const targets: any[] = [remoteAudioRef.current, remoteVideoRef.current].filter(Boolean);
    targets.forEach((el) => {
      if (typeof el.setSinkId === 'function') {
        el.setSinkId(selectedOutputId).catch(() => {});
      }
    });
  }, [selectedOutputId]);

  if (!firebaseUser) return null;

  const peerName = activeCall
    ? activeCall.callerId === firebaseUser.uid
      ? activeCall.calleeName
      : activeCall.callerName
    : 'Call Diagnostics';

  const peerAvatar = activeCall
    ? activeCall.callerId === firebaseUser.uid
      ? activeCall.calleeAvatar
      : activeCall.callerAvatar
    : '';

  const isGroupHost = Boolean(activeGroupCall && activeGroupCall.hostId === firebaseUser.uid);

  const networkBadge = (() => {
    if (!networkQuality || networkQuality.level === 'unknown') {
      return {
        text: turnConfigured ? 'STUN + TURN' : 'WebRTC STUN',
        cls: 'text-neutral-300',
      };
    }
    const rttText = networkQuality.rttMs !== null ? ` · ${networkQuality.rttMs}ms` : '';
    if (networkQuality.level === 'poor') {
      return { text: `Poor${rttText}`, cls: 'text-rose-400' };
    }
    if (networkQuality.level === 'good') {
      return { text: `Good${rttText}`, cls: 'text-amber-300' };
    }
    return { text: `Excellent${rttText}`, cls: 'text-emerald-400' };
  })();

  return (
    <>
      {/* 1. Global Incoming 1-to-1 Call Prompt */}
      {incomingCall && !activeCall && !activeGroupCall && (
        <div
          role="dialog"
          aria-label="Incoming BANA Call"
          className="fixed bottom-20 lg:bottom-6 right-4 left-4 sm:left-auto z-[70] sm:w-88 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl p-4 space-y-3.5"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar src={incomingCall.callerAvatar} name={incomingCall.callerName} size="md" />
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-neutral-950 animate-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-neutral-950 dark:text-white truncate">
                {incomingCall.callerName}
              </p>
              <p className="text-xs text-[#1877F2] font-medium capitalize">
                Incoming {incomingCall.callType} call on BANA...
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={rejectIncomingCall}
              className="h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <PhoneOff className="w-4 h-4" /> Decline
            </button>
            <button
              type="button"
              onClick={acceptIncomingCall}
              className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              {incomingCall.callType === 'video' ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
              Accept
            </button>
          </div>
        </div>
      )}

      {/* 2. Incoming Group Call Invite Prompt */}
      {incomingGroupInvite && !activeCall && !activeGroupCall && (
        <div
          role="dialog"
          aria-label="Incoming Group Call"
          className="fixed bottom-20 lg:bottom-6 right-4 left-4 sm:left-auto z-[70] sm:w-92 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl p-4 space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#1877F2]/15 text-[#1877F2] flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-neutral-950 dark:text-white truncate">
                {incomingGroupInvite.conversationName}
              </p>
              <p className="text-xs text-[#1877F2] font-medium">
                {incomingGroupInvite.hostName} started a group {incomingGroupInvite.callType} call ({incomingGroupInvite.activeParticipantIds.length}/{incomingGroupInvite.maxParticipants})
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={declineGroupInvite}
              className="h-10 rounded-xl border border-neutral-300 dark:border-neutral-700 text-xs font-semibold"
            >
              Ignore
            </button>
            <button
              type="button"
              onClick={() => joinGroupCall(incomingGroupInvite)}
              className="h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
            >
              <Phone className="w-4 h-4" /> Join Call
            </button>
          </div>
        </div>
      )}

      {/* 3. Active 1-to-1 / Group Call Fullscreen Overlay */}
      {(activeCall || activeGroupCall || callError) && (
        <div
          role="dialog"
          aria-label="Active BANA WebRTC Call"
          className="fixed inset-0 z-[75] bg-black/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div
            className={`w-full ${
              activeGroupCall ? 'max-w-4xl' : 'max-w-xl'
            } rounded-2xl border border-neutral-800 bg-neutral-950 text-white p-4 sm:p-5 space-y-4 shadow-2xl`}
          >
            {/* Call Waiting Banner */}
            {waitingCall && (
              <div className="rounded-xl border border-[#1877F2]/50 bg-[#1877F2]/15 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <PhoneForwarded className="w-4 h-4 text-[#1877F2] shrink-0" />
                  <span className="truncate font-semibold">
                    Call waiting from {waitingCall.callerName} ({waitingCall.callType})
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={rejectWaitingCall}
                    className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold"
                  >
                    Decline (Busy)
                  </button>
                  <button
                    type="button"
                    onClick={acceptWaitingCall}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                  >
                    End & Accept
                  </button>
                </div>
              </div>
            )}

            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-display font-bold text-base truncate flex items-center gap-2">
                  {activeGroupCall ? (
                    <>
                      <Users className="w-4 h-4 text-[#1877F2]" />
                      {activeGroupCall.conversationName}
                    </>
                  ) : (
                    peerName
                  )}
                </p>
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <span className="capitalize">
                    {activeGroupCall
                      ? `Group ${activeGroupCall.callType} · ${groupParticipants.length}/${activeGroupCall.maxParticipants} active`
                      : activeCall
                      ? activeCall.status === 'connected'
                        ? `${activeCall.callType} · Connected`
                        : activeCall.status === 'reconnecting'
                        ? 'Reconnecting network...'
                        : activeCall.status === 'calling'
                        ? 'Ringing...'
                        : activeCall.status
                      : 'Connection notice'}
                  </span>
                  {(activeCall?.status === 'connected' || activeGroupCall) && (
                    <span className="font-mono tabular-nums text-emerald-400 font-semibold">
                      {formatDurationClock(callDurationSeconds)}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {activeGroupCall && (
                  <button
                    type="button"
                    onClick={() => setShowParticipantsDrawer((v) => !v)}
                    className="px-2.5 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-semibold inline-flex items-center gap-1 hover:bg-neutral-800"
                  >
                    <Users className="w-3 h-3 text-[#1877F2]" />
                    Participants ({groupParticipants.length})
                  </button>
                )}

                <span
                  title={`Provider: ${activeProviderId}`}
                  className={`inline-flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded-full bg-neutral-900 border border-neutral-800 shrink-0 ${networkBadge.cls}`}
                >
                  <Wifi className="w-3 h-3 text-[#1877F2]" />
                  {networkBadge.text}
                </span>
              </div>
            </div>

            {/* Active Group Call Multi-Participant Grid */}
            {activeGroupCall ? (
              <div className="space-y-3">
                <div
                  className={`grid gap-2.5 ${
                    groupParticipants.length <= 2
                      ? 'grid-cols-1 sm:grid-cols-2'
                      : groupParticipants.length <= 4
                      ? 'grid-cols-2'
                      : 'grid-cols-2 sm:grid-cols-3'
                  }`}
                >
                  {/* Self Tile */}
                  <div
                    className={`relative aspect-video rounded-xl overflow-hidden bg-neutral-900 border ${
                      activeSpeakerUid === firebaseUser.uid
                        ? 'border-emerald-400 ring-2 ring-emerald-400/30'
                        : 'border-neutral-800'
                    }`}
                  >
                    {activeGroupCall.callType === 'video' || isScreenSharing ? (
                      <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                        <Avatar src={profile?.avatarUrl} name={profile?.displayName || 'You'} size="lg" />
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-[11px] text-white">
                        {isGroupHost && <Crown className="w-3 h-3 text-amber-400" />}
                        You {isScreenSharing ? '· Screen' : ''}
                      </span>
                      {micMuted && (
                        <span className="p-1 rounded-full bg-amber-600 text-white">
                          <MicOff className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Remote Group Peers */}
                  {groupParticipants
                    .filter((p) => p.uid !== firebaseUser.uid)
                    .map((p) => (
                      <RemotePeerTile
                        key={p.uid}
                        name={p.displayName}
                        avatarUrl={p.avatarUrl}
                        stream={remoteStreams[p.uid]}
                        isSpeaker={activeSpeakerUid === p.uid}
                        micMuted={p.micMuted}
                        camOff={p.camOff}
                        screenSharing={p.screenSharing}
                        isHost={activeGroupCall.hostId === p.uid}
                        canModerate={isGroupHost}
                        onMute={() => muteGroupParticipant(p.uid)}
                        onKick={() => kickGroupParticipant(p.uid)}
                      />
                    ))}
                </div>

                {showParticipantsDrawer && (
                  <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-3 space-y-2 text-xs max-h-40 overflow-y-auto">
                    <p className="font-semibold text-neutral-300">Room Participants & Host Controls</p>
                    {groupParticipants.map((p) => (
                      <div key={p.uid} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          {p.displayName} {p.uid === activeGroupCall.hostId ? '(Host)' : ''}
                          {p.uid === firebaseUser.uid ? ' (You)' : ''}
                        </span>
                        {isGroupHost && p.uid !== firebaseUser.uid && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => muteGroupParticipant(p.uid)}
                              className="px-2 py-0.5 rounded bg-amber-600 text-white text-[11px]"
                            >
                              Mute
                            </button>
                            <button
                              type="button"
                              onClick={() => kickGroupParticipant(p.uid)}
                              className="px-2 py-0.5 rounded bg-red-600 text-white text-[11px]"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : activeCall?.callType === 'video' || isScreenSharing ? (
              <div className="relative aspect-video rounded-2xl bg-neutral-900 overflow-hidden border border-neutral-800">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                {!remoteStream && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-neutral-900/90">
                    <Avatar src={peerAvatar} name={peerName} size="lg" />
                    <p className="text-xs text-neutral-400">Waiting for remote video stream...</p>
                  </div>
                )}
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-28 h-20 sm:w-32 sm:h-24 object-cover rounded-xl border border-white/25 absolute bottom-3 right-3 bg-black shadow-lg"
                />
              </div>
            ) : (
              <div className="py-8 flex flex-col items-center justify-center gap-3 rounded-2xl bg-neutral-900/60 border border-neutral-800">
                <Avatar src={peerAvatar} name={peerName} size="xl" />
                <p className="text-xs text-neutral-400">
                  {activeCall?.status === 'connected'
                    ? 'End-to-peer WebRTC audio active'
                    : activeCall
                    ? 'Calling via WebRTC...'
                    : 'Call stopped'}
                </p>
                <audio ref={remoteAudioRef} autoPlay />
              </div>
            )}

            {callError && (
              <div className="rounded-xl border border-amber-800/80 bg-amber-950/60 p-3 text-xs text-amber-200 flex items-start justify-between gap-2">
                <span>{callError}</span>
                {!activeCall && !activeGroupCall && (
                  <button type="button" onClick={clearCallError} className="text-amber-300 underline shrink-0">
                    Dismiss
                  </button>
                )}
              </div>
            )}

            {audioOutputs.length > 1 && (activeCall || activeGroupCall) && (
              <div className="flex items-center gap-2 text-xs text-neutral-300">
                <Volume2 className="w-4 h-4 text-neutral-400 shrink-0" />
                <select
                  aria-label="Select audio output speaker"
                  value={selectedOutputId}
                  onChange={(e) => selectAudioOutput(e.target.value)}
                  className="flex-1 h-9 rounded-xl bg-neutral-900 border border-neutral-800 px-2.5 text-xs text-neutral-200"
                >
                  <option value="">Default Audio Output</option>
                  {audioOutputs.map((dev) => (
                    <option key={dev.deviceId} value={dev.deviceId}>
                      {dev.label || `Speaker (${dev.deviceId.slice(0, 6)})`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Controls Bar */}
            <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 pt-1">
              {(activeCall || activeGroupCall) && (
                <>
                  <button
                    type="button"
                    onClick={toggleMic}
                    aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
                    title={micMuted ? 'Unmute mic' : 'Mute mic'}
                    className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
                      micMuted ? 'bg-amber-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-white'
                    }`}
                  >
                    {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>

                  {(activeCall?.callType === 'video' || activeGroupCall?.callType === 'video') && (
                    <>
                      <button
                        type="button"
                        onClick={toggleCam}
                        aria-label={camOff ? 'Turn camera on' : 'Turn camera off'}
                        title={camOff ? 'Turn camera on' : 'Turn camera off'}
                        className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
                          camOff ? 'bg-amber-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-white'
                        }`}
                      >
                        {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                      </button>

                      <button
                        type="button"
                        onClick={flipCamera}
                        aria-label="Switch front or rear camera"
                        title="Flip camera"
                        className="h-12 w-12 rounded-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center transition-colors"
                      >
                        <SwitchCamera className="w-5 h-5" />
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={toggleScreenShare}
                    aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
                    title={isScreenSharing ? 'Stop screen share' : 'Share browser tab, window, or screen'}
                    className={`h-12 w-12 rounded-full flex items-center justify-center transition-colors ${
                      isScreenSharing ? 'bg-emerald-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-white'
                    }`}
                  >
                    <MonitorUp className="w-5 h-5" />
                  </button>
                </>
              )}

              {activeGroupCall ? (
                <>
                  <button
                    type="button"
                    onClick={leaveGroupCall}
                    className="h-12 px-5 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
                  >
                    <PhoneOff className="w-4 h-4" />
                    Leave Call
                  </button>
                  {isGroupHost && (
                    <button
                      type="button"
                      onClick={endGroupCallForAll}
                      className="h-12 px-4 rounded-full bg-rose-900 hover:bg-rose-800 border border-rose-700 text-white text-xs font-semibold"
                    >
                      End Room
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={activeCall ? endActiveCall : clearCallError}
                  className="h-12 px-6 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
                >
                  <PhoneOff className="w-4 h-4" />
                  {activeCall ? 'End Call' : 'Close'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
