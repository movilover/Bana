import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Image as ImageIcon,
  Video,
  Film,
  Mic,
  BarChart2,
  FileText,
  Sparkles,
  MapPin,
  Loader2,
  Plus,
  Trash2,
  FolderOpen,
  Type,
} from 'lucide-react';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  DISCOVERY_CATEGORIES,
  type BanaPost,
  type DiscoveryCategory,
  type PostType,
  type PostVisibility,
} from '@/src/types/bana';
import {
  compressImageFile,
  extractVideoThumbnail,
  formatRelativeTime,
  uploadMediaWithMetadata,
  uploadMediaWithProgress,
} from '@/src/lib/mediaUtils';
import { DEFAULT_RETENTION_POLICY } from '@/src/lib/storage/providerCatalog';
import { inspectAndValidateVideo } from '@/src/lib/videoUtils';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { VoiceRecorder } from '@/src/components/voice/VoiceRecorderAndPlayer';

export type CreateMode = 'text' | 'image' | 'video' | 'reel' | 'story' | 'poll' | 'voice';

interface CreateModalProps {
  isOpen: boolean;
  initialMode?: CreateMode;
  communityId?: string;
  communityName?: string;
  onClose: () => void;
  onCreated?: () => void;
}

const MODES: { id: CreateMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'text', label: 'Post', icon: FileText },
  { id: 'image', label: 'Photos', icon: ImageIcon },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'reel', label: 'Reel', icon: Film },
  { id: 'story', label: 'Story', icon: Sparkles },
  { id: 'poll', label: 'Poll', icon: BarChart2 },
  { id: 'voice', label: 'Voice', icon: Mic },
];

const STORY_GRADIENTS = [
  { id: 'royal', label: 'Royal Blue', cls: 'bg-gradient-to-br from-[#1877F2] via-blue-600 to-indigo-700' },
  { id: 'sunset', label: 'Sunset', cls: 'bg-gradient-to-br from-rose-500 via-pink-600 to-amber-500' },
  { id: 'emerald', label: 'Dhaka Green', cls: 'bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700' },
  { id: 'midnight', label: 'Midnight', cls: 'bg-gradient-to-br from-neutral-900 via-slate-800 to-neutral-950' },
];

