import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Upload,
  Film,
  Image as ImageIcon,
  Subtitles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Camera,
  ShieldCheck,
} from 'lucide-react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import { DISCOVERY_CATEGORIES, type DiscoveryCategory } from '@/src/types/bana';
import {
  compressImageFile,
  extractVideoThumbnail,
  uploadMediaWithMetadata,
  uploadMediaWithProgress,
} from '@/src/lib/mediaUtils';
import {
  captureFrameFromVideoElement,
  formatDurationClock,
  inspectAndValidateVideo,
  SPARK_RECOMMENDED_VIDEO_MB,
  type VideoInspectionResult,
} from '@/src/lib/videoUtils';
import { FIREBASE_PLAN_MODE } from '@/src/lib/firebasePlan';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';

interface ReelUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploaded?: () => void;
}

type UploadStage =
  | 'idle'
  | 'validating'
  | 'uploading'
  | 'uploading_assets'
  | 'saving_metadata'
  | 'success'
  | 'upload_failed';

export function ReelUploadModal({ isOpen, onClose, onUploaded }: ReelUploadModalProps) {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<VideoInspectionResult | null>(null);
  const [customThumbFile, setCustomThumbFile] = useState<File | null>(null);
  const [captionsFile, setCaptionsFile] = useState<File | null>(null);

  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [description, setDescription] = useState('');
  const [hashtagsRaw, setHashtagsRaw] = useState('');
  const [soundName, setSoundName] = useState('Original Audio');
  const [category, setCategory] = useState<DiscoveryCategory>('Entertainment');
  const [visibility, setVisibility] = useState<'public' | 'followers' | 'only_me'>('public');

  const [stage, setStage] = useState<UploadStage>('idle');
  const [progressPct, setProgressPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastIntendedDraft, setLastIntendedDraft] = useState(false);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const videoPreviewUrl = useMemo(() => (videoFile ? URL.createObjectURL(videoFile) : null), [videoFile]);
  const thumbPreviewUrl = useMemo(
    () => (customThumbFile ? URL.createObjectURL(customThumbFile) : null),
    [customThumbFile]
  );

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  useEffect(() => {
    return () => {
      if (thumbPreviewUrl) URL.revokeObjectURL(thumbPreviewUrl);
    };
  }, [thumbPreviewUrl]);

  if (!isOpen) return null;

  const isVerifiedAccount = Boolean(
    firebaseUser &&
      (firebaseUser.emailVerified || firebaseUser.providerData.some((p) => p.providerId === 'google.com'))
  );

  const resetAll = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setVideoFile(null);
    setInspection(null);
    setCustomThumbFile(null);
    setCaptionsFile(null);
    setTitle('');
    setCaption('');
    setDescription('');
    setHashtagsRaw('');
    setSoundName('Original Audio');
    setCategory('Entertainment');
    setVisibility('public');
    setStage('idle');
    setProgressPct(0);
    setErrorMsg(null);
  };

  const handleVideoSelected = async (file: File | null) => {
    if (!file) return;
    setErrorMsg(null);
    setStage('validating');
    setCustomThumbFile(null);
    try {
      const result = await inspectAndValidateVideo(file);
      setVideoFile(file);
      setInspection(result);
      setStage('idle');
    } catch (err: any) {
      setVideoFile(null);
      setInspection(null);
      setStage('upload_failed');
      setErrorMsg(err?.message || 'Could not validate selected video.');
    }
  };

  const handleUploadSubmit = async (asDraft: boolean) => {
    if (['validating', 'uploading', 'uploading_assets', 'saving_metadata'].includes(stage)) {
      return; // Duplicate upload guard
    }
    if (!firebaseUser || !profile) {
      openAuthModal('Sign in to upload Reels to BANA.');
      return;
    }
    if (!isVerifiedAccount) {
      setErrorMsg('Please verify your email address before uploading videos.');
      setStage('upload_failed');
      return;
    }
    if (!videoFile || !inspection) {
      setErrorMsg('Select a valid MP4, WebM, or MOV video file first.');
      setStage('upload_failed');
      return;
    }

    setLastIntendedDraft(asDraft);
    setErrorMsg(null);
    setProgressPct(0);
    setStage('uploading');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      // Preserves original quality & computes client-side SHA-256 checksum
      const uploadedVideo = await uploadMediaWithMetadata(
        `reels/${firebaseUser.uid}/reel_${Date.now()}_${safeName}`,
        videoFile,
        {
          ownerUid: firebaseUser.uid,
          contentType: inspection.mimeType,
          durationSeconds: inspection.durationSeconds,
          width: inspection.width,
          height: inspection.height,
          onProgress: setProgressPct,
          abortSignal: controller.signal,
          queueBackup: true,
        }
      );

      setStage('uploading_assets');
      let thumbnailUrl = '';
      const thumbSource = customThumbFile || (await extractVideoThumbnail(videoFile));
      if (thumbSource) {
        const compressedThumb = await compressImageFile(thumbSource, 1080, 0.84);
        thumbnailUrl = await uploadMediaWithProgress(
          `reels/${firebaseUser.uid}/thumb_${Date.now()}.jpg`,
          compressedThumb,
          undefined,
          'image/jpeg'
        ).catch(() => '');
      }

      let captionsVttUrl = '';
      if (captionsFile) {
        captionsVttUrl = await uploadMediaWithProgress(
          `reels/${firebaseUser.uid}/captions_${Date.now()}.vtt`,
          captionsFile,
          undefined,
          'text/vtt'
        ).catch(() => '');
      }

      setStage('saving_metadata');
      const hashtags = hashtagsRaw
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 10);

      const reelRef = await addDoc(collection(db, 'reels'), {
        authorId: firebaseUser.uid,
        authorUsername: profile.username,
        authorName: profile.displayName,
        authorAvatar: profile.avatarUrl || '',
        authorVerified: Boolean(profile.isVerified),
        title: title.trim().slice(0, 120),
        videoUrl: uploadedVideo.url,
        thumbnailUrl,
        captionsVttUrl,
        mediaAssetId: uploadedVideo.assetId,
        storageProvider: uploadedVideo.providerId,
        objectKey: uploadedVideo.objectKey,
        checksumSha256: uploadedVideo.checksumSha256,
        aspectRatio: inspection.aspectRatio,
        durationSeconds: inspection.durationSeconds,
        fileSizeBytes: inspection.sizeBytes,
        mimeType: inspection.mimeType,
        processingStatus: uploadedVideo.backupJobId ? 'backup_pending' : 'ready',
        caption: caption.trim().slice(0, 2000),
        description: description.trim().slice(0, 2000),
        category,
        soundName: soundName.trim() || 'Original Audio',
        hashtags,
        visibility,
        status: asDraft ? 'draft' : 'active',
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        savesCount: 0,
        viewsCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Backlink mediaAsset -> reels doc ID for automatic backup & one-click recovery updates
      await updateDoc(doc(db, 'mediaAssets', uploadedVideo.assetId), {
        sourceDocId: reelRef.id,
        updatedAt: serverTimestamp(),
      }).catch(() => {});

      setStage('success');
      toast.success(asDraft ? 'Reel saved to Drafts.' : 'Reel published to BANA Reels.');
      onUploaded?.();
      window.setTimeout(() => {
        resetAll();
        onClose();
      }, 900);
    } catch (err: any) {
      logFirestoreError(err, OperationType.CREATE, 'reels');
      const msg = formatFirebaseErrorMessage(err);
      setErrorMsg(msg);
      setStage('upload_failed');
      toast.error(msg);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const busy = ['validating', 'uploading', 'uploading_assets', 'saving_metadata'].includes(stage);

  return (
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="animate-modal-in w-full max-w-3xl rounded-t-3xl sm:rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base text-neutral-950 dark:text-white">
                Upload BANA Reel
              </h2>
              <p className="text-xs text-neutral-500">
                Original quality MP4, WebM, or MOV · Presigned Multi-Cloud Upload · SHA-256 Verified
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (busy) abortControllerRef.current?.abort();
              onClose();
            }}
            aria-label="Close upload modal"
            className="min-h-[44px] min-w-[44px] rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Left: Video Preview & Picker */}
          <div className="md:col-span-5 space-y-3">
            <div className="aspect-[9/16] max-h-[380px] mx-auto rounded-2xl bg-neutral-950 border border-neutral-200 dark:border-neutral-800 overflow-hidden relative flex items-center justify-center">
              {videoPreviewUrl ? (
                <video
                  ref={previewVideoRef}
                  src={videoPreviewUrl}
                  poster={thumbPreviewUrl || undefined}
                  controls
                  playsInline
                  className="w-full h-full object-contain bg-black"
                />
              ) : (
                <label className="cursor-pointer flex flex-col items-center justify-center text-center p-6 space-y-2.5 text-neutral-300 hover:text-white">
                  <div className="h-12 w-12 rounded-2xl bg-white/10 flex items-center justify-center">
                    <Upload className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-semibold">Select Video File</span>
                  <span className="text-[11px] text-neutral-400">MP4, WebM, MOV up to 150 MB</span>
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    onChange={(e) => handleVideoSelected(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {inspection && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-neutral-600 dark:text-neutral-400 flex flex-wrap items-center justify-center gap-2 font-mono tabular-nums">
                  <span>{inspection.aspectRatio}</span>
                  <span>·</span>
                  <span>{inspection.width}×{inspection.height}</span>
                  <span>·</span>
                  <span>{formatDurationClock(inspection.durationSeconds)}</span>
                  <span>·</span>
                  <span>{(inspection.sizeBytes / (1024 * 1024)).toFixed(1)} MB</span>
                </div>
                {FIREBASE_PLAN_MODE === 'spark' &&
                  inspection.sizeBytes > SPARK_RECOMMENDED_VIDEO_MB * 1024 * 1024 && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-2.5 py-1.5 text-center">
                      Original resolution preserved ({(inspection.sizeBytes / (1024 * 1024)).toFixed(1)} MB). Ensure Cloudflare R2 / primary bucket has quota capacity.
                    </p>
                  )}
              </div>
            )}

            {videoFile && (
              <div className="grid grid-cols-2 gap-2">
                <label className="cursor-pointer min-h-[40px] px-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 text-[11px] font-medium flex items-center justify-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>{customThumbFile ? 'Change Cover' : 'Custom Cover'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCustomThumbFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    if (!previewVideoRef.current) return;
                    const frame = await captureFrameFromVideoElement(previewVideoRef.current);
                    if (frame) {
                      setCustomThumbFile(frame);
                      toast.info('Thumbnail captured from current video frame.');
                    }
                  }}
                  className="min-h-[40px] px-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 text-[11px] font-medium flex items-center justify-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Use Frame</span>
                </button>
              </div>
            )}

            {thumbPreviewUrl && (
              <div className="flex items-center gap-2.5 p-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
                <img src={thumbPreviewUrl} alt="Selected thumbnail" className="h-12 w-9 rounded-lg object-cover" />
                <div className="flex-1 min-w-0 text-[11px]">
                  <p className="font-semibold truncate">Custom Cover Selected</p>
                  <p className="text-neutral-500">Ready for upload</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomThumbFile(null)}
                  className="p-1 text-neutral-400 hover:text-red-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {videoFile && (
              <label className="cursor-pointer block text-center text-[11px] text-[#1877F2] font-medium hover:underline">
                Choose a different video file
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => handleVideoSelected(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Right: Metadata & Options */}
          <div className="md:col-span-7 space-y-3.5">
            {!isVerifiedAccount && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
                Verify your email address before uploading Reels to Multi-Cloud Storage.
              </div>
            )}

            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 p-2.5 text-[11px] text-neutral-600 dark:text-neutral-400 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#1877F2] shrink-0" />
              <span>Spark Multi-Cloud Pipeline: Direct presigned object upload + SHA-256 integrity + Secondary Backup queue.</span>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
                {videoFile && inspection && (
                  <button
                    type="button"
                    onClick={() => handleUploadSubmit(lastIntendedDraft)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600 text-white font-semibold shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" /> Retry
                  </button>
                )}
              </div>
            )}

            {stage === 'success' && (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Video uploaded with SHA-256 checksum &amp; queued for backup.</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-xs font-medium">Video Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give your Reel a clear title..."
                maxLength={120}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium">Caption</label>
              <textarea
                rows={2}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write a hook or summary for viewers..."
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium">Description (Optional)</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add context, gear notes, or credits..."
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-medium">Hashtags</label>
                <input
                  type="text"
                  value={hashtagsRaw}
                  onChange={(e) => setHashtagsRaw(e.target.value)}
                  placeholder="#dhaka #tech #bana"
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium">Audio / Sound Name</label>
                <input
                  type="text"
                  value={soundName}
                  onChange={(e) => setSoundName(e.target.value)}
                  placeholder="Original Audio"
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium">Discovery Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DiscoveryCategory)}
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
                >
                  {DISCOVERY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium">Audience</label>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'followers' | 'only_me')}
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
                >
                  <option value="public">Public (Everyone)</option>
                  <option value="followers">Followers Only</option>
                  <option value="only_me">Only Me</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Subtitles className="w-4 h-4 text-[#1877F2] shrink-0" />
                <span className="truncate">
                  {captionsFile ? `Captions: ${captionsFile.name}` : 'Optional Closed Captions (.vtt)'}
                </span>
              </div>
              <label className="cursor-pointer px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 font-medium hover:bg-white dark:hover:bg-neutral-800 shrink-0">
                {captionsFile ? 'Replace' : 'Attach .vtt'}
                <input
                  type="file"
                  accept=".vtt,text/vtt"
                  onChange={(e) => setCaptionsFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            </div>

            {busy && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[11px] font-medium">
                  <span className="text-[#1877F2] flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {stage === 'validating'
                      ? 'Inspecting video format & SHA-256...'
                      : stage === 'uploading'
                      ? `Uploading to Primary Object Storage (${progressPct}%)`
                      : stage === 'uploading_assets'
                      ? 'Uploading thumbnail & captions...'
                      : 'Publishing metadata & backup queue...'}
                  </span>
                  <span className="font-mono tabular-nums">{progressPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                  <div className="h-full bg-[#1877F2] transition-all" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              resetAll();
              onClose();
            }}
            className="min-h-[44px] px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-medium disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !videoFile || !inspection}
              onClick={() => handleUploadSubmit(true)}
              className="min-h-[44px] px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
            >
              Save Draft
            </button>
            <button
              type="button"
              disabled={busy || !videoFile || !inspection}
              onClick={() => handleUploadSubmit(false)}
              className="min-h-[44px] px-5 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Publish Reel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
