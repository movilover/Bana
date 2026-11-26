import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/src/contexts/AuthContext', () => ({
  useAuth: () => ({ firebaseUser: { uid: 'u1', emailVerified: true }, profile: { username: 'u', displayName: 'U', avatarUrl: '' }, openAuthModal: vi.fn() }),
}));
vi.mock('@/src/contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/src/components/reels/ReelUploadModal', () => ({ ReelUploadModal: () => <div data-testid="reel-screen">REEL SCREEN</div> }));
vi.mock('@/src/components/voice/VoiceRecorderAndPlayer', () => ({ VoiceRecorder: () => <div>voice</div> }));
vi.mock('@/src/firebase', () => ({ db: {}, storage: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), getDocs: vi.fn(async () => ({ docs: [] })),
  addDoc: vi.fn(), doc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), serverTimestamp: () => 'TS', onSnapshot: vi.fn(() => () => {}),
  Timestamp: { now: () => ({}) }, increment: vi.fn(), getDoc: vi.fn(),
}));

import { CreateModal } from '@/src/components/create/CreateModal';

afterEach(cleanup);
const base = { isOpen: true, onClose: () => {}, onCreated: () => {} } as any;
const text = () => document.body.textContent || '';

describe('Upload screens are strictly separated', () => {
  it('Post screen: post fields only, no Story/Reel UI', () => {
    render(<CreateModal {...base} initialMode="text" />);
    expect(text()).toContain('Create Post');
    expect(text()).toContain('Publish');
    expect(text()).toContain('Save Draft');
    expect(text()).not.toMatch(/Create Story|Publish Story|Reel|Sound|Video Title/);
    expect(screen.queryByRole('tab', { name: /story/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /reel/i })).toBeNull();
  });
  it('Story screen: story fields only', () => {
    render(<CreateModal {...base} initialMode="story" />);
    expect(text()).toContain('Create Story');
    expect(text()).toContain('Publish Story');
    expect(text()).not.toMatch(/Hashtags|Tag people|Discovery Category|Save Draft|Poll|Reel/);
  });
  it('Reel mode opens the dedicated Reel upload screen only', () => {
    render(<CreateModal {...base} initialMode="reel" />);
    expect(screen.getByTestId('reel-screen')).toBeTruthy();
    expect(text()).not.toMatch(/Create Post|Create Story/);
  });
  it('Chooser offers Post / Story / Reel and each opens its own screen', () => {
    const { unmount } = render(<CreateModal {...base} initialMode="text" startWithChooser />);
    expect(screen.getByText('Post')).toBeTruthy();
    expect(screen.getByText('Story')).toBeTruthy();
    expect(screen.getByText('Reel')).toBeTruthy();
    fireEvent.click(screen.getByText('Story').closest('button')!);
    expect(text()).toContain('Create Story');
    expect(text()).not.toMatch(/Create Post|Reel/);
    unmount();
    render(<CreateModal {...base} initialMode="text" startWithChooser />);
    fireEvent.click(screen.getByText('Reel').closest('button')!);
    expect(screen.getByTestId('reel-screen')).toBeTruthy();
  });
  it('Post kinds switcher never contains Story or Reel and Poll shows poll fields', () => {
    render(<CreateModal {...base} initialMode="text" />);
    fireEvent.click(screen.getByRole('tab', { name: /poll/i }));
    expect(screen.getByPlaceholderText(/Ask a poll question/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /photos/i }));
    expect(text()).toContain('Add photos');
  });
});
