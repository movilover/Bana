import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
vi.mock('@/src/contexts/AuthContext', () => ({ useAuth: () => ({ firebaseUser: { uid: 'u1', emailVerified: true }, profile: { username: 'u', displayName: 'U' }, openAuthModal: vi.fn() }) }));
vi.mock('@/src/contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/src/firebase', () => ({ db: {}, storage: {}, auth: {} }));
vi.mock('firebase/firestore');
vi.mock('firebase/storage');
vi.mock('firebase/auth');
import { ReelUploadModal } from '@/src/components/reels/ReelUploadModal';
afterEach(cleanup);
describe('Reel upload screen fields', () => {
  it('has exactly the requested fields and actions', () => {
    render(<ReelUploadModal isOpen onClose={() => {}} onUploaded={() => {}} />);
    const t = document.body.textContent || '';
    for (const s of ['Select Video File', 'Video Title', 'Caption', 'Description', 'Optional', 'Hashtags', 'Audio / Sound Name', 'Discovery Category', 'Audience', 'Closed Captions', 'Save Draft', 'Publish Reel', 'Cancel']) {
      expect(t, s).toContain(s);
    }
    expect((screen.getByText('Publish Reel').closest('button') as HTMLButtonElement).disabled).toBe(true); // no video yet
  });
});
