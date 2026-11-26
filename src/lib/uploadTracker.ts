import { useSyncExternalStore } from 'react';

/**
 * Lightweight in-memory registry of media uploads so progress stays visible after the upload
 * screen is closed or the user navigates to another page of the app.
 *
 * Limits (by design, no fake behaviour): uploads continue while the BANA tab stays open
 * (in-app navigation is fine). They stop if the tab is closed/reloaded or the OS kills the browser.
 */
export type UploadTaskKind = 'post' | 'photo' | 'video' | 'reel' | 'story';
export type UploadTaskStatus = 'uploading' | 'processing' | 'success' | 'failed';

export interface UploadTask {
  id: string;
  kind: UploadTaskKind;
  fileName: string;
  pct: number;
  status: UploadTaskStatus;
  error?: string;
  retry?: () => void;
  cancel?: () => void;
  startedAt: number;
}

let tasks: UploadTask[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function commit(next: UploadTask[]) {
  tasks = next;
  emit();
}

export function startUploadTask(input: {
  kind: UploadTaskKind;
  fileName: string;
  retry?: () => void;
  cancel?: () => void;
}): string {
  const id = `up_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  commit([...tasks, { id, pct: 0, status: 'uploading', startedAt: Date.now(), ...input }]);
  return id;
}

export function updateUploadTask(id: string, patch: Partial<Omit<UploadTask, 'id'>>) {
  if (!tasks.some((t) => t.id === id)) return;
  commit(tasks.map((t) => (t.id === id ? { ...t, ...patch, pct: Math.max(0, Math.min(100, Math.round(patch.pct ?? t.pct))) } : t)));
}

export function completeUploadTask(id: string) {
  updateUploadTask(id, { status: 'success', pct: 100, error: undefined });
  window.setTimeout(() => dismissUploadTask(id), 4000);
}

export function failUploadTask(id: string, error: string) {
  updateUploadTask(id, { status: 'failed', error });
}

export function dismissUploadTask(id: string) {
  commit(tasks.filter((t) => t.id !== id));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useUploadTasks(): UploadTask[] {
  return useSyncExternalStore(subscribe, () => tasks, () => tasks);
}

export function hasActiveUploads(): boolean {
  return tasks.some((t) => t.status === 'uploading' || t.status === 'processing');
}
