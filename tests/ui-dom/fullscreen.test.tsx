import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('@/src/contexts/AuthContext', () => ({ useAuth: () => ({ firebaseUser: { uid: 'u1' }, profile: { username: 'u', displayName: 'U' }, openAuthModal: vi.fn() }) }));
vi.mock('@/src/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore');
vi.mock('firebase/storage');
vi.mock('@/src/lib/firestoreQuery', () => ({ subscribeWithIndexFallback: () => () => {}, sortByCreatedAtAsc: () => 0, sortByCreatedAtDesc: () => 0 }));
vi.mock('@/src/components/voice/VoiceRecorderAndPlayer', () => ({ VoicePlayer: () => null, VoiceRecorder: () => null }));
vi.mock('@/src/components/common/LiveVerifiedBadge', () => ({ LiveVerifiedBadge: () => null }));
import { FullscreenVideoModal } from '@/src/components/feed/FullscreenVideoModal';
afterEach(cleanup);
const post: any = { id: 'p1', authorId: 'a1', authorName: 'A', authorUsername: 'a', authorAvatar: '', content: 'x', type: 'video', mediaUrls: ['v.mp4'], createdAt: null };
const props = (isOpen: boolean) => ({ isOpen, post, videoUrl: 'v.mp4', currentReaction: null, likesCount: 0, commentsCount: 0, saved: false, onReact: () => {}, onToggleSave: () => {}, onOpenShare: () => {}, onClose: () => {} });
describe('FullscreenVideoModal', () => {
  it('opening after being closed does not crash (conditional-hook regression)', () => {
    const { rerender, container } = render(<MemoryRouter><FullscreenVideoModal {...props(false)} /></MemoryRouter>);
    expect(container.innerHTML).toBe('');
    expect(() => rerender(<MemoryRouter><FullscreenVideoModal {...props(true)} /></MemoryRouter>)).not.toThrow();
    expect(container.querySelector('video')).toBeTruthy();
    expect(() => rerender(<MemoryRouter><FullscreenVideoModal {...props(false)} /></MemoryRouter>)).not.toThrow();
  });
});
