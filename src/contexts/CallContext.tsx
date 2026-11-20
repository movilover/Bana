import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type {
  CallRecord,
  CallType,
  CallingConfigSnapshot,
  CallingProviderId,
  GroupCallParticipant,
  GroupCallRecord,
  GroupCallSignal,
  NetworkQualityStats,
} from '@/src/types/calling';
import {
  CALL_RING_TIMEOUT_MS,
  acquireLocalCallMedia,
  answerWebRTCCall,
  checkPairBlockedAndPrivacy,
  createConfiguredPeerConnection,
  createGroupCallRoom,
  dispatchMissedCallNotification,
  endGroupCallRoomDoc,
  fetchCallingConfig,
  fetchEffectiveIceServers,
  initiateWebRTCCall,
  joinGroupCallRoomDoc,
  kickGroupParticipantDoc,
  leaveGroupCallRoomDoc,
  sendGroupSignalDoc,
  subscribeCallSignaling,
  subscribeGroupCallRoom,
  subscribeIncomingCalls,
  subscribeIncomingGroupCalls,
  triggerIceRestart,
  updateCallStatus,
  updateGroupParticipantState,
} from '@/src/lib/webrtcCalling';
import {
  acquireScreenShareStream,
  adaptVideoSenderBitrate,
  createAudioLevelMonitor,
  samplePeerNetworkQuality,
} from '@/src/lib/calling/webrtcQualityAndSpeaker';
import { realtimeSocket } from '@/src/lib/calling/realtimeClient';
import { requestCallingSessionCredentials } from '@/src/lib/calling/callingProvider';

interface StartCallInput {
  conversationId: string;
  callType: CallType;
  callee: { uid: string; displayName: string; avatarUrl?: string };
}

interface StartGroupCallInput {
  conversationId: string;
  conversationName: string;
  callType: CallType;
  participantIds: string[];
}

