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
  Upload,
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
import { inspectAndValidateVideo, probeVideoDurationSeconds } from '@/src/lib/videoUtils';
import { detectContentLanguage } from '@/src/lib/videoDistributionCore';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import {
  completeUploadTask,
  failUploadTask,
  startUploadTask,
  updateUploadTask,
} from '@/src/lib/uploadTracker';
import { VoiceRecorder } from '@/src/components/voice/VoiceRecorderAndPlayer';
import { ReelUploadModal } from '@/src/components/reels/ReelUploadModal';
import {
  Dropzone,
  Field,
  ModalShell,
  ProgressBar,
  Segmented,
  btnPrimary,
  btnSecondary,
  inputCls,
  textareaCls,
} from '@/src/components/create/uploadUi';

export type CreateMode = 'text' | 'image' | 'video' | 'reel' | 'story' | 'poll' | 'voice';

interface CreateModalProps {
  isOpen: boolean;
  initialMode?: CreateMode;
  communityId?: string;
  communityName?: string;
  /** Show a Post / Story / Reel picker first. Each choice opens its own independent screen. */
  startWithChooser?: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

// Post-family kinds only. Story and Reel are separate screens and never appear inside the Post screen.
const POST_MODES: { id: CreateMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'text', label: 'Post', icon: FileText },
  { id: 'image', label: 'Photos', icon: ImageIcon },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'poll', label: 'Poll', icon: BarChart2 },
  { id: 'voice', label: 'Voice', icon: Mic },
];

const STORY_GRADIENTS = [
  { id: 'royal', label: 'Cobalt', cls: 'bg-gradient-to-br from-brand via-blue-700 to-blue-900' },
  { id: 'sunset', label: 'Emerald', cls: 'bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700' },
  { id: 'emerald', label: 'Charcoal', cls: 'bg-gradient-to-br from-neutral-700 via-neutral-800 to-neutral-900' },
  { id: 'midnight', label: 'Midnight', cls: 'bg-gradient-to-br from-neutral-900 via-slate-800 to-neutral-950' },
];

