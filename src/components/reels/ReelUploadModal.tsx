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
import {
  Dropzone,
  Field,
  ModalShell,
  ProgressBar,
  btnPrimary,
  btnSecondary,
  inputCls,
  textareaCls,
} from '@/src/components/create/uploadUi';
import {
  completeUploadTask,
  dismissUploadTask,
  failUploadTask,
  startUploadTask,
  updateUploadTask,
} from '@/src/lib/uploadTracker';
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
    const taskId = startUploadTask({
      kind: 'reel',
      fileName: videoFile.name,
      retry: () => {
        void handleUploadSubmit(asDraft);
      },
      cancel: () => controller.abort(),
    });

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
          onProgress: (p: number) => {
            setProgressPct(p);
            updateUploadTask(taskId, { pct: p });
          },
          abortSignal: controller.signal,
          queueBackup: true,
        }
      );

      setStage('uploading_assets');
      updateUploadTask(taskId, { status: 'processing', pct: 100 });
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
      updateUploadTask(taskId, { status: 'processing', pct: 100 });
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
      completeUploadTask(taskId);
      toast.success(asDraft ? 'Reel saved to Drafts.' : 'Reel published to BANA Reels.');
      onUploaded?.();
      window.setTimeout(() => {
        resetAll();
        onClose();
      }, 900);
    } catch (err: any) {
      logFirestoreError(err, OperationType.CREATE, 'reels');
      const msg = formatFirebaseErrorMessage(err);
      if (controller.signal.aborted) {
        dismissUploadTask(taskId);
        setErrorMsg('Upload cancelled.');
        setStage('upload_failed');
      } else {
        failUploadTask(taskId, msg);
        setErrorMsg(msg);
        setStage('upload_failed');
        toast.error(msg);
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const busy = ['validating', 'uploading', 'uploading_assets', 'saving_metadata'].includes(stage);
  const canSubmit = !busy && Boolean(videoFile) && Boolean(inspection);

  const stageLabel =
    stage === 'validating'
      ? 'Inspecting video...'
      : stage === 'uploading'
      ? 'Uploading video'
      : stage === 'uploading_assets'
      ? 'Uploading thumbnail & captions...'
      : 'Publishing...';

  return (
    <ModalShell
      icon={Film}
      title="Upload Reel"
      subtitle="MP4, WebM or MOV · up to 150 MB"
      onClose={() => {
        // Closing during an upload keeps it running; progress stays visible in the upload status card.
        if (busy) toast.info('Upload continues in the background. Keep BANA open until it finishes.');
        onClose();
      }}
      closeLabel="Close upload modal"
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              resetAll();
              onClose();
            }}
            className={`${btnSecondary} mr-auto`}
          >
            Cancel
          </button>
          <button type="button" disabled={!canSubmit} onClick={() => handleUploadSubmit(true)} className={btnSecondary}>
            Save Draft
          </button>
          <button type="button" disabled={!canSubmit} onClick={() => handleUploadSubmit(false)} className={btnPrimary}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Publish Reel
          </button>
        </>
      }
    >
      {!isVerifiedAccount && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
          Verify your email address before uploading Reels.
        </div>
      )}

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
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 text-white font-semibold shrink-0"
            >
              <RotateCcw className="w-3 h-3" /> Retry
            </button>
          )}
        </div>
      )}

      {stage === 'success' && (
        <div className="rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 p-3 text-xs font-medium text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Video uploaded with SHA-256 checksum &amp; queued for backup.</span>
        </div>
      )}

      {/* 1. Video upload */}
      <div className="space-y-3">
        {videoPreviewUrl ? (
          <>
            <div className="aspect-[9/16] max-h-[360px] mx-auto rounded-2xl bg-neutral-950 border border-neutral-200 dark:border-neutral-800 overflow-hidden">
              <video
                ref={previewVideoRef}
                src={videoPreviewUrl}
                poster={thumbPreviewUrl || undefined}
                controls
                playsInline
                className="w-full h-full object-contain bg-black"
              />
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className={`${btnSecondary} !min-h-[40px] !text-xs cursor-pointer`}>
                <Upload className="w-4 h-4" />
                Change Video
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => handleVideoSelected(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
              <label className={`${btnSecondary} !min-h-[40px] !text-xs cursor-pointer`}>
                <ImageIcon className="w-4 h-4" />
                {customThumbFile ? 'Change Cover' : 'Custom Cover'}
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
                className={`${btnSecondary} !min-h-[40px] !text-xs`}
              >
                <Camera className="w-4 h-4" />
                Use Frame
              </button>
            </div>

            {thumbPreviewUrl && (
              <div className="flex items-center gap-3 p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
                <img src={thumbPreviewUrl} alt="Selected thumbnail" className="h-12 w-9 rounded-lg object-cover" />
                <div className="flex-1 min-w-0 text-xs">
                  <p className="font-semibold truncate">Custom Cover Selected</p>
                  <p className="text-neutral-500">Ready for upload</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomThumbFile(null)}
                  aria-label="Remove custom cover"
                  className="h-9 w-9 flex items-center justify-center text-neutral-500 hover:text-brand"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        ) : (
          <Dropzone
            title="Select Video File"
            hint="MP4, WebM or MOV · up to 150 MB"
            accept="video/mp4,video/webm,video/quicktime"
            onPick={(picked) => handleVideoSelected(picked[0] || null)}
          />
        )}
      </div>

      {/* 2. Details */}
      <Field label="Video Title">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Give your Reel a clear title..."
          maxLength={120}
          className={inputCls}
        />
      </Field>

      <Field label="Caption">
        <textarea
          rows={3}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write a hook or summary for viewers..."
          className={textareaCls}
        />
      </Field>

      <Field label="Description" hint="Optional">
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add context, gear notes, or credits..."
          className={textareaCls}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Hashtags">
          <input
            type="text"
            value={hashtagsRaw}
            onChange={(e) => setHashtagsRaw(e.target.value)}
            placeholder="#dhaka #tech #bana"
            className={inputCls}
          />
        </Field>
        <Field label="Audio / Sound Name">
          <input
            type="text"
            value={soundName}
            onChange={(e) => setSoundName(e.target.value)}
            placeholder="Original Audio"
            className={inputCls}
          />
        </Field>
        <Field label="Discovery Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as DiscoveryCategory)}
            className={inputCls}
          >
            {DISCOVERY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Audience">
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'public' | 'followers' | 'only_me')}
            className={inputCls}
          >
            <option value="public">Public (Everyone)</option>
            <option value="followers">Followers Only</option>
            <option value="only_me">Only Me</option>
          </select>
        </Field>
      </div>

      {/* 3. Optional closed captions */}
      <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <Subtitles className="w-4 h-4 text-neutral-700 dark:text-neutral-300 shrink-0" />
          <span className="truncate">
            {captionsFile ? `Captions: ${captionsFile.name}` : 'Optional Closed Captions (.vtt)'}
          </span>
        </div>
        <label className={`${btnSecondary} !min-h-[40px] !text-xs shrink-0 cursor-pointer`}>
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
        <ProgressBar
          pct={progressPct}
          label={stage === 'uploading' ? `${stageLabel} (${progressPct}%)` : stageLabel}
        />
      )}
    </ModalShell>
  );
}
