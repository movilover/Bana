import React, { useEffect, useState } from 'react';
import {
  X,
  Users,
  Shield,
  UserPlus,
  UserMinus,
  LogOut,
  BellOff,
  Bell,
  Camera,
  Check,
  Crown,
} from 'lucide-react';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type { BanaConversation, BanaUser } from '@/src/types/bana';
import { Avatar } from '@/src/components/common/Avatar';
import { ConfirmDialog } from '@/src/components/common/ConfirmDialog';
import { compressImageFile, uploadMediaWithProgress } from '@/src/lib/mediaUtils';

export function GroupManageModal({
  isOpen,
  conversation,
  onClose,
  onLeftGroup,
}: {
  isOpen: boolean;
  conversation: BanaConversation | null;
  onClose: () => void;
  onLeftGroup: () => void;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();

  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupAvatar, setGroupAvatar] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [directoryUsers, setDirectoryUsers] = useState<BanaUser[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);

  useEffect(() => {
    if (!isOpen || !conversation) return;
    setGroupName(conversation.groupName || '');
    setGroupDescription(conversation.groupDescription || '');
    setGroupAvatar(conversation.groupAvatar || '');
    getDocs(query(collection(db, 'users'), limit(35)))
      .then((snap) => {
        setDirectoryUsers(snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<BanaUser, 'uid'>) })));
      })
      .catch(() => {});
  }, [isOpen, conversation]);

  if (!isOpen || !conversation || !firebaseUser) return null;

  const adminIds = conversation.adminIds || [];
  const isGroupAdmin = adminIds.includes(firebaseUser.uid);
  const isMuted = (conversation.mutedBy || []).includes(firebaseUser.uid);

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isGroupAdmin || !groupName.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'conversations', conversation.id), {
        groupName: groupName.trim().slice(0, 80),
        groupDescription: groupDescription.trim().slice(0, 240),
        groupAvatar: groupAvatar.trim(),
        updatedAt: serverTimestamp(),
      });
      toast.success('Group details updated.');
    } catch (err: any) {
      toast.error(err?.message || 'Unable to update group details.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    if (!isGroupAdmin || !file.type.startsWith('image/')) return;
    setUploadingAvatar(true);
    try {
      const processed = await compressImageFile(file);
      const url = await uploadMediaWithProgress(
        `groups/${firebaseUser.uid}/${conversation.id}_${Date.now()}.webp`,
        processed
      );
      setGroupAvatar(url);
      await updateDoc(doc(db, 'conversations', conversation.id), {
        groupAvatar: url,
        updatedAt: serverTimestamp(),
      });
      toast.success('Group photo updated.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to upload group photo.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleToggleMute = async () => {
    await updateDoc(doc(db, 'conversations', conversation.id), {
      mutedBy: isMuted ? arrayRemove(firebaseUser.uid) : arrayUnion(firebaseUser.uid),
    }).catch(() => {});
    toast.info(isMuted ? 'Group notifications unmuted.' : 'Group notifications muted.');
  };

  const handleAddParticipant = async (user: BanaUser) => {
    if (!isGroupAdmin) return;
    if (conversation.participantIds.includes(user.uid)) return;
    const nextMeta = {
      ...(conversation.participantMeta || {}),
      [user.uid]: {
        displayName: user.displayName,
        username: user.username,
        avatarUrl: user.avatarUrl || '',
      },
    };
    try {
      await updateDoc(doc(db, 'conversations', conversation.id), {
        participantIds: arrayUnion(user.uid),
        participantMeta: nextMeta,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Added ${user.displayName} to group.`);
    } catch (err: any) {
      toast.error(err?.message || 'Could not add participant.');
    }
  };

  const handleRemoveParticipant = async (uid: string) => {
    if (!isGroupAdmin || uid === firebaseUser.uid) return;
    try {
      await updateDoc(doc(db, 'conversations', conversation.id), {
        participantIds: arrayRemove(uid),
        adminIds: arrayRemove(uid),
        updatedAt: serverTimestamp(),
      });
      toast.info('Participant removed from group.');
    } catch (err: any) {
      toast.error(err?.message || 'Could not remove participant.');
    }
  };

  const handleToggleAdmin = async (uid: string) => {
    if (!isGroupAdmin) return;
    const targetIsAdmin = adminIds.includes(uid);
    if (targetIsAdmin && adminIds.length <= 1) {
      toast.info('A group must keep at least one admin.');
      return;
    }
    try {
      await updateDoc(doc(db, 'conversations', conversation.id), {
        adminIds: targetIsAdmin ? arrayRemove(uid) : arrayUnion(uid),
        updatedAt: serverTimestamp(),
      });
      toast.success(targetIsAdmin ? 'Admin role removed.' : 'Member promoted to group admin.');
    } catch (err: any) {
      toast.error(err?.message || 'Could not update admin role.');
    }
  };

  const handleLeaveGroup = async () => {
    try {
      const nextParticipants = conversation.participantIds.filter((id) => id !== firebaseUser.uid);
      const nextAdmins = adminIds.filter((id) => id !== firebaseUser.uid);
      // Ensure at least one remaining member inherits admin if the last admin leaves
      const finalAdmins =
        nextAdmins.length > 0 || nextParticipants.length === 0 ? nextAdmins : [nextParticipants[0]];

      await updateDoc(doc(db, 'conversations', conversation.id), {
        participantIds: nextParticipants,
        adminIds: finalAdmins,
        updatedAt: serverTimestamp(),
      });
      setConfirmLeave(false);
      onClose();
      onLeftGroup();
      toast.info('You left the group conversation.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to leave group.');
    }
  };

  const candidates = directoryUsers.filter(
    (u) =>
      !conversation.participantIds.includes(u.uid) &&
      `${u.displayName} ${u.username}`.toLowerCase().includes(addSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-brand" />
            <h3 className="font-display font-bold text-base">Group Details & Members</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close group management"
            className="h-8 w-8 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* Group Identity */}
          <form onSubmit={handleSaveDetails} className="space-y-3">
            <div className="flex items-center gap-3.5">
              <div className="relative">
                <Avatar src={groupAvatar} name={groupName || 'Group'} size="lg" />
                {isGroupAdmin && (
                  <label className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-brand text-white flex items-center justify-center cursor-pointer shadow">
                    <Camera className="w-3.5 h-3.5" />
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingAvatar}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleAvatarUpload(f);
                      }}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <input
                  type="text"
                  value={groupName}
                  disabled={!isGroupAdmin}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group Name"
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm font-semibold disabled:opacity-75"
                />
                <input
                  type="text"
                  value={groupDescription}
                  disabled={!isGroupAdmin}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder={isGroupAdmin ? 'Add group description...' : 'No group description'}
                  className="w-full h-8 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs disabled:opacity-75"
                />
              </div>
            </div>

            {isGroupAdmin && (
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 rounded-xl bg-brand hover:bg-brand-hover text-white font-semibold disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Group Info'}
              </button>
            )}
          </form>

          {/* Quick Actions */}
          <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <button
              type="button"
              onClick={handleToggleMute}
              className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 font-semibold flex items-center justify-center gap-2 hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              {isMuted ? <Bell className="w-4 h-4 text-brand" /> : <BellOff className="w-4 h-4" />}
              {isMuted ? 'Unmute Notifications' : 'Mute Notifications'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="h-10 rounded-xl border border-red-200 dark:border-red-900 text-red-600 font-semibold flex items-center justify-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <LogOut className="w-4 h-4" /> Leave Group
            </button>
          </div>

          {/* Participant List */}
          <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <h4 className="font-display font-bold text-sm">
              Members ({conversation.participantIds.length})
            </h4>
            <div className="space-y-1.5">
              {conversation.participantIds.map((pid) => {
                const meta = conversation.participantMeta?.[pid];
                const isAdminMember = adminIds.includes(pid);
                const isSelf = pid === firebaseUser.uid;
                return (
                  <div
                    key={pid}
                    className="flex items-center justify-between gap-2 p-2 rounded-xl bg-neutral-50 dark:bg-neutral-900/60"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={meta?.avatarUrl} name={meta?.displayName || 'Member'} size="sm" />
                      <div className="min-w-0">
                        <p className="font-semibold truncate flex items-center gap-1.5">
                          <span>
                            {meta?.displayName || pid}
                            {isSelf ? ' (You)' : ''}
                          </span>
                          {isAdminMember && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-brand/10 text-brand text-[10px] font-bold">
                              <Crown className="w-2.5 h-2.5" /> Admin
                            </span>
                          )}
                        </p>
                        {meta?.username && (
                          <p className="text-[11px] text-neutral-500 truncate">@{meta.username}</p>
                        )}
                      </div>
                    </div>

                    {isGroupAdmin && !isSelf && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleAdmin(pid)}
                          title={isAdminMember ? 'Demote admin' : 'Promote to admin'}
                          className="p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-white dark:hover:bg-neutral-800"
                        >
                          <Shield className={`w-3.5 h-3.5 ${isAdminMember ? 'text-brand' : 'text-neutral-400'}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveParticipant(pid)}
                          title="Remove from group"
                          className="p-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <UserMinus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Admin-Only Add Members */}
          {isGroupAdmin && (
            <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
              <h4 className="font-display font-bold text-sm flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-brand" /> Add Members
              </h4>
              <input
                type="search"
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                placeholder="Search BANA users to add..."
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
              />
              <div className="max-h-36 overflow-y-auto space-y-1">
                {candidates.slice(0, 8).map((u) => (
                  <div
                    key={u.uid}
                    className="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{u.displayName}</p>
                        <p className="text-[11px] text-neutral-500 truncate">@{u.username}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddParticipant(u)}
                      className="px-2.5 py-1 rounded-lg bg-brand text-white font-semibold inline-flex items-center gap-1 shrink-0"
                    >
                      <Check className="w-3 h-3" /> Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmLeave}
        title="Leave Group Chat"
        description={`Are you sure you want to leave "${conversation.groupName || 'this group'}"? You will need a group admin to re-add you later.`}
        confirmLabel="Leave Group"
        onConfirm={handleLeaveGroup}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