export function CreateModal({
  isOpen,
  initialMode = 'text',
  communityId,
  communityName,
  startWithChooser = false,
  onClose,
  onCreated,
}: CreateModalProps) {
  const { firebaseUser, profile } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<CreateMode>(initialMode);
  const [chooser, setChooser] = useState<boolean>(startWithChooser);
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
      setChooser(startWithChooser);
      setError(null);
      setShowDrafts(false);
    }
  }, [isOpen, initialMode, startWithChooser]);

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

  // Reels have their own dedicated upload screen (existing ReelUploadModal pipeline, validation and security checks).
  if (mode === 'reel' && !chooser) {
    return (
      <ReelUploadModal
        isOpen
        onClose={onClose}
        onUploaded={() => {
          onCreated?.();
        }}
      />
    );
  }

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
    if (submitting) return; // prevent duplicate submissions
    setError(null);
    setSubmitting(true);
    setUploadProgress(0);

    // Track media uploads so progress stays visible even if this screen is closed or the user navigates.
    const trackedKind = mode === 'story' ? 'story' : mode === 'video' ? 'video' : mode === 'image' ? 'photo' : mode === 'reel' ? 'reel' : 'post';
    const taskId =
      files.length > 0
        ? startUploadTask({
            kind: trackedKind,
            fileName: files.length > 1 ? `${files.length} files` : files[0].name,
            retry: () => {
              void handlePublish(asDraft);
            },
          })
        : null;
    const reportProgress = (p: number) => {
      setUploadProgress(p);
      if (taskId) updateUploadTask(taskId, { pct: p });
    };

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
            { ownerUid: firebaseUser.uid, onProgress: reportProgress }
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
            onProgress: reportProgress,
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
          ...(detectContentLanguage(`${reelTitle} ${content}`) ? { language: detectContentLanguage(`${reelTitle} ${content}`) } : {}),
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
        let videoDurationSeconds: number | null = null;

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
                onProgress: (p) => reportProgress(Math.round(((i + p / 100) / files.length) * 100)),
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
          videoDurationSeconds = await probeVideoDurationSeconds(videoFile);
          const thumb = await extractVideoThumbnail(videoFile);
          const uploadedVideo = await uploadMediaWithMetadata(
            `posts/${firebaseUser.uid}/vid_${Date.now()}_${videoFile.name}`,
            videoFile,
            { ownerUid: firebaseUser.uid, onProgress: reportProgress }
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
          ...(videoDurationSeconds ? { videoDurationSeconds } : {}),
          ...(videoDurationSeconds && detectContentLanguage(content) ? { language: detectContentLanguage(content) } : {}),
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

      if (taskId) completeUploadTask(taskId);
      resetForm();
      onCreated?.();
      onClose();
    } catch (err: any) {
      logFirestoreError(err, OperationType.CREATE, mode === 'reel' ? 'reels' : 'posts');
      const msg = formatFirebaseErrorMessage(err);
      if (taskId) failUploadTask(taskId, msg);
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const isStory = mode === 'story';
  const closeAndReset = () => {
    onClose();
  };

  const switchPostMode = (next: CreateMode) => {
    setMode(next);
    setFiles([]);
    setActiveDraftId(null);
    setShowDrafts(false);
    setError(null);
  };

  const openFromChooser = (target: 'post' | 'story' | 'reel') => {
    setError(null);
    setFiles([]);
    setActiveDraftId(null);
    setShowDrafts(false);
    setChooser(false);
    setMode(target === 'post' ? 'text' : target === 'story' ? 'story' : 'reel');
  };

  // Step 1 (optional): pick what to create. Each choice opens a fully independent screen.
  if (chooser) {
    const choices = [
      { id: 'post' as const, label: 'Post', desc: 'Text, photos, video, poll or voice', icon: FileText },
      { id: 'story' as const, label: 'Story', desc: 'Photo, video or text for 24 hours', icon: Sparkles },
      { id: 'reel' as const, label: 'Reel', desc: 'Short vertical video', icon: Film },
    ];
    return (
      <ModalShell
        icon={Plus}
        title="Create"
        subtitle="Choose what you want to share"
        onClose={closeAndReset}
        closeLabel="Close"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {choices.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => openFromChooser(c.id)}
                className="group text-left rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 min-h-[110px] hover:border-brand hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
              >
                <span className="h-10 w-10 rounded-xl bg-brand text-white flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5" />
                </span>
                <span className="block text-sm font-bold text-neutral-950 dark:text-white">{c.label}</span>
                <span className="block text-xs text-neutral-500 mt-0.5">{c.desc}</span>
              </button>
            );
          })}
        </div>
      </ModalShell>
    );
  }

  const mediaPreviews = filePreviews.length > 0 && (
    <div className="space-y-2">
      <div className={`grid gap-2 ${filePreviews.length > 1 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1'}`}>
        {filePreviews.map((item, idx) => (
          <div
            key={`${item.file.name}_${idx}`}
            className="relative rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-black"
          >
            {item.isVideo ? (
              <video src={item.url} controls muted playsInline className="w-full max-h-72 object-contain bg-black" />
            ) : (
              <img
                src={item.url}
                alt={`Preview ${idx + 1}`}
                className={`w-full object-cover ${filePreviews.length > 1 ? 'h-32' : 'max-h-80 object-contain'}`}
              />
            )}
            <button
              type="button"
              onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
              aria-label={`Remove ${item.file.name}`}
              className="absolute top-2 right-2 h-8 w-8 rounded-full bg-neutral-950/80 text-white flex items-center justify-center hover:bg-neutral-950"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-neutral-500 font-mono tabular-nums">
        {files.length} file(s) selected ({Math.round(files.reduce((a, f) => a + f.size, 0) / 1024)} KB)
      </p>
    </div>
  );

  const errorBox = error && (
    <div className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 px-3.5 py-3 text-xs font-medium text-red-700 dark:text-red-300">
      {error}
    </div>
  );

  const progress = submitting && uploadProgress > 0 && (
    <ProgressBar pct={uploadProgress} label="Uploading media" />
  );

  // ───────────────────────────── STORY SCREEN ─────────────────────────────
  if (isStory) {
    return (
      <ModalShell
        icon={Sparkles}
        title="Create Story"
        subtitle="Visible for 24 hours"
        onClose={closeAndReset}
        onBack={startWithChooser ? () => setChooser(true) : undefined}
        closeLabel="Close story composer"
        footer={
          <>
            <button type="button" onClick={closeAndReset} disabled={submitting} className={btnSecondary}>
              Cancel
            </button>
            <button type="button" disabled={submitting} onClick={() => handlePublish(false)} className={btnPrimary}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Publishing...' : 'Publish Story'}
            </button>
          </>
        }
      >
        {errorBox}

        <Segmented
          items={[
            { id: 'media' as const, label: 'Photo / Video', icon: ImageIcon },
            { id: 'text' as const, label: 'Text', icon: Type },
          ]}
          value={storyKind}
          onChange={(k) => {
            setStoryKind(k);
            if (k === 'text') setFiles([]);
            setError(null);
          }}
        />

        {storyKind === 'text' ? (
          <div className="space-y-3">
            <div
              className={`rounded-2xl p-6 min-h-[200px] flex items-center justify-center text-center text-white font-display font-bold text-xl ${storyBg}`}
            >
              {content.trim() || 'Your story text will appear here...'}
            </div>
            <div className="flex items-center gap-2.5">
              {STORY_GRADIENTS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setStoryBg(g.cls)}
                  aria-label={`Select ${g.label} background`}
                  className={`h-9 w-9 rounded-full border border-neutral-300 dark:border-neutral-700 ${g.cls} ring-offset-2 ring-offset-white dark:ring-offset-neutral-950 ${
                    storyBg === g.cls ? 'ring-2 ring-brand' : ''
                  }`}
                />
              ))}
            </div>
          </div>
        ) : files.length === 0 ? (
          <Dropzone
            title="Select a photo or video"
            hint="Image, MP4 or WebM for your 24-hour story"
            accept="image/*,video/mp4,video/webm"
            onPick={(picked) => setFiles(picked.slice(0, 1))}
          />
        ) : (
          mediaPreviews
        )}

        <Field label={storyKind === 'text' ? 'Story text' : 'Caption (optional)'}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={storyKind === 'text' ? 4 : 3}
            maxLength={300}
            placeholder={storyKind === 'text' ? 'Write your 24-hour Text Story...' : 'Optional story caption...'}
            className={textareaCls}
          />
        </Field>

        <Field label="Audience">
          <select
            aria-label="Story Audience"
            value={visibility === 'only_me' ? 'friends' : visibility}
            onChange={(e) => setVisibility(e.target.value as PostVisibility)}
            className={inputCls}
          >
            <option value="public">Public</option>
            <option value="followers">Followers</option>
            <option value="friends">Friends</option>
          </select>
        </Field>

        {progress}
      </ModalShell>
    );
  }

  // ───────────────────────────── POST SCREEN ─────────────────────────────
  return (
    <ModalShell
      icon={FileText}
      title={communityName ? `Post in ${communityName}` : 'Create Post'}
      subtitle={activeDraftId ? 'Editing saved draft — publish when ready' : 'Share something with your community'}
      onClose={closeAndReset}
      onBack={startWithChooser ? () => setChooser(true) : undefined}
      closeLabel="Close composer"
      actions={
        <button
          type="button"
          onClick={() => setShowDrafts((s) => !s)}
          className={`${btnSecondary} !min-h-[40px] !px-3 !text-xs ${
            showDrafts ? '!bg-brand !text-white !border-brand' : ''
          }`}
        >
          <FolderOpen className="w-4 h-4" />
          Drafts
        </button>
      }
      footer={
        <>
          <button type="button" disabled={submitting} onClick={() => handlePublish(true)} className={btnSecondary}>
            Save Draft
          </button>
          <button type="button" disabled={submitting} onClick={() => handlePublish(false)} className={btnPrimary}>
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Publishing...' : 'Publish'}
          </button>
        </>
      }
    >
      <Segmented items={POST_MODES} value={mode} onChange={switchPostMode} />

      {showDrafts && (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-neutral-900 dark:text-white">Saved Drafts</h3>
            <button type="button" onClick={() => setShowDrafts(false)} className="text-xs text-neutral-500 hover:underline">
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
                  <button type="button" onClick={() => loadDraftIntoEditor(d)} className="flex-1 text-left min-w-0">
                    <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
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
                    className="h-9 w-9 flex items-center justify-center text-neutral-400 hover:text-brand"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {errorBox}

      {mode !== 'poll' && mode !== 'voice' && (
        <Field label={mode === 'text' ? 'What would you like to share?' : 'Caption'}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={mode === 'text' ? 5 : 3}
            placeholder="What would you like to share with your community?"
            className={textareaCls}
          />
        </Field>
      )}

      {(mode === 'image' || mode === 'video') && (
        <div className="space-y-3">
          {(mode === 'video' ? files.length === 0 : files.length < 8) && (
            <Dropzone
              compact={files.length > 0}
              title={mode === 'image' ? 'Add photos' : 'Select a video'}
              hint={
                mode === 'image'
                  ? 'Up to 8 photos, compressed before upload'
                  : 'MP4 or WebM video file'
              }
              multiple={mode === 'image'}
              accept={mode === 'image' ? 'image/*' : 'video/mp4,video/webm,video/quicktime'}
              onPick={(picked) =>
                mode === 'image' ? setFiles((prev) => [...prev, ...picked].slice(0, 8)) : setFiles(picked.slice(0, 1))
              }
            />
          )}
          {mediaPreviews}
        </div>
      )}

      {mode === 'poll' && (
        <div className="space-y-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
          <Field label="Poll question">
            <input
              type="text"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Ask a poll question..."
              className={inputCls}
            />
          </Field>
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
                className={inputCls}
              />
              {pollOptions.length > 2 && (
                <button
                  type="button"
                  onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                  aria-label={`Remove option ${idx + 1}`}
                  className="h-11 w-11 shrink-0 flex items-center justify-center rounded-xl border border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:text-brand"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {pollOptions.length < 4 && (
            <button type="button" onClick={() => setPollOptions([...pollOptions, ''])} className={`${btnSecondary} !min-h-[40px] !text-xs`}>
              <Plus className="w-4 h-4" /> Add Option
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
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Voice recording attached ({voicePayload.durationSeconds}s). Ready to publish.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Hashtags">
          <input
            type="text"
            value={hashtagsRaw}
            onChange={(e) => setHashtagsRaw(e.target.value)}
            placeholder="dhaka, photography"
            className={inputCls}
          />
        </Field>
        <Field label="Tag people">
          <input
            type="text"
            value={taggedRaw}
            onChange={(e) => setTaggedRaw(e.target.value)}
            placeholder="@alex, @sadia"
            className={inputCls}
          />
        </Field>
        <Field label="Discovery Category">
          <select
            aria-label="Discovery Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as DiscoveryCategory)}
            className={inputCls}
          >
            {DISCOVERY_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Audience">
          <select
            aria-label="Post Visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as PostVisibility)}
            className={inputCls}
          >
            <option value="public">Public</option>
            <option value="followers">Followers</option>
            <option value="friends">Friends</option>
            <option value="only_me">Only me</option>
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={detectLocation} className={`${btnSecondary} !min-h-[40px] !text-xs`}>
          <MapPin className="w-4 h-4" />
          {locationName ? locationName : 'Add Location'}
        </button>
        {locationName && (
          <button
            type="button"
            onClick={() => setLocationName('')}
            className="text-xs text-neutral-500 hover:text-brand min-h-[40px] px-2"
          >
            Clear
          </button>
        )}
      </div>

      {progress}
    </ModalShell>
  );
}
