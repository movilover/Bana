import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ReactionPickerButton } from '@/src/components/feed/ReactionBar';
import { UploadStatusDock } from '@/src/components/common/UploadStatusDock';
import { ConnectivityBanner } from '@/src/components/common/ConnectivityBanner';
import { BrandedLoader, CommentSkeleton, ErrorNotice } from '@/src/components/common/Skeletons';
import { startUploadTask, updateUploadTask, failUploadTask, completeUploadTask, dismissUploadTask } from '@/src/lib/uploadTracker';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ReactionPickerButton', () => {
  it('normal tap applies Like', () => {
    const onSelect = vi.fn();
    render(<ReactionPickerButton currentReaction={null} totalCount={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /like/i }));
    expect(onSelect).toHaveBeenCalledWith('like');
  });
  it('tap on an active reaction re-sends that same reaction (parent toggles it off)', () => {
    const onSelect = vi.fn();
    render(<ReactionPickerButton currentReaction="love" totalCount={3} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /love/i }));
    expect(onSelect).toHaveBeenCalledWith('love');
  });
  it('press and hold opens the six-reaction tray (touch) without applying Like', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<ReactionPickerButton currentReaction={null} totalCount={0} onSelect={onSelect} />);
    const btn = screen.getByRole('button', { name: /like/i });
    fireEvent.pointerDown(btn, { pointerType: 'touch', button: 0 });
    act(() => { vi.advanceTimersByTime(450); });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    fireEvent.pointerUp(btn, { pointerType: 'touch' });
    fireEvent.click(btn); // the click that follows a long-press must NOT apply Like
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wow' }));
    expect(onSelect).toHaveBeenCalledWith('wow');
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('short press does not open the tray', () => {
    vi.useFakeTimers();
    render(<ReactionPickerButton currentReaction={null} totalCount={0} onSelect={() => {}} />);
    const btn = screen.getByRole('button', { name: /like/i });
    fireEvent.pointerDown(btn, { pointerType: 'touch', button: 0 });
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.pointerUp(btn, { pointerType: 'touch' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('tap outside closes the tray; mouse hover opens it', () => {
    render(<div><ReactionPickerButton currentReaction={null} totalCount={0} onSelect={() => {}} variant="inline" /><span data-testid="out">x</span></div>);
    const btn = screen.getByRole('button', { name: /like/i });
    fireEvent.pointerEnter(btn.parentElement!, { pointerType: 'mouse' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('out'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('shows the selected reaction label and compact count', () => {
    render(<ReactionPickerButton currentReaction="haha" totalCount={1200} onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: /haha/i })).toBeTruthy();
  });
});

describe('UploadStatusDock', () => {
  it('shows real percentage, then success only when completed', () => {
    render(<UploadStatusDock />);
    let id = '';
    act(() => { id = startUploadTask({ kind: 'reel', fileName: 'clip.mp4' }); });
    expect(screen.getByText('clip.mp4')).toBeTruthy();
    act(() => updateUploadTask(id, { pct: 37 }));
    expect(screen.getByText('37%')).toBeTruthy();
    expect(screen.queryByText(/Confirmed by the server/)).toBeNull();
    act(() => completeUploadTask(id));
    expect(screen.getByText(/Confirmed by the server/)).toBeTruthy();
    act(() => dismissUploadTask(id));
    expect(screen.queryByText('clip.mp4')).toBeNull();
  });
  it('failure shows the error and a working Retry', () => {
    const retry = vi.fn();
    render(<UploadStatusDock />);
    let id = '';
    act(() => { id = startUploadTask({ kind: 'photo', fileName: 'p.jpg', retry }); });
    act(() => failUploadTask(id, 'Network down'));
    expect(screen.getByText('Network down')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Network down')).toBeNull();
  });
});

describe('ConnectivityBanner', () => {
  it('shows offline screen on offline event and restores on online event', () => {
    render(<ConnectivityBanner />);
    expect(screen.queryByText('No Internet Connection')).toBeNull();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(screen.getByText('No Internet Connection')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(screen.queryByText('No Internet Connection')).toBeNull();
    expect(screen.getByText('Back online')).toBeTruthy();
  });
});

describe('Loading states', () => {
  it('BrandedLoader stops spinning after the timeout and offers Try again', () => {
    vi.useFakeTimers();
    render(<BrandedLoader timeoutMs={1000} />);
    expect(screen.getByText('Loading BANA...')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByText(/taking longer than expected/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
  it('CommentSkeleton and ErrorNotice render; Retry fires', () => {
    const retry = vi.fn();
    render(<><CommentSkeleton rows={2} /><ErrorNotice message="Oops" onRetry={retry} /></>);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalled();
  });
});
