import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';

const calls: any[] = [];
vi.mock('firebase/firestore', () => ({
  doc: (_db: any, col: string, id: string) => ({ col, id }),
  setDoc: vi.fn(async (ref: any, data: any) => { calls.push(['set', ref.col, ref.id, data.reactionType]); }),
  deleteDoc: vi.fn(async (ref: any) => { calls.push(['delete', ref.col, ref.id]); }),
  updateDoc: vi.fn(async (ref: any, data: any) => { calls.push(['update', ref.col, ref.id, JSON.stringify(data)]); }),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  increment: (n: number) => ({ inc: n }),
  serverTimestamp: () => 'TS',
}));
vi.mock('@/src/firebase', () => ({ db: {} }));

import { writeCommentReaction } from '@/src/lib/commentReactions';
import * as fs from 'firebase/firestore';

beforeEach(() => { calls.length = 0; });

describe('writeCommentReaction (one reaction per user, counts move correctly)', () => {
  it('add: creates commentLikes/{comment}_{uid} with the type and increments likesCount by 1', async () => {
    await writeCommentReaction({ commentId: 'c1', uid: 'u1', previous: null, next: 'love' });
    expect(calls[0]).toEqual(['set', 'commentLikes', 'c1_u1', 'love']);
    expect(calls[1][0]).toBe('update');
    expect(calls[1][3]).toBe(JSON.stringify({ likesCount: { inc: 1 } }));
  });
  it('remove: deletes the doc and decrements by 1', async () => {
    await writeCommentReaction({ commentId: 'c1', uid: 'u1', previous: 'love', next: null });
    expect(calls[0]).toEqual(['delete', 'commentLikes', 'c1_u1']);
    expect(calls[1][3]).toBe(JSON.stringify({ likesCount: { inc: -1 } }));
  });
  it('change: total count is untouched', async () => {
    await writeCommentReaction({ commentId: 'c1', uid: 'u1', previous: 'like', next: 'wow' });
    expect(calls.some((c) => c[0] === 'update' && c[1] === 'comments')).toBe(false);
    expect(calls.at(-1)[3]).toBe('wow');
  });
  it('change falls back to delete + create when rules deny updates', async () => {
    (fs.setDoc as any).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await writeCommentReaction({ commentId: 'c1', uid: 'u1', previous: 'like', next: 'sad' });
    expect(calls.map((c) => c[0])).toEqual(['delete', 'set']);
    expect(calls[1][3]).toBe('sad');
  });
  it('same-user doc id is deterministic, so duplicates are impossible', async () => {
    await writeCommentReaction({ commentId: 'cX', uid: 'uY', previous: null, next: 'like' });
    await writeCommentReaction({ commentId: 'cX', uid: 'uY', previous: null, next: 'like' });
    const ids = calls.filter((c) => c[0] === 'set').map((c) => c[2]);
    expect(new Set(ids).size).toBe(1);
  });
});