interface CallContextValue {
  callingConfig: CallingConfigSnapshot | null;
  activeProviderId: CallingProviderId;
  activeCall: CallRecord | null;
  incomingCall: CallRecord | null;
  waitingCall: CallRecord | null;
  activeGroupCall: GroupCallRecord | null;
  incomingGroupInvite: GroupCallRecord | null;
  activeGroupRoomsByConversation: Record<string, GroupCallRecord>;
  groupParticipants: GroupCallParticipant[];
  activeSpeakerUid: string | null;
  callError: string | null;
  callDurationSeconds: number;
  micMuted: boolean;
  camOff: boolean;
  isScreenSharing: boolean;
  facingMode: 'user' | 'environment';
  audioOutputs: MediaDeviceInfo[];
  selectedOutputId: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  turnConfigured: boolean;
  networkQuality: NetworkQualityStats | null;
  startCall: (input: StartCallInput) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  acceptWaitingCall: () => Promise<void>;
  rejectWaitingCall: () => Promise<void>;
  endActiveCall: () => Promise<void>;
  startGroupCall: (input: StartGroupCallInput) => Promise<void>;
  joinGroupCall: (room: GroupCallRecord) => Promise<void>;
  declineGroupInvite: () => void;
  leaveGroupCall: () => Promise<void>;
  endGroupCallForAll: () => Promise<void>;
  muteGroupParticipant: (targetUid: string) => Promise<void>;
  kickGroupParticipant: (targetUid: string) => Promise<void>;
  toggleMic: () => void;
  toggleCam: () => void;
  flipCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  selectAudioOutput: (deviceId: string) => void;
  clearCallError: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, profile, settings, platformSettings } = useAuth();
  const toast = useToast();

  const [callingConfig, setCallingConfig] = useState<CallingConfigSnapshot | null>(null);
  const [activeCall, setActiveCall] = useState<CallRecord | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallRecord | null>(null);
  const [waitingCall, setWaitingCall] = useState<CallRecord | null>(null);

  const [activeGroupCall, setActiveGroupCall] = useState<GroupCallRecord | null>(null);
  const [incomingGroupInvite, setIncomingGroupInvite] = useState<GroupCallRecord | null>(null);
  const [activeGroupRoomsByConversation, setActiveGroupRoomsByConversation] = useState<Record<string, GroupCallRecord>>({});
  const [groupParticipants, setGroupParticipants] = useState<GroupCallParticipant[]>([]);
  const [activeSpeakerUid, setActiveSpeakerUid] = useState<string | null>(null);

  const [callError, setCallError] = useState<string | null>(null);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutputId, setSelectedOutputId] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [turnConfigured, setTurnConfigured] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<NetworkQualityStats | null>(null);

  // Refs for stable callbacks/closures
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const groupPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const iceServersRef = useRef<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackBeforeScreenRef = useRef<MediaStreamTrack | null>(null);
  const activeCallRef = useRef<CallRecord | null>(null);
  const activeGroupRef = useRef<GroupCallRecord | null>(null);
  const callUnsubRef = useRef<(() => void) | null>(null);
  const groupUnsubRef = useRef<(() => void) | null>(null);
  const audioMonitorStopRef = useRef<(() => void) | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const ringTimerRef = useRef<number | null>(null);
  const maxDurationTimerRef = useRef<number | null>(null);
  const ringToneTimerRef = useRef<number | null>(null);
  const iceRestartAttemptedRef = useRef(false);
  const dismissedGroupRoomIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    activeGroupRef.current = activeGroupCall;
  }, [activeGroupCall]);

  const stopRingtone = useCallback(() => {
    if (ringToneTimerRef.current) {
      window.clearInterval(ringToneTimerRef.current);
      ringToneTimerRef.current = null;
    }
  }, []);

  const playGentleRingtone = useCallback(() => {
    if (settings?.messengerSoundEnabled === false) return;
    stopRingtone();
    const beep = () => {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.36);
        window.setTimeout(() => ctx.close().catch(() => {}), 450);
      } catch {
        // Ignore browser autoplay block until user interacts
      }
    };
    beep();
    ringToneTimerRef.current = window.setInterval(beep, 2400);
  }, [settings?.messengerSoundEnabled, stopRingtone]);

  const refreshAudioOutputs = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioOutputs(devices.filter((d) => d.kind === 'audiooutput'));
    } catch {
      setAudioOutputs([]);
    }
  }, []);

  const stopScreenShareInternal = useCallback(async (restoreCamera: boolean) => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);

    if (restoreCamera && localStreamRef.current) {
      const prevCamTrack = cameraTrackBeforeScreenRef.current;
      const peers: RTCPeerConnection[] = [];
      if (pcRef.current) peers.push(pcRef.current);
      groupPeersRef.current.forEach((p) => peers.push(p));

      for (const pc of peers) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(prevCamTrack || null).catch(() => {});
        }
      }

      localStreamRef.current.getVideoTracks().forEach((t) => {
        if (t !== prevCamTrack) {
          localStreamRef.current?.removeTrack(t);
          t.stop();
        }
      });
      if (prevCamTrack && !localStreamRef.current.getVideoTracks().includes(prevCamTrack)) {
        localStreamRef.current.addTrack(prevCamTrack);
      }
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
    }
    cameraTrackBeforeScreenRef.current = null;

    if (activeGroupRef.current && firebaseUser) {
      updateGroupParticipantState(activeGroupRef.current.id, firebaseUser.uid, {
        screenSharing: false,
      });
      realtimeSocket.send({
        type: 'screen:toggle',
        roomId: activeGroupRef.current.id,
        screenSharing: false,
      });
    }
  }, [firebaseUser]);

  const cleanupCallMedia = useCallback(() => {
    stopRingtone();
    if (ringTimerRef.current) {
      window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      window.clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    if (statsTimerRef.current) {
      window.clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    audioMonitorStopRef.current?.();
    audioMonitorStopRef.current = null;

    callUnsubRef.current?.();
    callUnsubRef.current = null;
    groupUnsubRef.current?.();
    groupUnsubRef.current = null;

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    cameraTrackBeforeScreenRef.current = null;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    groupPeersRef.current.forEach((pc) => pc.close());
    groupPeersRef.current.clear();

    iceRestartAttemptedRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    setRemoteStreams({});
    setGroupParticipants([]);
    setActiveSpeakerUid(null);
    setNetworkQuality(null);
    setIsScreenSharing(false);
    setMicMuted(false);
    setCamOff(false);
    setFacingMode('user');
    setCallDurationSeconds(0);
  }, [stopRingtone]);

  useEffect(() => {
    return () => cleanupCallMedia();
  }, [cleanupCallMedia]);

  // Call duration timer while connected or in active group room
  useEffect(() => {
    if (activeCall?.status !== 'connected' && !activeGroupCall) return;
    const id = window.setInterval(() => {
      setCallDurationSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [activeCall?.status, activeGroupCall]);

  // Network quality monitor & adaptive bitrate for active WebRTC calls
  useEffect(() => {
    if (activeCall?.status !== 'connected' && !activeGroupCall) {
      if (statsTimerRef.current) {
        window.clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
      }
      return;
    }

    statsTimerRef.current = window.setInterval(async () => {
      const targetPc = pcRef.current || Array.from(groupPeersRef.current.values())[0];
      if (!targetPc) return;
      const sample = await samplePeerNetworkQuality(targetPc);
      const adapted = await adaptVideoSenderBitrate(targetPc, sample.level);
      setNetworkQuality({
        ...sample,
        adaptedVideoMaxBitrateKbps: adapted || undefined,
      });
    }, 4000);

    return () => {
      if (statsTimerRef.current) {
        window.clearInterval(statsTimerRef.current);
        statsTimerRef.current = null;
      }
    };
  }, [activeCall?.status, activeGroupCall]);

  // Active speaker identification via AnalyserNode + remote participant state
  useEffect(() => {
    if (!activeGroupCall || !firebaseUser) return;
    if (localStreamRef.current) {
      audioMonitorStopRef.current?.();
      audioMonitorStopRef.current = createAudioLevelMonitor(
        localStreamRef.current,
        (speaking, level) => {
          updateGroupParticipantState(activeGroupCall.id, firebaseUser.uid, {
            speaking,
            audioLevel: level,
          });
          realtimeSocket.send({
            type: 'speaker:level',
            roomId: activeGroupCall.id,
            speaking,
          });
        }
      );
    }
    return () => {
      audioMonitorStopRef.current?.();
      audioMonitorStopRef.current = null;
    };
  }, [activeGroupCall?.id, firebaseUser]);

  useEffect(() => {
    if (!activeGroupCall) {
      setActiveSpeakerUid(null);
      return;
    }
    const speaking = [...groupParticipants]
      .filter((p) => p.speaking && !p.micMuted)
      .sort((a, b) => (b.audioLevel || 0) - (a.audioLevel || 0));
    if (speaking[0]) {
      setActiveSpeakerUid(speaking[0].uid);
    } else if (groupParticipants.some((p) => p.screenSharing)) {
      setActiveSpeakerUid(groupParticipants.find((p) => p.screenSharing)!.uid);
    }
  }, [groupParticipants, activeGroupCall]);

  // Global incoming 1-to-1 and group call listeners + optional WebSocket connect
  useEffect(() => {
    if (!firebaseUser) {
      setIncomingCall(null);
      setWaitingCall(null);
      setActiveCall(null);
      setIncomingGroupInvite(null);
      setActiveGroupCall(null);
      setActiveGroupRoomsByConversation({});
      realtimeSocket.disconnect();
      cleanupCallMedia();
      return;
    }

    fetchCallingConfig().then(setCallingConfig).catch(() => {});
    if (realtimeSocket.isAvailable()) {
      void realtimeSocket.connect(profile?.displayName);
    }

    const unsubOneToOne = subscribeIncomingCalls(firebaseUser.uid, (call) => {
      if (!call) {
        setIncomingCall(null);
        setWaitingCall(null);
        stopRingtone();
        return;
      }
      if (activeCallRef.current || activeGroupRef.current) {
        if (activeCallRef.current?.id !== call.id) {
          // Call Waiting Queue instead of silent drop
          setWaitingCall(call);
          toast.info(`Call waiting: ${call.callerName} is calling.`);
        }
        return;
      }

      setIncomingCall(call);
      playGentleRingtone();

      if (
        typeof document !== 'undefined' &&
        document.hidden &&
        settings?.callNotificationsEnabled !== false &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(`Incoming ${call.callType === 'video' ? 'Video' : 'Voice'} Call`, {
            body: `${call.callerName} is calling you on BANA Messenger`,
          });
        } catch {
          // Ignore Notification constructor errors
        }
      }
    });

    const unsubGroup = subscribeIncomingGroupCalls(firebaseUser.uid, (rooms) => {
      const byConv: Record<string, GroupCallRecord> = {};
      rooms.forEach((r) => {
        byConv[r.conversationId] = r;
      });
      setActiveGroupRoomsByConversation(byConv);

      const invite = rooms.find(
        (r) =>
          r.hostId !== firebaseUser.uid &&
          !r.activeParticipantIds.includes(firebaseUser.uid) &&
          !dismissedGroupRoomIdsRef.current.has(r.id)
      );
      if (invite && !activeCallRef.current && !activeGroupRef.current) {
        setIncomingGroupInvite(invite);
        playGentleRingtone();
      } else if (!invite) {
        setIncomingGroupInvite(null);
      }
    });

    return () => {
      unsubOneToOne();
      unsubGroup();
      stopRingtone();
    };
  }, [firebaseUser, profile?.displayName, playGentleRingtone, stopRingtone, cleanupCallMedia, settings?.callNotificationsEnabled, toast]);

  const attachPeerHandlers = useCallback(
    (callId: string, pc: RTCPeerConnection, isCaller: boolean) => {
      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream) setRemoteStream(stream);
      };

      pc.onconnectionstatechange = async () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          iceRestartAttemptedRef.current = false;
          setCallError(null);
          if (activeCallRef.current?.status === 'reconnecting') {
            await updateCallStatus(callId, 'connected');
          }
        } else if (state === 'disconnected') {
          if (isCaller && !iceRestartAttemptedRef.current) {
            iceRestartAttemptedRef.current = true;
            setCallError('Network interrupted — attempting WebRTC ICE restart...');
            await triggerIceRestart(callId, pc).catch(() => {});
          }
        } else if (state === 'failed') {
          const msg =
            'Peer-to-peer media connection failed (configure Coturn TURN on backend for strict NAT/firewalls).';
          setCallError(msg);
          await updateCallStatus(callId, 'failed', { endReason: 'ice_failed' });
        }
      };
    },
    []
  );

  // Create or return peer connection inside Group WebRTC Mesh
  const ensureGroupPeerConnection = useCallback(
    async (roomId: string, remoteUid: string, shouldOffer: boolean) => {
      if (!firebaseUser || remoteUid === firebaseUser.uid) return null;
      const existing = groupPeersRef.current.get(remoteUid);
      if (existing) return existing;

      const pc = createConfiguredPeerConnection(iceServersRef.current);
      groupPeersRef.current.set(remoteUid, pc);

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream) {
          setRemoteStreams((prev) => ({ ...prev, [remoteUid]: stream }));
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const candPayload = {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid ?? null,
            sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
          };
          sendGroupSignalDoc(roomId, {
            fromUid: firebaseUser.uid,
            toUid: remoteUid,
            kind: 'ice',
            ...candPayload,
          }).catch(() => {});
          realtimeSocket.send({
            type: 'signal:ice',
            roomId,
            toUid: remoteUid,
            candidate: candPayload,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
          setRemoteStreams((prev) => {
            const copy = { ...prev };
            delete copy[remoteUid];
            return copy;
          });
        }
      };

      if (shouldOffer) {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);
        await sendGroupSignalDoc(roomId, {
          fromUid: firebaseUser.uid,
          toUid: remoteUid,
          kind: 'offer',
          sdpType: offer.type as 'offer',
          sdp: offer.sdp || '',
        }).catch(() => {});
        realtimeSocket.send({
          type: 'signal:offer',
          roomId,
          toUid: remoteUid,
          sdp: { type: offer.type, sdp: offer.sdp },
        });
      }

      return pc;
    },
    [firebaseUser]
  );

  const wireGroupRoomSession = useCallback(
    (room: GroupCallRecord) => {
      if (!firebaseUser) return;
      groupUnsubRef.current?.();

      groupUnsubRef.current = subscribeGroupCallRoom(room.id, firebaseUser.uid, {
        onRoom: (updatedRoom) => {
          if (!updatedRoom || updatedRoom.status === 'ended') {
            cleanupCallMedia();
            setActiveGroupCall(null);
            toast.info('Group call ended.');
            return;
          }
          setActiveGroupCall(updatedRoom);
        },
        onParticipants: async (parts) => {
          setGroupParticipants(parts);
          const meInRoom = parts.find((p) => p.uid === firebaseUser.uid);
          if (!meInRoom && activeGroupRef.current?.id === room.id && parts.length > 0) {
            // Host removed me
            cleanupCallMedia();
            setActiveGroupCall(null);
            toast.info('You were removed from the group call.');
            return;
          }
          if (meInRoom?.forcedMutedByHost && localStreamRef.current) {
            setMicMuted(true);
            localStreamRef.current.getAudioTracks().forEach((t) => {
              t.enabled = false;
            });
          }

          // Connect mesh peers deterministically: lower UID initiates offer
          for (const p of parts) {
            if (p.uid !== firebaseUser.uid && !groupPeersRef.current.has(p.uid)) {
              const iShouldOffer = firebaseUser.uid < p.uid;
              await ensureGroupPeerConnection(room.id, p.uid, iShouldOffer);
            }
          }

          // Prune peers who left
          const activeSet = new Set(parts.map((p) => p.uid));
          for (const [peerUid, peerPc] of groupPeersRef.current.entries()) {
            if (!activeSet.has(peerUid)) {
              peerPc.close();
              groupPeersRef.current.delete(peerUid);
              setRemoteStreams((prev) => {
                const copy = { ...prev };
                delete copy[peerUid];
                return copy;
              });
            }
          }
        },
        onSignal: async (sig: GroupCallSignal) => {
          if (sig.fromUid === firebaseUser.uid) return;
          const pc = await ensureGroupPeerConnection(room.id, sig.fromUid, false);
          if (!pc) return;

          if (sig.kind === 'offer' && sig.sdp) {
            await pc.setRemoteDescription(
              new RTCSessionDescription({ type: 'offer', sdp: sig.sdp })
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendGroupSignalDoc(room.id, {
              fromUid: firebaseUser.uid,
              toUid: sig.fromUid,
              kind: 'answer',
              sdpType: 'answer',
              sdp: answer.sdp || '',
            }).catch(() => {});
          } else if (sig.kind === 'answer' && sig.sdp) {
            if (pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(
                new RTCSessionDescription({ type: 'answer', sdp: sig.sdp })
              ).catch(() => {});
            }
          } else if (sig.kind === 'ice' && sig.candidate) {
            await pc.addIceCandidate(
              new RTCIceCandidate({
                candidate: sig.candidate,
                sdpMid: sig.sdpMid ?? undefined,
                sdpMLineIndex: sig.sdpMLineIndex ?? undefined,
              })
            ).catch(() => {});
          }
        },
      });
    },
    [firebaseUser, cleanupCallMedia, ensureGroupPeerConnection, toast]
  );

  const startCall = async ({ conversationId, callType, callee }: StartCallInput) => {
    if (!firebaseUser || !profile) return;
    if (activeCallRef.current || activeGroupRef.current) {
      toast.info('Finish or hold your current call before starting a new one.');
      return;
    }

    setCallError(null);
    const cfg = callingConfig || (await fetchCallingConfig());
    if (platformSettings.enableCalling === false || !cfg.webrtcEnabled) {
      toast.info('Voice & video calling is disabled in Platform Admin Settings.');
      return;
    }
    if (callType === 'audio' && !cfg.allowVoiceCalls) {
      toast.info('Voice calling is currently disabled by administrators.');
      return;
    }
    if (callType === 'video' && !cfg.allowVideoCalls) {
      toast.info('Video calling is currently disabled by administrators.');
      return;
    }

    if (cfg.activeCallingProvider !== 'webrtc_builtin') {
      const cred = await requestCallingSessionCredentials({
        providerId: cfg.activeCallingProvider,
        roomName: `dm_${conversationId}`,
        displayName: profile.displayName,
      });
      if (!cred.configured) {
        toast.info(`${cred.message || 'External provider unconfigured'} — using built-in WebRTC.`);
      }
    }

    const privacy = await checkPairBlockedAndPrivacy(firebaseUser.uid, callee.uid, 'call');
    if (privacy.status === 'blocked' || privacy.status === 'denied') {
      toast.error(privacy.reason || 'You cannot call this user.');
      return;
    }

    try {
      const [{ iceServers, turnConfigured: hasTurn }, stream] = await Promise.all([
        fetchEffectiveIceServers(cfg),
        acquireLocalCallMedia(callType, 'user'),
      ]);

      iceServersRef.current = iceServers;
      setTurnConfigured(hasTurn);
      localStreamRef.current = stream;
      setLocalStream(stream);
      refreshAudioOutputs();

      const { callId, pc } = await initiateWebRTCCall({
        conversationId,
        callType,
        caller: {
          uid: firebaseUser.uid,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        },
        callee,
        localStream: stream,
        iceServers,
      });
      pcRef.current = pc;
      attachPeerHandlers(callId, pc, true);

      const initialRecord: CallRecord = {
        id: callId,
        conversationId,
        callType,
        providerId: cfg.activeCallingProvider,
        callerId: firebaseUser.uid,
        callerName: profile.displayName,
        callerAvatar: profile.avatarUrl,
        calleeId: callee.uid,
        calleeName: callee.displayName,
        calleeAvatar: callee.avatarUrl,
        status: 'calling',
        expiresAtMs: Date.now() + CALL_RING_TIMEOUT_MS,
      };
      setActiveCall(initialRecord);

      ringTimerRef.current = window.setTimeout(async () => {
        if (activeCallRef.current?.id === callId && activeCallRef.current.status === 'calling') {
          await updateCallStatus(callId, 'missed', { endReason: 'no_answer' });
          await dispatchMissedCallNotification({
            recipientId: callee.uid,
            caller: {
              uid: firebaseUser.uid,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
            },
            callType,
            conversationId,
            callId,
          });
          cleanupCallMedia();
          setActiveCall(null);
          toast.info(`${callee.displayName} did not answer.`);
        }
      }, CALL_RING_TIMEOUT_MS);

      const maxMin = Math.max(5, Number(cfg.maxCallDurationMinutes || 60));
      maxDurationTimerRef.current = window.setTimeout(async () => {
        if (activeCallRef.current?.id === callId) {
          await updateCallStatus(callId, 'ended', {
            endReason: 'max_duration_reached',
            durationSeconds: maxMin * 60,
          });
          cleanupCallMedia();
          setActiveCall(null);
          toast.info(`Call ended after ${maxMin} minute limit.`);
        }
      }, maxMin * 60 * 1000);

      callUnsubRef.current = subscribeCallSignaling(
        callId,
        firebaseUser.uid,
        pc,
        undefined,
        (updated) => {
          setActiveCall(updated);
          if (updated.status === 'connected' && ringTimerRef.current) {
            window.clearTimeout(ringTimerRef.current);
            ringTimerRef.current = null;
          }
          if (['ended', 'rejected', 'missed', 'failed'].includes(updated.status)) {
            cleanupCallMedia();
            if (updated.endReason === 'busy') {
              toast.info(`${callee.displayName} is busy on another call.`);
            } else if (updated.status === 'rejected') {
              toast.info(`${callee.displayName} declined the call.`);
            } else if (updated.status === 'missed') {
              toast.info('Call went unanswered.');
            } else {
              toast.info(`Call ${updated.status}.`);
            }
            setActiveCall(null);
          }
        }
      );
    } catch (err: any) {
      cleanupCallMedia();
      setCallError(err?.message || 'Unable to start call.');
      toast.error(err?.message || 'Unable to start call.');
    }
  };

  const acceptCallRecord = async (callToAnswer: CallRecord) => {
    if (!firebaseUser) return;
    stopRingtone();
    setCallError(null);

    try {
      const cfg = callingConfig || (await fetchCallingConfig());
      const [{ iceServers, turnConfigured: hasTurn }, stream] = await Promise.all([
        fetchEffectiveIceServers(cfg),
        acquireLocalCallMedia(callToAnswer.callType, 'user'),
      ]);

      iceServersRef.current = iceServers;
      setTurnConfigured(hasTurn);
      localStreamRef.current = stream;
      setLocalStream(stream);
      refreshAudioOutputs();

      const pc = await answerWebRTCCall({
        call: callToAnswer,
        uid: firebaseUser.uid,
        localStream: stream,
        iceServers,
      });
      pcRef.current = pc;
      attachPeerHandlers(callToAnswer.id, pc, false);

      setActiveCall({ ...callToAnswer, status: 'connected' });
      setIncomingCall(null);

      callUnsubRef.current = subscribeCallSignaling(
        callToAnswer.id,
        firebaseUser.uid,
        pc,
        callToAnswer.offer?.sdp,
        (updated) => {
          setActiveCall(updated);
          if (['ended', 'rejected', 'missed', 'failed'].includes(updated.status)) {
            cleanupCallMedia();
            setActiveCall(null);
          }
        }
      );
    } catch (err: any) {
      cleanupCallMedia();
      setCallError(err?.message || 'Could not answer call.');
      toast.error(err?.message || 'Could not answer call.');
    }
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) return;
    await acceptCallRecord(incomingCall);
  };

  const rejectIncomingCall = async () => {
    if (!incomingCall) return;
    stopRingtone();
    await updateCallStatus(incomingCall.id, 'rejected', { endReason: 'declined_by_callee' });
    setIncomingCall(null);
  };

  const acceptWaitingCall = async () => {
    if (!waitingCall) return;
    const nextCall = waitingCall;
    setWaitingCall(null);

    if (activeCallRef.current) {
      await updateCallStatus(activeCallRef.current.id, 'ended', {
        endReason: 'switched_to_waiting_call',
        durationSeconds: callDurationSeconds,
      });
      setActiveCall(null);
    }
    if (activeGroupRef.current && firebaseUser) {
      await leaveGroupCallRoomDoc(activeGroupRef.current.id, firebaseUser.uid);
      setActiveGroupCall(null);
    }
    cleanupCallMedia();
    await acceptCallRecord(nextCall);
  };

  const rejectWaitingCall = async () => {
    if (!waitingCall) return;
    await updateCallStatus(waitingCall.id, 'rejected', { endReason: 'busy' });
    setWaitingCall(null);
  };

  const endActiveCall = async () => {
    const current = activeCallRef.current;
    const elapsed = callDurationSeconds;
    if (current && firebaseUser && profile) {
      const isUnansweredCaller = current.status === 'calling' && current.callerId === firebaseUser.uid;
      await updateCallStatus(current.id, isUnansweredCaller ? 'missed' : 'ended', {
        endReason: isUnansweredCaller ? 'cancelled_by_caller' : 'hangup',
        durationSeconds: elapsed,
      });
      if (isUnansweredCaller) {
        await dispatchMissedCallNotification({
          recipientId: current.calleeId,
          caller: {
            uid: firebaseUser.uid,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
          },
          callType: current.callType,
          conversationId: current.conversationId,
          callId: current.id,
        });
      }
    }
    cleanupCallMedia();
    setActiveCall(null);
    setCallError(null);
  };

  const startGroupCall = async ({
    conversationId,
    conversationName,
    callType,
    participantIds,
  }: StartGroupCallInput) => {
    if (!firebaseUser || !profile) return;
    if (activeCallRef.current || activeGroupRef.current) {
      toast.info('Leave your current call before starting a group call.');
      return;
    }

    const cfg = callingConfig || (await fetchCallingConfig());
    if (platformSettings.enableCalling === false || !cfg.webrtcEnabled || !cfg.allowGroupCalls) {
      toast.info('Group calling is currently disabled in Platform Admin Settings.');
      return;
    }

    try {
      const [{ iceServers, turnConfigured: hasTurn }, stream] = await Promise.all([
        fetchEffectiveIceServers(cfg),
        acquireLocalCallMedia(callType, 'user'),
      ]);

      iceServersRef.current = iceServers;
      setTurnConfigured(hasTurn);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCamOff(callType === 'audio');
      refreshAudioOutputs();

      const room = await createGroupCallRoom({
        conversationId,
        conversationName,
        callType,
        providerId: cfg.activeCallingProvider,
        host: {
          uid: firebaseUser.uid,
          displayName: profile.displayName,
          username: profile.username,
          avatarUrl: profile.avatarUrl,
        },
        invitedParticipantIds: participantIds,
        maxParticipants: cfg.maxGroupCallParticipants,
      });

      realtimeSocket.send({
        type: 'room:join',
        roomId: room.id,
        conversationId,
        hostUid: firebaseUser.uid,
        callType,
        maxParticipants: cfg.maxGroupCallParticipants,
        displayName: profile.displayName,
      });

      setActiveGroupCall(room);
      wireGroupRoomSession(room);
    } catch (err: any) {
      cleanupCallMedia();
      setCallError(err?.message || 'Could not start group call.');
      toast.error(err?.message || 'Could not start group call.');
    }
  };

  const joinGroupCall = async (room: GroupCallRecord) => {
    if (!firebaseUser || !profile) return;
    if (activeCallRef.current || activeGroupRef.current) {
      toast.info('Finish your current call before joining a group call.');
      return;
    }
    if (room.activeParticipantIds.length >= room.maxParticipants) {
      toast.error(`This group call has reached its limit of ${room.maxParticipants} participants.`);
      return;
    }

    stopRingtone();
    try {
      const cfg = callingConfig || (await fetchCallingConfig());
      const [{ iceServers, turnConfigured: hasTurn }, stream] = await Promise.all([
        fetchEffectiveIceServers(cfg),
        acquireLocalCallMedia(room.callType, 'user'),
      ]);

      iceServersRef.current = iceServers;
      setTurnConfigured(hasTurn);
      localStreamRef.current = stream;
      setLocalStream(stream);
      setCamOff(room.callType === 'audio');
      refreshAudioOutputs();

      await joinGroupCallRoomDoc({
        roomId: room.id,
        user: {
          uid: firebaseUser.uid,
          displayName: profile.displayName,
          username: profile.username,
          avatarUrl: profile.avatarUrl,
        },
        callType: room.callType,
      });

      realtimeSocket.send({
        type: 'room:join',
        roomId: room.id,
        conversationId: room.conversationId,
        hostUid: room.hostId,
        callType: room.callType,
        maxParticipants: room.maxParticipants,
        displayName: profile.displayName,
      });

      setIncomingGroupInvite(null);
      setActiveGroupCall(room);
      wireGroupRoomSession(room);
    } catch (err: any) {
      cleanupCallMedia();
      setCallError(err?.message || 'Could not join group call.');
      toast.error(err?.message || 'Could not join group call.');
    }
  };

  const declineGroupInvite = () => {
    if (!incomingGroupInvite) return;
    dismissedGroupRoomIdsRef.current.add(incomingGroupInvite.id);
    stopRingtone();
    setIncomingGroupInvite(null);
  };

  const leaveGroupCall = async () => {
    const room = activeGroupRef.current;
    if (room && firebaseUser) {
      await leaveGroupCallRoomDoc(room.id, firebaseUser.uid);
      realtimeSocket.send({ type: 'room:leave', roomId: room.id });
    }
    cleanupCallMedia();
    setActiveGroupCall(null);
  };

  const endGroupCallForAll = async () => {
    const room = activeGroupRef.current;
    if (room && firebaseUser && room.hostId === firebaseUser.uid) {
      await endGroupCallRoomDoc(room.id, 'host_ended');
      realtimeSocket.send({ type: 'room:end', roomId: room.id });
    }
    cleanupCallMedia();
    setActiveGroupCall(null);
  };

  const muteGroupParticipant = async (targetUid: string) => {
    const room = activeGroupRef.current;
    if (!room || !firebaseUser || room.hostId !== firebaseUser.uid) return;
    await updateGroupParticipantState(room.id, targetUid, {
      micMuted: true,
      forcedMutedByHost: true,
    });
    realtimeSocket.send({ type: 'participant:mute', roomId: room.id, targetUid });
    toast.info('Participant muted.');
  };

  const kickGroupParticipant = async (targetUid: string) => {
    const room = activeGroupRef.current;
    if (!room || !firebaseUser || room.hostId !== firebaseUser.uid) return;
    await kickGroupParticipantDoc(room.id, targetUid);
    realtimeSocket.send({ type: 'participant:kick', roomId: room.id, targetUid });
    toast.info('Participant removed from group call.');
  };

  const toggleMic = () => {
    const next = !micMuted;
    setMicMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    if (activeGroupRef.current && firebaseUser) {
      updateGroupParticipantState(activeGroupRef.current.id, firebaseUser.uid, {
        micMuted: next,
        forcedMutedByHost: false,
      });
      realtimeSocket.send({
        type: 'room:media_state',
        roomId: activeGroupRef.current.id,
        micMuted: next,
      });
    }
  };

  const toggleCam = () => {
    const next = !camOff;
    setCamOff(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    if (activeGroupRef.current && firebaseUser) {
      updateGroupParticipantState(activeGroupRef.current.id, firebaseUser.uid, { camOff: next });
      realtimeSocket.send({
        type: 'room:media_state',
        roomId: activeGroupRef.current.id,
        camOff: next,
      });
    }
  };

  const flipCamera = async () => {
    if (!localStreamRef.current) return;
    const isVideoCall = activeCallRef.current?.callType === 'video' || activeGroupRef.current?.callType === 'video';
    if (!isVideoCall) return;

    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newTrack = newVideoStream.getVideoTracks()[0];
      if (!newTrack) return;

      newTrack.enabled = !camOff;
      const oldTrack = localStreamRef.current.getVideoTracks()[0];

      const peers: RTCPeerConnection[] = [];
      if (pcRef.current) peers.push(pcRef.current);
      groupPeersRef.current.forEach((p) => peers.push(p));

      for (const pc of peers) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(newTrack).catch(() => {});
      }

      if (oldTrack) {
        localStreamRef.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      localStreamRef.current.addTrack(newTrack);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      setFacingMode(nextFacing);
    } catch {
      toast.info('Second camera is not available on this device.');
    }
  };

  const toggleScreenShare = async () => {
    const cfg = callingConfig || (await fetchCallingConfig());
    if (!cfg.allowScreenSharing) {
      toast.info('Screen sharing is currently disabled in Platform Admin Settings.');
      return;
    }

    if (isScreenSharing) {
      await stopScreenShareInternal(true);
      return;
    }

    if (!localStreamRef.current) return;
    try {
      const screenStream = await acquireScreenShareStream(true);
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        screenStream.getTracks().forEach((t) => t.stop());
        return;
      }

      screenStreamRef.current = screenStream;
      const prevCam = localStreamRef.current.getVideoTracks()[0] || null;
      cameraTrackBeforeScreenRef.current = prevCam;

      const peers: RTCPeerConnection[] = [];
      if (pcRef.current) peers.push(pcRef.current);
      groupPeersRef.current.forEach((p) => peers.push(p));

      for (const pc of peers) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack).catch(() => {});
        } else {
          pc.addTrack(screenTrack, localStreamRef.current);
        }
      }

      if (prevCam) localStreamRef.current.removeTrack(prevCam);
      localStreamRef.current.addTrack(screenTrack);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      setIsScreenSharing(true);

      if (activeGroupRef.current && firebaseUser) {
        updateGroupParticipantState(activeGroupRef.current.id, firebaseUser.uid, {
          screenSharing: true,
        });
        realtimeSocket.send({
          type: 'screen:toggle',
          roomId: activeGroupRef.current.id,
          screenSharing: true,
        });
      }

      screenTrack.onended = () => {
        void stopScreenShareInternal(true);
      };
    } catch (err: any) {
      toast.error(err?.message || 'Unable to start screen sharing.');
    }
  };

  const selectAudioOutput = (deviceId: string) => {
    setSelectedOutputId(deviceId);
  };

  const clearCallError = () => setCallError(null);

  return (
    <CallContext.Provider
      value={{
        callingConfig,
        activeProviderId: callingConfig?.activeCallingProvider || 'webrtc_builtin',
        activeCall,
        incomingCall,
        waitingCall,
        activeGroupCall,
        incomingGroupInvite,
        activeGroupRoomsByConversation,
        groupParticipants,
        activeSpeakerUid,
        callError,
        callDurationSeconds,
        micMuted,
        camOff,
        isScreenSharing,
        facingMode,
        audioOutputs,
        selectedOutputId,
        localStream,
        remoteStream,
        remoteStreams,
        turnConfigured,
        networkQuality,
        startCall,
        acceptIncomingCall,
        rejectIncomingCall,
        acceptWaitingCall,
        rejectWaitingCall,
        endActiveCall,
        startGroupCall,
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
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used inside CallProvider');
  return ctx;
}