export function CreateModal({
  isOpen,
  initialMode = 'text',
  communityId,
  communityName,
  onClose,
  onCreated,
}: CreateModalProps) {
  const { firebaseUser, profile } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<CreateMode>(initialMode);
  const [storyKind, setStoryKind] = useState<'media' | 'text'>('media');
  const [storyBg, setStoryBg] = useState(STORY_GRADIENTS[0].cls);

  const [content, setContent] = useState('');
  const [reelTitle, setReelTitle] = useState('');
  const [hashtagsRaw, setHashtagsRaw] = useState('');
  const [taggedRaw, setTaggedRaw] = useState('');
  const [locationName, setLocationName] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('public');
  const [category, setCategory] = useState<DiscoveryCategory>('Entertainment');
  const [soundName, setSoundName] = useState('Original Audio');
  const [files, setFiles] = useState<File[]>([]);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [voicePayload, setVoicePayload] = useState<{
    audioUrl: string;
    durationSeconds: number;
    waveform: number[];
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drafts support
  const [showDrafts, setShowDrafts] = useState(false);
  const [drafts, setDrafts] = useState<BanaPost[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  // Sync mode whenever modal opens with a new initialMode
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
      setShowDrafts(false);
    }
  }, [isOpen, initialMode]);

  // Create & revoke object URLs for selected image/video previews
  const filePreviews = useMemo(
    () =>
      files.map((file) => ({
        file,
        url: URL.createObjectURL(file),
        isVideo: file.type.startsWith('video/'),
      })),
    [files]
  );

  useEffect(() => {
    return () => {
      filePreviews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [filePreviews]);

  // Load saved drafts when Drafts drawer is toggled
  useEffect(() => {
    if (!isOpen || !showDrafts || !firebaseUser) return;
    setLoadingDrafts(true);
    getDocsWithIndexFallback<BanaPost>(
      query(
        collection(db, 'posts'),
        where('authorId', '==', firebaseUser.uid),
        where('status', '==', 'draft'),
        orderBy('createdAt', 'desc'),
        limit(12)
      ),
      query(
        collection(db, 'posts'),
        where('authorId', '==', firebaseUser.uid),
        where('status', '==', 'draft'),
        limit(24)
      ),
      sortByCreatedAtDesc
    )
      .then(({ items }) => {
        setDrafts(items.slice(0, 12));
      })
      .catch(() => setDrafts([]))
      .finally(() => setLoadingDrafts(false));
  }, [isOpen, showDrafts, firebaseUser]);

  if (!isOpen || !firebaseUser || !profile) return null;

  const resetForm = () => {
    setContent('');
    setReelTitle('');
    setHashtagsRaw('');
    setTaggedRaw('');
    setLocationName('');
    setFiles([]);
    setPollQuestion('');
    setPollOptions(['', '']);
    setVoicePayload(null);
    setActiveDraftId(null);
    setUploadProgress(0);
    setError(null);
  };

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocationName(
          `Lat ${pos.coords.latitude.toFixed(2)}, Lng ${pos.coords.longitude.toFixed(2)}`
        );
      },
      () => setError('Location permission denied. You can type a city or district manually.')
    );
  };

  const parseTags = (raw: string, prefix: string) =>
    raw
      .split(/[\s,]+/)
      .map((s) => s.trim().replace(prefix, ''))
      .filter(Boolean)
      .slice(0, 10);

  const loadDraftIntoEditor = (draft: BanaPost) => {
    setActiveDraftId(draft.id);
    setMode(
      draft.type === 'gallery' || draft.type === 'image'
        ? 'image'
        : draft.type === 'video'
        ? 'video'
        : draft.type === 'poll'
        ? 'poll'
        : draft.type === 'voice'
        ? 'voice'
        : 'text'
    );
    setContent(draft.content || '');
    setHashtagsRaw((draft.hashtags || []).map((h) => `#${h}`).join(', '));
    setTaggedRaw((draft.taggedUsernames || []).map((t) => `@${t}`).join(', '));
    setLocationName(draft.locationName || '');
    setVisibility(draft.visibility || 'public');
    if (draft.category) setCategory(draft.category);
    if (draft.pollQuestion) setPollQuestion(draft.pollQuestion);
    if (draft.pollOptions && draft.pollOptions.length >= 2) {
      setPollOptions(draft.pollOptions.map((o) => o.label));
    }
    setShowDrafts(false);
    toast.info('Draft loaded into composer.');
  };

  const deleteDraft = async (draftId: string) => {
    await deleteDoc(doc(db, 'posts', draftId)).catch(() => {});
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    if (activeDraftId === draftId) setActiveDraftId(null);
    toast.info('Draft removed.');
  };

  const handlePublish = async (asDraft = false) => {
    setError(null);
    setSubmitting(true);
    setUploadProgress(0);

    try {
      const hashtags = parseTags(hashtagsRaw, '#');
      const taggedUsernames = parseTags(taggedRaw, '@');

      if (mode === 'story') {
        const nowMs = Date.now();
        const expiresAtMs = nowMs + 24 * 60 * 60 * 1000;
        const expiresAt = Timestamp.fromDate(new Date(expiresAtMs));
        const retentionUntilMs = nowMs + DEFAULT_RETENTION_POLICY.storyRetentionDays * 24 * 60 * 60 * 1000;
        const vis = visibility === 'only_me' ? 'friends' : visibility;

        if (storyKind === 'text') {
          if (!content.trim()) throw new Error('Write text for your Story first.');
          const storyRef = await addDoc(collection(db, 'stories'), {
            authorId: firebaseUser.uid,
            authorUsername: profile.username,
            authorName: profile.displayName,
            authorAvatar: profile.avatarUrl || '',
            mediaUrl: '',
            mediaType: 'text',
            bgGradient: storyBg,
            caption: content.trim().slice(0, 300),
            visibility: vis,
            status: 'active',
            viewsCount: 0,
            repliesCount: 0,
            createdAt: serverTimestamp(),
            expiresAt,
          });
          await setDoc(doc(db, 'storyBackups', storyRef.id), {
            storyId: storyRef.id,
            authorId: firebaseUser.uid,
            authorUsername: profile.username,
            authorName: profile.displayName,
            mediaType: 'text',
            caption: content.trim().slice(0, 300),
            backupStatus: 'text_only',
            visibility: vis,
            createdAt: serverTimestamp(),
            expiresAtMs,
            expiredFromFeed: false,
            retentionUntilMs,
            retainedUnderPolicy: true,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        } else {
          if (files.length === 0) throw new Error('Select an image or short video for your story.');
          const file = files[0];
          const isVideo = file.type.startsWith('video/');
          const processed = isVideo ? file : await compressImageFile(file, 1280, 0.85);
          const uploaded = await uploadMediaWithMetadata(
            `stories/${firebaseUser.uid}/story_${Date.now()}_${processed.name}`,
            processed,
            { ownerUid: firebaseUser.uid, onProgress: setUploadProgress }
          );
          const storyRef = await addDoc(collection(db, 'stories'), {
            authorId: firebaseUser.uid,
            authorUsername: profile.username,
            authorName: profile.displayName,
            authorAvatar: profile.avatarUrl || '',
            mediaUrl: uploaded.url,
            mediaType: isVideo ? 'video' : 'image',
            mediaAssetId: uploaded.assetId,
            storageProvider: uploaded.providerId,
            objectKey: uploaded.objectKey,
            checksumSha256: uploaded.checksumSha256,
            caption: content.trim().slice(0, 300),
            visibility: vis,
            status: 'active',
            viewsCount: 0,
            repliesCount: 0,
            createdAt: serverTimestamp(),
            expiresAt,
          });
          await updateDoc(doc(db, 'mediaAssets', uploaded.assetId), {
            sourceDocId: storyRef.id,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
          await setDoc(doc(db, 'storyBackups', storyRef.id), {
            storyId: storyRef.id,
            authorId: firebaseUser.uid,
            authorUsername: profile.username,
            authorName: profile.displayName,
            mediaType: isVideo ? 'video' : 'image',
            caption: content.trim().slice(0, 300),
            primaryUrl: uploaded.url,
            primaryObjectKey: uploaded.objectKey,
            primaryProvider: uploaded.providerId,
            checksumSha256: uploaded.checksumSha256,
            backupStatus: uploaded.backupJobId ? 'pending' : 'none',
            visibility: vis,
            createdAt: serverTimestamp(),
            expiresAtMs,
            expiredFromFeed: false,
            retentionUntilMs,
            retainedUnderPolicy: true,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
        toast.success('Story published for 24 hours.');
      } else if (mode === 'reel') {
        if (files.length === 0) {
          throw new Error('Select a video file (MP4, WebM, or MOV) to publish a Reel.');
        }
        const videoFile = files[0];
        const inspected = await inspectAndValidateVideo(videoFile);
        const thumbFile = await extractVideoThumbnail(videoFile);
        const uploadedVideo = await uploadMediaWithMetadata(
          `reels/${firebaseUser.uid}/reel_${Date.now()}_${videoFile.name}`,
          videoFile,
          {
            ownerUid: firebaseUser.uid,
            contentType: inspected.mimeType,
            durationSeconds: inspected.durationSeconds,
            width: inspected.width,
            height: inspected.height,
            onProgress: setUploadProgress,
          }
        );
        let thumbnailUrl = '';
        if (thumbFile) {
          thumbnailUrl = await uploadMediaWithProgress(
            `reels/${firebaseUser.uid}/thumb_${Date.now()}.jpg`,
            thumbFile
          ).catch(() => '');
        }
        const reelRef = await addDoc(collection(db, 'reels'), {
          authorId: firebaseUser.uid,
          authorUsername: profile.username,
          authorName: profile.displayName,
          authorAvatar: profile.avatarUrl || '',
          authorVerified: Boolean(profile.isVerified),
          videoUrl: uploadedVideo.url,
          thumbnailUrl,
          mediaAssetId: uploadedVideo.assetId,
          storageProvider: uploadedVideo.providerId,
          objectKey: uploadedVideo.objectKey,
          checksumSha256: uploadedVideo.checksumSha256,
          title: reelTitle.trim().slice(0, 120),
          caption: content.trim().slice(0, 2000),
          category,
          soundName: soundName.trim() || 'Original Audio',
          hashtags,
          durationSeconds: inspected.durationSeconds,
          aspectRatio: inspected.aspectRatio,
          fileSizeBytes: inspected.sizeBytes,
          mimeType: inspected.mimeType,
          processingStatus: uploadedVideo.backupJobId ? 'backup_pending' : 'ready',
          visibility: visibility === 'friends' ? 'followers' : visibility,
          status: asDraft ? 'draft' : 'active',
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          savesCount: 0,
          viewsCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'mediaAssets', uploadedVideo.assetId), {
          sourceDocId: reelRef.id,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        toast.success(asDraft ? 'Reel saved to your profile drafts.' : 'Reel published to BANA Reels.');
      } else if (activeDraftId && files.length === 0) {
        // Update & publish (or re-save) an existing draft
        if (!content.trim() && mode === 'text') {
          throw new Error('Write something before posting.');
        }
        await updateDoc(doc(db, 'posts', activeDraftId), {
          content: content.trim(),
          category,
          hashtags,
          locationName: locationName.trim(),
          visibility,
          status: asDraft ? 'draft' : 'published',
          updatedAt: serverTimestamp(),
        });
        toast.success(asDraft ? 'Draft updated.' : 'Draft published to feed.');
      } else {
        let postType: PostType = 'text';
        let mediaUrls: string[] = [];
        let thumbnailUrl = '';
        let mediaAssetId = '';
        let storageProvider = '';
        let checksumSha256 = '';

        if (mode === 'image') {
          if (files.length === 0) throw new Error('Choose at least one image.');
          postType = files.length > 1 ? 'gallery' : 'image';
          for (let i = 0; i < files.length; i++) {
            const compressed = await compressImageFile(files[i]);
            const uploaded = await uploadMediaWithMetadata(
              `posts/${firebaseUser.uid}/img_${Date.now()}_${i}_${compressed.name}`,
              compressed,
              {
                ownerUid: firebaseUser.uid,
                onProgress: (p) => setUploadProgress(Math.round(((i + p / 100) / files.length) * 100)),
              }
            );
            mediaUrls.push(uploaded.url);
            if (!mediaAssetId) {
              mediaAssetId = uploaded.assetId;
              storageProvider = uploaded.providerId;
              checksumSha256 = uploaded.checksumSha256;
            }
          }
        } else if (mode === 'video') {
          if (files.length === 0) throw new Error('Choose a video file.');
          postType = 'video';
          const videoFile = files[0];
          const thumb = await extractVideoThumbnail(videoFile);
          const uploadedVideo = await uploadMediaWithMetadata(
            `posts/${firebaseUser.uid}/vid_${Date.now()}_${videoFile.name}`,
            videoFile,
            { ownerUid: firebaseUser.uid, onProgress: setUploadProgress }
          );
          mediaUrls = [uploadedVideo.url];
          mediaAssetId = uploadedVideo.assetId;
          storageProvider = uploadedVideo.providerId;
          checksumSha256 = uploadedVideo.checksumSha256;
          if (thumb) {
            thumbnailUrl = await uploadMediaWithProgress(
              `posts/${firebaseUser.uid}/thumb_${Date.now()}.jpg`,
              thumb
            ).catch(() => '');
          }
        } else if (mode === 'poll') {
          const validOpts = pollOptions.map((o) => o.trim()).filter(Boolean);
          if (!pollQuestion.trim() || validOpts.length < 2) {
            throw new Error('Provide a poll question and at least 2 options.');
          }
          postType = 'poll';
        } else if (mode === 'voice') {
          if (!voicePayload) throw new Error('Record and attach your voice clip first.');
          postType = 'voice';
        } else if (!content.trim()) {
          throw new Error('Write something before posting.');
        }

        const postRef = await addDoc(collection(db, 'posts'), {
          authorId: firebaseUser.uid,
          authorUsername: profile.username,
          authorName: profile.displayName,
          authorAvatar: profile.avatarUrl || '',
          authorVerified: Boolean(profile.isVerified),
          type: postType,
          category,
          content: content.trim(),
          mediaUrls,
          thumbnailUrl,
          ...(mediaAssetId ? { mediaAssetId, storageProvider, checksumSha256 } : {}),
          audioUrl: voicePayload?.audioUrl || '',
          audioDuration: voicePayload?.durationSeconds || 0,
          pollQuestion: mode === 'poll' ? pollQuestion.trim() : '',
          pollOptions:
            mode === 'poll'
              ? pollOptions
                  .map((o) => o.trim())
                  .filter(Boolean)
                  .map((label, idx) => ({ id: `opt_${idx}`, label, votes: 0 }))
              : [],
          pollVoters: {},
          hashtags,
          taggedUsernames,
          locationName: locationName.trim(),
          communityId: communityId || '',
          communityName: communityName || '',
          visibility,
          status: asDraft ? 'draft' : 'published',
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          viewsCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (mediaAssetId) {
          await updateDoc(doc(db, 'mediaAssets', mediaAssetId), {
            sourceDocId: postRef.id,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
        toast.success(asDraft ? 'Post saved to drafts.' : 'Post published.');
      }

      resetForm();
      onCreated?.();
      onClose();
    } catch (err: any) {
      logFirestoreError(err, OperationType.CREATE, mode === 'reel' ? 'reels' : 'posts');
      const msg = formatFirebaseErrorMessage(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4">
      <div className="animate-modal-in w-full max-w-2xl rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div>
            <h2 className="font-display font-bold text-lg text-neutral-950 dark:text-white">
              {communityName ? `Post in ${communityName}` : 'Create on BANA'}
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {activeDraftId
                ? 'Editing saved draft — publish when ready'
                : 'Share moments, reels, stories, polls, or voice notes'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode !== 'story' && mode !== 'reel' && (
              <button
                type="button"
                onClick={() => setShowDrafts((s) => !s)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                  showDrafts
                    ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]'
                    : 'border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Drafts
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close composer"
              className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center text-neutral-600 dark:text-neutral-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mode selector */}
        <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  setFiles([]);
                  setActiveDraftId(null);
                  setShowDrafts(false);
                  setError(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-[#1877F2] text-white'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Saved Drafts Panel */}
          {showDrafts && (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-neutral-900 dark:text-white">Saved Drafts</h3>
                <button
                  type="button"
                  onClick={() => setShowDrafts(false)}
                  className="text-[11px] text-neutral-500 hover:underline"
                >
                  Hide
                </button>
              </div>
              {loadingDrafts ? (
                <p className="text-xs text-neutral-500 py-2">Loading drafts...</p>
              ) : drafts.length === 0 ? (
                <p className="text-xs text-neutral-500 py-2">No saved drafts yet.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {drafts.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => loadDraftIntoEditor(d)}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">
                          {d.content || d.pollQuestion || `[${d.type}] draft`}
                        </p>
                        <p className="text-[11px] text-neutral-500">
                          {d.category || 'Post'} · {formatRelativeTime(d.createdAt)}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteDraft(d.id)}
                        aria-label="Delete draft"
                        className="p-1.5 text-neutral-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Story Type Selector: Photo/Video vs Text Card */}
          {mode === 'story' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setStoryKind('media');
                  setError(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  storyKind === 'media'
                    ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]'
                    : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" /> Photo / Video Story
              </button>
              <button
                type="button"
                onClick={() => {
                  setStoryKind('text');
                  setFiles([]);
                  setError(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  storyKind === 'text'
                    ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]'
                    : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
                }`}
              >
                <Type className="w-3.5 h-3.5" /> Text Story
              </button>
            </div>
          )}

          {/* Text Story Preview & Background Presets */}
          {mode === 'story' && storyKind === 'text' && (
            <div className="space-y-3">
              <div
                className={`rounded-2xl p-6 min-h-[160px] flex items-center justify-center text-center text-white font-display font-bold text-lg shadow-inner ${storyBg}`}
              >
                {content.trim() || 'Your story text will appear here...'}
              </div>
              <div className="flex items-center gap-2">
                {STORY_GRADIENTS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setStoryBg(g.cls)}
                    aria-label={`Select ${g.label} background`}
                    className={`h-7 w-7 rounded-full ${g.cls} ring-offset-2 dark:ring-offset-neutral-950 ${
                      storyBg === g.cls ? 'ring-2 ring-[#1877F2]' : ''
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={mode === 'text' || (mode === 'story' && storyKind === 'text') ? 4 : 3}
            placeholder={
              mode === 'reel'
                ? 'Write a caption for your vertical Reel...'
                : mode === 'story'
                ? storyKind === 'text'
                  ? 'Write your 24-hour Text Story...'
                  : 'Optional story caption...'
                : 'What would you like to share with your community?'
            }
            className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-4 py-3 text-sm text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
          />

          {(mode === 'image' || mode === 'video' || mode === 'reel' || (mode === 'story' && storyKind === 'media')) && (
            <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-4 space-y-3">
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                {mode === 'image'
                  ? 'Select one or multiple photos (auto-compressed before upload)'
                  : mode === 'reel'
                  ? 'Select vertical video (9:16 recommended, MP4/WebM up to 150MB)'
                  : mode === 'story'
                  ? 'Select image or video for 24-hour story'
                  : 'Select video file (MP4/WebM)'}
              </label>
              <input
                type="file"
                multiple={mode === 'image'}
                accept={
                  mode === 'image'
                    ? 'image/*'
                    : mode === 'story'
                    ? 'image/*,video/mp4,video/webm'
                    : 'video/mp4,video/webm,video/quicktime'
                }
                onChange={(e) => {
                  const picked = Array.from(e.target.files || []);
                  if (mode === 'image') {
                    setFiles((prev) => [...prev, ...picked].slice(0, 8));
                  } else {
                    setFiles(picked.slice(0, 1));
                  }
                  e.target.value = '';
                }}
                className="block w-full text-xs text-neutral-600 dark:text-neutral-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#1877F2] file:text-white file:text-xs file:font-medium cursor-pointer"
              />

              {/* Live Thumbnail / Video Previews */}
              {filePreviews.length > 0 && (
                <div className="space-y-2">
                  <div className={`grid gap-2 ${filePreviews.length > 1 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1'}`}>
                    {filePreviews.map((item, idx) => (
                      <div
                        key={`${item.file.name}_${idx}`}
                        className="relative rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-black/5 dark:bg-black"
                      >
                        {item.isVideo ? (
                          <video
                            src={item.url}
                            controls
                            muted
                            playsInline
                            className="w-full max-h-56 object-contain bg-black"
                          />
                        ) : (
                          <img
                            src={item.url}
                            alt={`Preview ${idx + 1}`}
                            className="w-full h-36 object-cover"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label={`Remove ${item.file.name}`}
                          className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-[#1877F2] dark:text-blue-400 font-mono tabular-nums">
                    {files.length} file(s) selected ({Math.round(files.reduce((a, f) => a + f.size, 0) / 1024)} KB)
                  </p>
                </div>
              )}
            </div>
          )}

          {mode === 'reel' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={reelTitle}
                onChange={(e) => setReelTitle(e.target.value)}
                maxLength={120}
                placeholder="Reel title (optional)"
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3.5 py-2 text-sm text-neutral-950 dark:text-white"
              />
              <input
                type="text"
                value={soundName}
                onChange={(e) => setSoundName(e.target.value)}
                placeholder="Sound / Audio credit (e.g. Original Audio)"
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3.5 py-2 text-sm text-neutral-950 dark:text-white"
              />
            </div>
          )}

          {mode === 'poll' && (
            <div className="space-y-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
              <input
                type="text"
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                placeholder="Ask a poll question..."
                className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 text-sm font-medium"
              />
              {pollOptions.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => {
                      const next = [...pollOptions];
                      next[idx] = e.target.value;
                      setPollOptions(next);
                    }}
                    placeholder={`Option ${idx + 1}`}
                    className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm"
                  />
                  {pollOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                      className="p-1.5 text-neutral-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              {pollOptions.length < 4 && (
                <button
                  type="button"
                  onClick={() => setPollOptions([...pollOptions, ''])}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1877F2] dark:text-blue-400"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Option
                </button>
              )}
            </div>
          )}

          {mode === 'voice' && (
            <div className="space-y-2">
              <VoiceRecorder
                uid={firebaseUser.uid}
                storagePrefix="posts"
                submitLabel="Attach Audio"
                onUploaded={(payload) => {
                  setVoicePayload(payload);
                }}
              />
              {voicePayload && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  Voice recording attached ({voicePayload.durationSeconds}s). Ready to publish.
                </p>
              )}
            </div>
          )}

          {mode !== 'story' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={hashtagsRaw}
                onChange={(e) => setHashtagsRaw(e.target.value)}
                placeholder="Hashtags (e.g. dhaka, photography)"
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3.5 py-2 text-xs text-neutral-950 dark:text-white"
              />
              <input
                type="text"
                value={taggedRaw}
                onChange={(e) => setTaggedRaw(e.target.value)}
                placeholder="Tag usernames (e.g. @alex, @sadia)"
                className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3.5 py-2 text-xs text-neutral-950 dark:text-white"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={detectLocation}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <MapPin className="w-3.5 h-3.5" />
                {locationName ? locationName : 'Add Location'}
              </button>
              {locationName && (
                <button
                  type="button"
                  onClick={() => setLocationName('')}
                  className="text-xs text-neutral-400 hover:text-neutral-700"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {mode !== 'story' && (
                <select
                  aria-label="Discovery Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DiscoveryCategory)}
                  className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-800 dark:text-neutral-200"
                >
                  {DISCOVERY_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label="Post Visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as PostVisibility)}
                className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-800 dark:text-neutral-200"
              >
                <option value="public">Public</option>
                <option value="followers">Followers</option>
                <option value="friends">Friends</option>
                {mode !== 'story' && <option value="only_me">Only me</option>}
              </select>
            </div>
          </div>

          {submitting && uploadProgress > 0 && (
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                <div
                  className="h-full bg-[#1877F2] transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-[11px] font-mono text-neutral-500 tabular-nums">
                Uploading media: {uploadProgress}%
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/50">
          {mode !== 'story' && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => handlePublish(true)}
              className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
            >
              Save Draft
            </button>
          )}
          <button
            type="button"
            disabled={submitting}
            onClick={() => handlePublish(false)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold hover:bg-[#166FE5] disabled:opacity-60 transition-colors"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? 'Publishing...' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
