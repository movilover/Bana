import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Users, Plus, MapPin, X, Calendar, Ticket } from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDoc,
  getDocs,
  addDoc,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  BANGLADESH_DISTRICTS,
  DISCOVERY_CATEGORIES,
  type BanaCommunity,
  type BanaEvent,
  type CommunityMemberRecord,
  type DiscoveryCategory,
} from '@/src/types/bana';
import { joinOrLeaveCommunity, setEventRsvpStatus } from '@/src/lib/communities';
import { AppShell } from '@/src/components/layout/AppShell';
import { ResilientImage } from '@/src/components/common/Avatar';
import { CommunityDetailView } from '@/src/components/communities/CommunityDetailView';
import { compressImageFile, uploadMediaWithProgress } from '@/src/lib/mediaUtils';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { getDocsWithIndexFallback, toMillis } from '@/src/lib/firestoreQuery';
import defaultCommunityCover from '@/src/assets/images/bana_community_cover_1794590889543.jpg';

const COMMUNITY_CATEGORIES = [
  'All Categories',
  'Technology',
  'Photography',
  'Local Culture',
  'Business',
  'Education',
  'Sports',
  'Arts',
  'General',
];

export function CommunitiesPage() {
  const { communityId } = useParams<{ communityId?: string }>();
  const navigate = useNavigate();
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('tab') === 'events' ? 'events' : 'communities';

  const [communities, setCommunities] = useState<BanaCommunity[]>([]);
  const [memberships, setMemberships] = useState<Record<string, CommunityMemberRecord>>({});
  const [events, setEvents] = useState<BanaEvent[]>([]);
  const [eventRsvps, setEventRsvps] = useState<Record<string, 'going' | 'interested'>>({});
  const [districtFilter, setDistrictFilter] = useState('All Districts');
  const [categoryFilter, setCategoryFilter] = useState('All Categories');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<BanaCommunity | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [district, setDistrict] = useState('Dhaka');
  const [privacy, setPrivacy] = useState<'public' | 'private'>('public');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [rulesText, setRulesText] = useState(
    'Be respectful and constructive.\nNo spam or misleading promotions.'
  );
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Event creation modal state
  const [eventCreateOpen, setEventCreateOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [eventCategory, setEventCategory] = useState<DiscoveryCategory>('Technology');
  const [eventDistrict, setEventDistrict] = useState('Dhaka');
  const [eventVenue, setEventVenue] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('17:00');
  const [eventIsOnline, setEventIsOnline] = useState(false);
  const [eventOnlineUrl, setEventOnlineUrl] = useState('');
  const [eventCapacity, setEventCapacity] = useState('100');
  const [eventCoverFile, setEventCoverFile] = useState<File | null>(null);
  const [creatingEvent, setCreatingEvent] = useState(false);

  const loadCommunities = async () => {
    setLoading(true);
    try {
      const { items: list } = await getDocsWithIndexFallback<BanaCommunity>(
        query(
          collection(db, 'communities'),
          where('status', '==', 'active'),
          orderBy('membersCount', 'desc'),
          limit(50)
        ),
        query(collection(db, 'communities'), where('status', '==', 'active'), limit(60)),
        (a, b) => Number(b.membersCount || 0) - Number(a.membersCount || 0)
      );
      setCommunities(list.slice(0, 50));

      if (communityId) {
        const match = list.find((c) => c.id === communityId);
        if (match) {
          setSelected(match);
        } else {
          const single = await getDoc(doc(db, 'communities', communityId)).catch(() => null);
          if (single?.exists()) {
            setSelected({ id: single.id, ...(single.data() as Omit<BanaCommunity, 'id'>) });
          }
        }
      } else {
        setSelected(null);
      }

      if (firebaseUser) {
        const [memSnap, regSnap] = await Promise.all([
          getDocs(query(collection(db, 'communityMembers'), where('userId', '==', firebaseUser.uid))),
          getDocs(query(collection(db, 'eventRegistrations'), where('userId', '==', firebaseUser.uid))),
        ]);
        const map: Record<string, CommunityMemberRecord> = {};
        memSnap.docs.forEach((d) => {
          const data = d.data() as Omit<CommunityMemberRecord, 'id'>;
          map[data.communityId] = { id: d.id, ...data };
        });
        setMemberships(map);

        const rMap: Record<string, 'going' | 'interested'> = {};
        regSnap.docs.forEach((d) => {
          const data = d.data();
          rMap[String(data.eventId)] = data.rsvpStatus === 'interested' ? 'interested' : 'going';
        });
        setEventRsvps(rMap);
      }

      const evRes = await getDocsWithIndexFallback<BanaEvent>(
        query(collection(db, 'events'), where('status', '==', 'upcoming'), orderBy('eventDate', 'asc'), limit(40)),
        query(collection(db, 'events'), where('status', '==', 'upcoming'), limit(50)),
        (a, b) => toMillis(a.eventDate) - toMillis(b.eventDate)
      ).catch(() => null);
      if (evRes) {
        setEvents(evRes.items.slice(0, 40));
      }
    } catch (err) {
      logFirestoreError(err, OperationType.LIST, 'communities');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCommunities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, communityId]);

  const handleEventRsvp = async (ev: BanaEvent, nextStatus: 'going' | 'interested') => {
    if (!firebaseUser) return openAuthModal('Sign in to RSVP for BANA events.');
    try {
      const current = eventRsvps[ev.id] || null;
      const result = await setEventRsvpStatus({
        event: ev,
        uid: firebaseUser.uid,
        currentStatus: current,
        nextStatus,
      });
      setEventRsvps((prev) => {
        const copy = { ...prev };
        if (result) copy[ev.id] = result;
        else delete copy[ev.id];
        return copy;
      });
      loadCommunities();
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return openAuthModal('Sign in to host an event.');
    setCreatingEvent(true);
    setError(null);
    try {
      let coverUrl = '';
      if (eventCoverFile) {
        const comp = await compressImageFile(eventCoverFile, 1600);
        coverUrl = await uploadMediaWithProgress(
          `communities/${firebaseUser.uid}/ev_${Date.now()}_${comp.name}`,
          comp
        );
      }
      await addDoc(collection(db, 'events'), {
        organizerId: firebaseUser.uid,
        organizerName: profile.displayName,
        title: eventTitle.trim(),
        description: eventDesc.trim(),
        coverUrl,
        isOnline: eventIsOnline,
        onlineUrl: eventIsOnline ? eventOnlineUrl.trim() : '',
        category: eventCategory,
        district: eventDistrict === 'All Districts' ? 'Dhaka' : eventDistrict,
        venue: eventIsOnline ? 'Online Event' : eventVenue.trim(),
        eventDate,
        eventTime,
        capacity: Math.max(10, Number(eventCapacity) || 100),
        attendeesCount: 0,
        interestedCount: 0,
        status: 'upcoming',
        createdAt: serverTimestamp(),
      });
      setEventCreateOpen(false);
      setEventTitle('');
      setEventDesc('');
      setEventVenue('');
      setEventDate('');
      setEventCoverFile(null);
      toast.success('Event published!');
      loadCommunities();
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setCreatingEvent(false);
    }
  };

  const handleJoinToggle = async (c: BanaCommunity) => {
    if (!firebaseUser || !profile) return openAuthModal(`Sign in to join ${c.name}.`);
    try {
      const result = await joinOrLeaveCommunity({
        community: c,
        user: profile,
        existingMembership: memberships[c.id] || null,
      });
      toast.success(
        result === 'joined'
          ? `Joined ${c.name}!`
          : result === 'requested'
          ? 'Join request submitted.'
          : 'Left community.'
      );
      loadCommunities();
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    }
  };

  const handleCreateCommunity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return openAuthModal('Sign in to create a BANA community.');
    setCreating(true);
    setError(null);
    try {
      let coverUrl = '';
      if (coverFile) {
        const compressed = await compressImageFile(coverFile, 1600);
        coverUrl = await uploadMediaWithProgress(
          `communities/${firebaseUser.uid}/cover_${Date.now()}_${compressed.name}`,
          compressed
        );
      }

      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const docRef = await addDoc(collection(db, 'communities'), {
        name: name.trim(),
        slug: slug || `community-${Date.now()}`,
        description: description.trim(),
        category,
        district: district === 'All Districts' ? '' : district,
        coverUrl,
        avatarUrl: '',
        creatorId: firebaseUser.uid,
        privacy,
        requiresApproval,
        rules: rulesText
          .split('\n')
          .map((r) => r.trim())
          .filter(Boolean)
          .slice(0, 10),
        announcement: '',
        membersCount: 1,
        status: 'active',
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'communityMembers', `${docRef.id}_${firebaseUser.uid}`), {
        communityId: docRef.id,
        userId: firebaseUser.uid,
        userName: profile.displayName,
        userUsername: profile.username,
        userAvatar: profile.avatarUrl || '',
        role: 'owner',
        status: 'active',
        createdAt: serverTimestamp(),
      });

      setCreateOpen(false);
      setName('');
      setDescription('');
      setCoverFile(null);
      toast.success('Community created!');
      navigate(`/communities/${docRef.id}`);
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const filtered = communities.filter((c) => {
    if (districtFilter !== 'All Districts' && c.district !== districtFilter) return false;
    if (categoryFilter !== 'All Categories' && c.category !== categoryFilter) return false;
    if (search.trim()) {
      const hay = `${c.name} ${c.description} ${c.category} ${c.district || ''}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const filteredEvents = events.filter((ev) => {
    if (districtFilter !== 'All Districts' && ev.district !== districtFilter) return false;
    if (search.trim()) {
      const hay = `${ev.title} ${ev.description} ${ev.category} ${ev.district} ${ev.venue}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  if (selected) {
    return (
      <AppShell>
        <CommunityDetailView
          community={selected}
          onBack={() => {
            setSelected(null);
            navigate('/communities');
          }}
          onCommunityUpdated={(updated) => {
            setSelected(updated);
            setCommunities((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          }}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display font-extrabold text-2xl">Communities & Events</h1>
            <p className="text-xs text-neutral-500">
              Interest hubs, district groups, real-time group chats, polls, and live meetups.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start">
            {activeView === 'events' ? (
              <button
                type="button"
                onClick={() =>
                  firebaseUser
                    ? setEventCreateOpen(true)
                    : openAuthModal('Sign in to host an event.')
                }
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-hover transition-colors"
              >
                <Plus className="w-4 h-4" /> Host Event
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  firebaseUser
                    ? setCreateOpen(true)
                    : openAuthModal('Sign in to create a new BANA community.')
                }
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-hover transition-colors"
              >
                <Plus className="w-4 h-4" /> Create Community
              </button>
            )}
          </div>
        </div>

        {/* View Switcher */}
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeView === 'communities'
                ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400'
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Communities ({communities.length})
          </button>
          <button
            type="button"
            onClick={() => setSearchParams({ tab: 'events' })}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              activeView === 'events'
                ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" /> Local Events ({events.length})
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              activeView === 'events' ? 'Search events, venues, or topics...' : 'Search communities...'
            }
            className="flex-1 h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3.5 text-sm"
          />
          {activeView === 'communities' && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs font-medium"
            >
              {COMMUNITY_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          )}
          <select
            value={districtFilter}
            onChange={(e) => setDistrictFilter(e.target.value)}
            className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs font-medium"
          >
            {BANGLADESH_DISTRICTS.map((d) => (
              <option key={d} value={d}>
                {d === 'All Districts' ? 'Bangladesh: All Districts' : d}
              </option>
            ))}
          </select>
        </div>

        {activeView === 'events' ? (
          loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((k) => (
                <div
                  key={k}
                  className="h-52 rounded-2xl border border-neutral-200 dark:border-neutral-800 animate-pulse bg-neutral-100 dark:bg-neutral-900"
                />
              ))}
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-12 text-center space-y-3 bg-white dark:bg-neutral-900">
              <Calendar className="w-8 h-8 mx-auto text-neutral-400" />
              <h3 className="font-display font-bold text-base">No upcoming events found</h3>
              <p className="text-xs text-neutral-500">
                Host a tech meetup, workshop, or community gathering in your district or online.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredEvents.map((ev) => {
                const status = eventRsvps[ev.id] || null;
                const isFull = ev.capacity > 0 && ev.attendeesCount >= ev.capacity;
                return (
                  <div
                    key={ev.id}
                    className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col justify-between"
                  >
                    {ev.coverUrl && (
                      <ResilientImage src={ev.coverUrl} alt={ev.title} className="w-full h-36 object-cover" />
                    )}
                    <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-brand">
                          {ev.category} · {ev.district}
                        </p>
                        <h3 className="font-display font-bold text-base">{ev.title}</h3>
                        <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-3">
                          {ev.description}
                        </p>
                        <div className="pt-1 space-y-1 text-xs text-neutral-500">
                          <p className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" /> {ev.eventDate}
                            {ev.eventTime ? ` · ${ev.eventTime}` : ''}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5" />{' '}
                            {ev.isOnline ? 'Online Event' : ev.venue}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                        <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
                          {ev.attendeesCount} going · {ev.interestedCount || 0} interested
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEventRsvp(ev, 'interested')}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
                              status === 'interested'
                                ? 'border-brand bg-brand/10 text-brand'
                                : 'border-neutral-200 dark:border-neutral-700'
                            }`}
                          >
                            Interested
                          </button>
                          <button
                            type="button"
                            disabled={status !== 'going' && isFull}
                            onClick={() => handleEventRsvp(ev, 'going')}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                              status === 'going'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-brand text-white disabled:opacity-40'
                            }`}
                          >
                            <Ticket className="w-3.5 h-3.5" />
                            {status === 'going' ? 'Going ✓' : isFull ? 'Full' : 'Going'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((k) => (
              <div
                key={k}
                className="h-60 rounded-2xl border border-neutral-200 dark:border-neutral-800 animate-pulse bg-neutral-100 dark:bg-neutral-900"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-12 text-center space-y-3 bg-white dark:bg-neutral-900">
            <Users className="w-8 h-8 mx-auto text-neutral-400" />
            <h3 className="font-display font-bold text-base">No communities found</h3>
            <p className="text-xs text-neutral-500">
              Launch the first BANA community for your topic or district.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((c) => {
              const mem = memberships[c.id];
              return (
                <div
                  key={c.id}
                  className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/communities/${c.id}`)}
                    className="text-left"
                  >
                    <ResilientImage
                      src={c.coverUrl || defaultCommunityCover}
                      alt={c.name}
                      className="w-full h-36 object-cover"
                    />
                  </button>
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => navigate(`/communities/${c.id}`)}
                        className="font-display font-bold text-base hover:underline text-left"
                      >
                        {c.name}
                      </button>
                      <p className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>{c.category}</span>
                        {c.district && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5">
                              <MapPin className="w-3 h-3" /> {c.district}
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span className="font-mono tabular-nums">{c.membersCount} members</span>
                      </p>
                      <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2 mt-2">
                        {c.description}
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800">
                      <button
                        type="button"
                        onClick={() => navigate(`/communities/${c.id}`)}
                        className="text-xs font-semibold text-brand hover:underline"
                      >
                        Open Group
                      </button>
                      <button
                        type="button"
                        onClick={() => handleJoinToggle(c)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          mem?.status === 'active'
                            ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                            : 'bg-brand hover:bg-brand-hover text-white'
                        }`}
                      >
                        {mem?.status === 'active'
                          ? 'Joined'
                          : mem?.status === 'pending'
                          ? 'Pending'
                          : 'Join'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCommunity}
            className="w-full max-w-lg rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg">Create BANA Community</h2>
              <button type="button" onClick={() => setCreateOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Community Name (e.g. Dhaka Cyclists Collective)"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
            />

            <textarea
              rows={3}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this community about?"
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-sm"
            />

            <div className="grid grid-cols-2 gap-3">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                {COMMUNITY_CATEGORIES.filter((c) => c !== 'All Categories').map((cat) => (
                  <option key={cat}>{cat}</option>
                ))}
              </select>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                {BANGLADESH_DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <select
                value={privacy}
                onChange={(e) => setPrivacy(e.target.value as 'public' | 'private')}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                <option value="public">Public Community</option>
                <option value="private">Private Community</option>
              </select>
              <label className="flex items-center gap-2 text-xs px-3 border border-neutral-200 dark:border-neutral-800 rounded-xl">
                <input
                  type="checkbox"
                  checked={requiresApproval}
                  onChange={(e) => setRequiresApproval(e.target.checked)}
                />
                Require member approval
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Cover Photo (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
                className="text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Community Rules (one per line)</label>
              <textarea
                rows={3}
                value={rulesText}
                onChange={(e) => setRulesText(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={creating}
              className="w-full h-10 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating...' : 'Create Community'}
            </button>
          </form>
        </div>
      )}

      {eventCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateEvent}
            className="w-full max-w-lg rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg">Host Local or Online Event</h2>
              <button type="button" onClick={() => setEventCreateOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <input
              type="text"
              required
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              placeholder="Event Title (e.g. Dhaka React & Firebase Meetup)"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
            />

            <textarea
              rows={3}
              required
              value={eventDesc}
              onChange={(e) => setEventDesc(e.target.value)}
              placeholder="Agenda, speakers, and who should attend..."
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-sm"
            />

            <div className="grid grid-cols-2 gap-3">
              <select
                value={eventCategory}
                onChange={(e) => setEventCategory(e.target.value as DiscoveryCategory)}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                {DISCOVERY_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <select
                value={eventDistrict}
                onChange={(e) => setEventDistrict(e.target.value)}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                {BANGLADESH_DISTRICTS.filter((d) => d !== 'All Districts').map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={eventIsOnline}
                onChange={(e) => setEventIsOnline(e.target.checked)}
              />
              <span>This is an online event</span>
            </label>

            {eventIsOnline ? (
              <input
                type="url"
                value={eventOnlineUrl}
                onChange={(e) => setEventOnlineUrl(e.target.value)}
                placeholder="Event Join URL (https://...)"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
              />
            ) : (
              <input
                type="text"
                required
                value={eventVenue}
                onChange={(e) => setEventVenue(e.target.value)}
                placeholder="Venue / Address (e.g. Banani Road 11, Dhaka)"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
              />
            )}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-neutral-500 mb-1">Event Date</label>
                <input
                  type="date"
                  required
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-neutral-500 mb-1">Time</label>
                <input
                  type="time"
                  value={eventTime}
                  onChange={(e) => setEventTime(e.target.value)}
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] text-neutral-500 mb-1">Capacity</label>
                <input
                  type="number"
                  min={10}
                  max={10000}
                  required
                  value={eventCapacity}
                  onChange={(e) => setEventCapacity(e.target.value)}
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Cover Photo (optional)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setEventCoverFile(e.target.files?.[0] || null)}
                className="text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={creatingEvent}
              className="w-full h-10 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {creatingEvent ? 'Publishing Event...' : 'Publish Event'}
            </button>
          </form>
        </div>
      )}
    </AppShell>
  );
}
