'use client';
import clsx from 'clsx';
import { GlassPill } from './glass-pill';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  Ban,
  BellOff,
  BellRing,
  Camera,
  Check,
  Eye,
  Lock,
  Image as ImageIcon,
  ImagePlus,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
  UserMinus,
  UserX,
} from 'lucide-react';
import type {
  BadgeId,
  PublicBadge,
  ConnectionAction,
  MediaConfig,
  SharedWidget,
  SocialPerson,
  SocialProfile,
} from '@life-portal/shared-types';
import { useSocialApi } from '../lib/social-hooks';
export { useSocialApi, SOCIAL_REFRESH } from '../lib/social-hooks';
import { DailyFoodDiary } from './shared-food-diary';
import { PhotoViewer } from './photo-viewer';
import {
  BadgeCollection,
  BadgeDetail,
  EquippedBadges,
  OwnBadgeSheet,
  equippedOf,
  useMyBadges,
  usePersonBadges,
} from './badges';
import { checkBadges } from '../lib/badges';
import { PostsList } from './posts';
import { badgeDefinition, type PortalState } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { actingPageId } from '../lib/identity';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { PageMark } from './identity-switcher';
import { FollowToggle, OfficialMark, PageFollow } from './follow';
import { ErrorNote, Input, Spinner } from './ui';
import { Avatar } from './avatar';
import { DropdownMenu, type DropdownItem } from './dropdown-menu';
import { useAuth } from '../lib/auth-context';
import { prepareAvatar, uploadMedia } from '../lib/media';
import { useOfflineCopy } from '../lib/offline/use-offline-copy';
import { requestNotificationOffer } from './notifications';
import { messagingAvailable, openConversation } from './messages';
import { PortalGrid } from './portal-grid';
import { PortalWallpaperLayer, WallpaperPicker } from './portal-wallpaper';

export function SharedWidgets({
  widgets,
  compact = false,
  ownerId,
  preview,
}: {
  widgets: SharedWidget[];
  ownerId?: string;
  preview?: 'normal' | 'friend' | 'stranger';
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact ? 'mt-4 grid gap-3 sm:grid-cols-2' : 'grid gap-4 sm:grid-cols-2'
      }
    >
      {widgets.map((widget) => (
        <section
          key={widget.module}
          className={`rounded-xl border border-border bg-surface/50 p-4 ${widget.hasDiary && !compact ? 'sm:col-span-2' : ''}`}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{widget.title}</h3>
            <span className="text-[10px] text-ink-faint">
              {widget.audience === 'friends' ? 'Friends' : 'Everyone'}
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            {widget.stats.map((stat) => (
              <div key={stat.label}>
                <dd className="tabular break-words text-base font-semibold">
                  {stat.value}
                  {stat.estimated && (
                    <span className="ml-1 text-[10px] font-normal text-ink-faint">
                      est.
                    </span>
                  )}
                </dd>
                <dt className="mt-1 text-[11px] text-ink-muted">
                  {stat.label}
                </dt>
              </div>
            ))}
          </dl>
          {widget.hasDiary &&
            (compact ? (
              <p className="mt-3 text-xs text-accent">
                Daily food diary shared · open profile to view
              </p>
            ) : ownerId ? (
              <DailyFoodDiary
                key={`${ownerId}:${preview}`}
                userId={ownerId}
                preview={preview}
              />
            ) : null)}
        </section>
      ))}
    </div>
  );
}
/** Friend actions and opening a chat, shared by the profile header and the people cards. */
function useConnection(person: SocialPerson, onChanged?: () => void) {
  const action = useAction();
  const router = useRouter();
  async function message() {
    await action.run(
      async () => router.push(`/messages/${await openConversation(person.userId)}`),
      { revalidate: false },
    );
  }
  async function act(value: ConnectionAction) {
    const success = await action.run(
      async () => {
        await api.put(`/social/connections/${person.userId}`, {
          action: value,
        });
        await revalidate('/social');
        await revalidate('/nutrition/foods/public');
      },
      { revalidate: false },
    );
    if (success) {
      if (value === 'request') requestNotificationOffer('friend');
      if (value === 'accept') checkBadges();
      onChanged?.();
    }
  }
  return { act, message, pending: action.pending, error: action.error };
}
export function ConnectionActions({
  person,
  onChanged,
  compact = false,
}: {
  person: SocialPerson;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const { act, message, ...action } = useConnection(person, onChanged);
  const portal = useApi<PortalState>('/portal');
  const relationship = person.relationship;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {relationship === 'none' && (
          <button
            type="button"
            className="btn-primary"
            disabled={action.pending}
            onClick={() => void act('request')}
          >
            Add friend
          </button>
        )}
        {relationship === 'incoming' && (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={action.pending}
              onClick={() => void act('accept')}
            >
              Accept request
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={action.pending}
              onClick={() => void act('decline')}
            >
              Decline
            </button>
          </>
        )}
        {relationship === 'outgoing' && (
          <button
            type="button"
            className="btn-ghost"
            disabled={action.pending}
            onClick={() => void act('cancel')}
          >
            Cancel request
          </button>
        )}
        {relationship === 'blocked' && (
          <button
            type="button"
            className="btn-ghost"
            disabled={action.pending}
            onClick={() => void act('unblock')}
          >
            Unblock
          </button>
        )}
        {relationship === 'friends' && (
          <>
            {messagingAvailable(portal.data?.access) && (
              <button
                type="button"
                className="btn-primary"
                disabled={action.pending}
                onClick={() => void message()}
              >
                Message
              </button>
            )}
            <span className="flex items-center px-1 text-sm text-success">
              Friends
            </span>
            <button
              type="button"
              className="btn-ghost"
              disabled={action.pending}
              onClick={() => void act('unfriend')}
            >
              Unfriend
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={action.pending}
              onClick={() => void act(person.muted ? 'unmute' : 'mute')}
            >
              {person.muted ? 'Unmute updates' : 'Mute updates'}
            </button>
          </>
        )}
        {!compact && relationship !== 'self' && relationship !== 'blocked' && (
          <button
            type="button"
            className="btn-ghost text-danger"
            title="Blocking removes this friendship and hides sharing in both directions"
            disabled={action.pending}
            onClick={() => void act('block')}
          >
            Block
          </button>
        )}
      </div>
      {action.pending && (
        <p role="status" className="mt-2 text-xs text-ink-muted">
          Updating connection…
        </p>
      )}
      {action.error && (
        <div className="mt-3" role="alert">
          <ErrorNote message={action.error} />
        </div>
      )}
    </div>
  );
}
export function PersonCard({
  person,
  showActions = true,
}: {
  person: SocialPerson;
  showActions?: boolean;
}) {
  return (
    <article className="card p-5">
      <div className="flex items-start gap-3">
        <Avatar name={person.displayName} url={person.avatarUrl} size={44} />
        <div className="flex-1">
          {person.relationship === 'blocked' ? (
            <h2 className="font-semibold">{person.displayName}</h2>
          ) : (
            <Link
              href={`/people/${person.userId}`}
              className="font-semibold hover:text-accent-hover"
            >
              {person.displayName}
            </Link>
          )}
          <p className="text-xs text-ink-faint">@{person.username}</p>
          {person.bio && (
            <p className="mt-2 break-words text-sm text-ink-muted">
              {person.bio}
            </p>
          )}
        </div>
      </div>
      {person.widgets && <SharedWidgets widgets={person.widgets} compact />}
      {person.widgets?.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-faint">
          <LockKeyhole size={14} />
          No widgets shared with you.
        </p>
      )}
      {showActions &&
        (actingPageId() ? (
          // Spec 040: using the app as a page, the action is Follow. A page has no friends.
          person.relationship !== 'blocked' && <FollowToggle id={person.userId} following={person.following} name={person.displayName} />
        ) : (
          person.relationship !== 'friends' && <ConnectionActions person={person} compact />
        ))}
    </article>
  );
}
type Preview = 'normal' | 'friend' | 'stranger';
const PREVIEW_LABEL: Record<Preview, string> = {
  normal: 'My shared profile',
  friend: 'A friend',
  stranger: 'Someone else',
};
/**
 * The header photo overlaps the band. The letter fallback's tint is see-through, so it sits on a
 * disc of the card's own colour (or the gradient would show through) ringed off from the band.
 */
function BigAvatar({ name, url }: { name: string; url?: string }) {
  return (
    <span className="inline-flex rounded-full bg-surface-raised ring-4 ring-surface-raised">
      <Avatar name={name} url={url} size={96} />
    </span>
  );
}
/** Someone else's photo: tapping it opens it on the whole screen. */
function ViewableAvatar({ name, url }: { name: string; url?: string }) {
  const [open, setOpen] = useState(false);
  if (!url) return <BigAvatar name={name} url={url} />;
  return (
    <>
      <button type="button" className="inline-flex rounded-full" aria-label={`View ${name}’s photo`} onClick={() => setOpen(true)}>
        <BigAvatar name={name} url={url} />
      </button>
      {open && <PhotoViewer url={url} alt={`${name}’s photo`} onClose={() => setOpen(false)} />}
    </>
  );
}
/** The round, quiet icon buttons that sit on the profile's header band. */
const HEADER_ICON =
  'relative flex h-9 w-9 items-center justify-center rounded-full bg-surface/70 text-ink backdrop-blur transition hover:bg-surface';

/**
 * A profile. Your own profile looks the same however you get to it (the Profile tab, your name on
 * a post, a link): it is decided by who you are, never by the route. The header carries the
 * actions as icons on its band, so nothing pushes the posts down a row of buttons.
 */
/**
 * Equipped badges under the name (spec 022). Your own live profile reads your collection, so a
 * tap opens the equip sheet; "View as" and other people read exactly what others are sent.
 */
function HeaderBadges({ userId, live }: { userId: string; live: boolean }) {
  const mine = useMyBadges(live);
  const others = usePersonBadges(live ? null : userId);
  const [detail, setDetail] = useState<PublicBadge | null>(null);
  const [own, setOwn] = useState<BadgeId | null>(null);
  const badges = live ? (mine.data ? equippedOf(mine.data) : []) : (others.data?.equipped ?? []);
  return (
    <>
      <EquippedBadges
        badges={badges}
        onSelect={(badge) => (live ? setOwn(badge.badgeId) : setDetail(badge))}
      />
      <BadgeDetail badge={detail} onClose={() => setDetail(null)} />
      {live && mine.data && (
        <OwnBadgeSheet badgeId={own} mine={mine.data} onClose={() => setOwn(null)} />
      )}
    </>
  );
}
/**
 * `/profile?badge=<id>` (the "badge earned" notification and Activity): reports the badge once,
 * then drops the parameter so a refresh or a later tab switch does not reopen it. Its own
 * Suspense boundary, because `useSearchParams` needs one.
 */
function BadgeDeepLink({ onOpen }: { onOpen: (badgeId: BadgeId) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const badge = params.get('badge');
  useEffect(() => {
    if (!badge) return;
    if (badgeDefinition(badge)) onOpen(badge as BadgeId);
    router.replace('/profile', { scroll: false });
    // `onOpen` is recreated each render; the parameter is what matters.
  }, [badge]);
  return null;
}

export function ProfileView({ userId }: { userId?: string }) {
  const { user } = useAuth();
  // The identity in use: acting as a page, the person behind it is someone else here.
  const own = !userId || userId === (actingPageId() ?? user?.id);
  const [preview, setPreview] = useState<Preview>('normal');
  // Spec 046: a person's portal opens on the Portal; a page (which shares no modules) on its posts.
  const [tab, setTab] = useState<'posts' | 'badges' | 'about'>('about');
  const [openBadge, setOpenBadge] = useState<BadgeId | null>(null);
  const [choosingWallpaper, setChoosingWallpaper] = useState(false);
  // Spec 033: offline, the shell's kept portal state still says the Posts tab exists.
  const portalLive = useApi<PortalState>('/portal');
  const portal = { data: useOfflineCopy('shell:portal', portalLive).data };
  const path = own
    ? `/social/me?preview=${preview}`
    : `/social/profiles/${userId}`;
  const profile = useSocialApi<SocialProfile>(path);
  if (profile.error)
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorNote message="This profile isn’t available. It may be private or the connection may have changed." />
        <Link href="/friends" className="btn-ghost mt-4">
          Back to friends
        </Link>
      </div>
    );
  if (profile.isLoading || !profile.data)
    return <Spinner label="Opening profile…" />;
  const person = profile.data;
  const viewAs = own ? preview : 'normal';
  const posts =
    !!portal.data?.access.foodPosts &&
    portal.data.access.nutrition &&
    portal.data.access.social;
  // The badge collection holds private progress, so it is only on your own, un-previewed profile.
  // Spec 046: a person's posts follow their widgets on the Portal tab; a page (no widgets) keeps
  // its posts as its first tab.
  const tabs = [
    ...(person.isPage ? [] : (['about'] as const)),
    ...(posts && person.isPage ? (['posts'] as const) : []),
    ...(own && preview === 'normal' && !person.isPage ? (['badges'] as const) : []),
  ];
  const shown = tabs.find((value) => value === tab) ?? tabs[0];
  // Spec 048: a wallpaper fills the screen behind the portal, and the header card turns to glass.
  // A page has one too: set here by whoever is acting as it, or by its assistant.
  const wallpaper = person.wallpaper;
  const canChooseWallpaper = own && preview === 'normal';
  return (
    <div className="mx-auto max-w-3xl">
      {wallpaper && <PortalWallpaperLayer wallpaper={wallpaper} />}
      <section className={wallpaper ? 'relative rounded-xl border border-border/60 bg-surface-raised/55 backdrop-blur-xl' : 'card relative'}>
        <div
          aria-hidden
          // Just enough band for the buttons beside the photo: a taller one was empty space.
          className={clsx('h-14 rounded-t-xl', !wallpaper && 'bg-gradient-to-br from-accent/30 via-special-solid/15 to-success-solid/10')}
        />
        {/* The buttons sit in the empty space right of the photo: yours, or what you can do here. */}
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          {own ? (
            <OwnHeaderActions
              person={person}
              preview={preview}
              setPreview={setPreview}
              onWallpaper={canChooseWallpaper ? () => setChoosingWallpaper(true) : undefined}
            />
          ) : (
            <>
              {!person.isPage && !actingPageId() && <ProfileActions person={person} compact />}
              <OtherHeaderActions person={person} />
            </>
          )}
        </div>
        <div className="px-5 pb-5">
          {/* The name sits beside the photo, under the buttons: the space right of the photo was
              empty, and the card is shorter for it (owner, 2026-11-28). */}
          <div className="-mt-8 flex items-stretch gap-3">
            <div className="shrink-0 self-start">
              {own ? (
                <AvatarEditor person={person} />
              ) : (
                <ViewableAvatar name={person.displayName} url={person.avatarUrl} />
              )}
            </div>
            {/* The name alone is centred on the photo; the username hangs under it, in the lower
                half. The top track may not shrink below the buttons' bottom edge (1.5rem into the
                photo's height), so a long name that wraps moves down instead of under them. */}
            <div className="grid min-w-0 flex-1 grid-rows-[minmax(1.5rem,1fr)_auto_minmax(min-content,1fr)]">
              <h1 className="row-start-2 min-w-0 break-words text-xl font-semibold leading-tight sm:text-2xl">
                {person.displayName}
                {person.official && <OfficialMark className="ml-1.5" />}
                {person.isPage && <PageMark className="ml-2" ai={person.aiManaged} />}
              </h1>
              <p className="row-start-3 mt-0.5 flex min-w-0 flex-wrap items-start gap-x-2 self-start text-sm text-ink-faint">
                <span className="truncate">@{person.username}</span>
                {!person.isPage && <RelationshipChip person={person} />}
              </p>
            </div>
          </div>
          {!person.isPage && <HeaderBadges userId={person.userId} live={own && preview === 'normal'} />}
          {person.bio && (
            <p className="mt-3 whitespace-pre-wrap break-words text-ink-muted">
              {person.bio}
            </p>
          )}
          {person.aiManaged && <p className="mt-2 text-xs text-ink-muted">This page is run with AI.</p>}
          {person.isPage && (
            <PageFollow
              page={person}
              own={own}
              canMarkOfficial={!actingPageId() && portal.data?.cohort === 'developer'}
              canMessage={messagingAvailable(portal.data?.access)}
            />
          )}
          {own ? (
            person.isPage ? null : <OwnStats person={person} />
          ) : person.isPage ? null : actingPageId() && person.relationship !== 'blocked' ? (
            <FollowToggle id={person.userId} following={person.following} name={person.displayName} />
          ) : null}
        </div>
      </section>
      {canChooseWallpaper && (
        <WallpaperPicker open={choosingWallpaper} current={person.wallpaper} onClose={() => setChoosingWallpaper(false)} />
      )}
      {own && preview !== 'normal' && (
        <div
          role="status"
          className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-2 text-sm"
        >
          <span className="flex items-center gap-2">
            <Eye size={16} className="shrink-0 text-accent" />
            Viewing as {preview === 'friend' ? 'a friend' : 'someone else'}
          </span>
          <button
            type="button"
            className="shrink-0 font-medium text-accent"
            onClick={() => setPreview('normal')}
          >
            Done
          </button>
        </div>
      )}
      {tabs.length > 1 && (
        <div
          className="glass-tabs relative mt-3 inline-flex gap-1 rounded-full border p-1"
          role="tablist"
          aria-label="Profile sections"
        >
          <GlassPill />
          {tabs.map((value) => (
            <button
              type="button"
              key={value}
              role="tab"
              aria-selected={shown === value}
              className={
                shown === value
                  ? 'glass-tab-on rounded-full border border-transparent px-4 py-1.5 text-sm font-medium'
                  : 'rounded-full border border-transparent px-4 py-1.5 text-sm text-ink-muted hover:text-ink'
              }
              onClick={() => setTab(value)}
            >
              {value === 'posts' ? 'Posts' : value === 'badges' ? 'Badges' : 'Portal'}
            </button>
          ))}
        </div>
      )}
      {own && (
        <Suspense fallback={null}>
          <BadgeDeepLink
            onOpen={(badgeId) => {
              setPreview('normal');
              setTab('badges');
              setOpenBadge(badgeId);
            }}
          />
        </Suspense>
      )}
      {shown === 'posts' ? (
        <div className="mt-2">
          <PostsList authorId={person.userId} preview={viewAs} />
        </div>
      ) : shown === 'badges' ? (
        <BadgeCollection open={openBadge} onOpened={() => setOpenBadge(null)} />
      ) : (
        // The portal's spacing is tight throughout, in step with its 8 px edge.
        <div className="mt-2">
          {person.widgets.length ? (
            <>
              {/* Spec 046: the portal's widgets, read only; arranged only by its owner, as themselves. */}
              <PortalGrid widgets={person.widgets} arrangeable={own && viewAs === 'normal' && !actingPageId()} ownerId={person.userId} viewAs={viewAs} />
            </>
          ) : own ? (
            <div className="card p-6 text-sm text-ink-muted">Your portal shows no widgets to this audience yet. Choose who sees each module below.</div>
          ) : null}
          {/* Spec 046: on your own portal, the way to who sees each widget and what it shows. */}
          {own && viewAs === 'normal' && !actingPageId() && (
            <div className="mt-2 flex justify-center">
              <Link href="/settings/privacy" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink">
                <Lock size={13} aria-hidden="true" />
                Who sees your portal
              </Link>
            </div>
          )}
          {posts && (
            <div className={person.widgets.length || own ? 'mt-3' : ''}>
              <PostsList authorId={person.userId} preview={viewAs} />
            </div>
          )}
          {!posts && !person.widgets.length && !own && <div className="card p-6 text-sm text-ink-muted">Nothing on this portal is shared with you.</div>}
        </div>
      )}
    </div>
  );
}

function RelationshipChip({ person }: { person: SocialPerson }) {
  const label = {
    friends: 'Friends',
    outgoing: 'Request sent',
    incoming: 'Wants to be friends',
    blocked: 'Blocked',
  }[person.relationship as string];
  if (!label) return null;
  return (
    <span
      className={
        person.relationship === 'friends'
          ? 'rounded-full bg-success-solid/10 px-2 py-0.5 text-[11px] font-medium text-success'
          : 'rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-muted'
      }
    >
      {label}
    </span>
  );
}

/** Your own header icons: view as, share, edit, and the menu that used to be a tab. */
function OwnHeaderActions({
  person,
  preview,
  setPreview,
  onWallpaper,
}: {
  person: SocialProfile;
  preview: Preview;
  setPreview: (value: Preview) => void;
  onWallpaper?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const portal = useApi<PortalState>('/portal');
  const requests = useApi<{ count: number }>(
    portal.data?.access.social ? '/social/requests/count' : null,
  );
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function share() {
    // Spec 046: a portal's address is its username.
    const url = person.username ? `${window.location.origin}/@${person.username}` : `${window.location.origin}/people/${person.userId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: person.displayName, url });
        return;
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
      }
    }
    if (!navigator.clipboard) return setShareUrl(url);
    navigator.clipboard
      .writeText(url)
      .then(() => setCopied(true))
      .catch(() => setShareUrl(url));
  }
  return (
    <>
      {onWallpaper && (
        <button type="button" className={HEADER_ICON} aria-label="Wallpaper" title="Wallpaper" onClick={onWallpaper}>
          <ImageIcon size={17} />
        </button>
      )}
      <DropdownMenu
        label="View my profile as"
        triggerClassName={HEADER_ICON}
        trigger={<Eye size={18} />}
        items={(Object.keys(PREVIEW_LABEL) as Preview[]).map((value) => ({
          label: PREVIEW_LABEL[value],
          checked: preview === value,
          onSelect: () => setPreview(value),
        }))}
      />
      <button
        type="button"
        className={HEADER_ICON}
        aria-label={copied ? 'Profile link copied' : 'Share my profile'}
        title={copied ? 'Link copied' : 'Share profile'}
        onClick={() => void share()}
      >
        {copied ? <Check size={18} className="text-success" /> : <Share2 size={18} />}
      </button>
      <Link
        href="/settings/profile"
        className={HEADER_ICON}
        aria-label="Edit profile"
        title="Edit profile"
      >
        <Pencil size={17} />
      </Link>
      <Link href="/menu" className={HEADER_ICON} aria-label="Menu" title="Menu">
        <Menu size={18} />
        {!!requests.data?.count && (
          <span
            className="absolute right-1 top-1 h-2 w-2 rounded-full bg-info-solid"
            aria-label="Friend requests waiting"
          />
        )}
      </Link>
      {shareUrl && (
        <div className="absolute right-0 top-full mt-2 w-72">
          <Input
            aria-label="Your profile link"
            readOnly
            autoFocus
            value={shareUrl}
            onFocus={(event) => event.target.select()}
            onBlur={() => setShareUrl(null)}
          />
        </div>
      )}
    </>
  );
}

/** Someone else's "…": everything that is not the main action, so it takes no row of its own. */
function OtherHeaderActions({ person }: { person: SocialPerson }) {
  const { act, pending } = useConnection(person);
  const items: DropdownItem[] = [];
  const r = person.relationship;
  if (r === 'friends')
    items.push(
      {
        label: person.muted ? 'Unmute updates' : 'Mute updates',
        icon: person.muted ? <BellRing size={16} /> : <BellOff size={16} />,
        onSelect: () => void act(person.muted ? 'unmute' : 'mute'),
      },
      {
        label: 'Unfriend',
        icon: <UserMinus size={16} />,
        onSelect: () => {
          if (window.confirm(`Remove ${person.displayName} from your friends?`))
            void act('unfriend');
        },
      },
    );
  if (r === 'outgoing')
    items.push({
      label: 'Cancel request',
      icon: <UserX size={16} />,
      onSelect: () => void act('cancel'),
    });
  if (r !== 'blocked')
    items.push({
      label: 'Block',
      icon: <Ban size={16} />,
      danger: true,
      onSelect: () => {
        if (
          window.confirm(
            `Block ${person.displayName}? This removes the friendship and hides sharing in both directions.`,
          )
        )
          void act('block');
      },
    });
  if (!items.length) return null;
  return (
    <DropdownMenu
      label="More actions"
      triggerClassName={HEADER_ICON}
      trigger={<MoreHorizontal size={18} />}
      items={items.map((item) => ({ ...item, disabled: pending }))}
    />
  );
}

/** The one or two buttons worth a row: befriending, answering a request, messaging, unblocking. */
/**
 * What you can do on someone's profile. `compact` puts it in the header, beside the "…", as small
 * pills: the space right of their photo was otherwise empty.
 */
function ProfileActions({ person, compact = false }: { person: SocialPerson; compact?: boolean }) {
  const { act, message, pending, error } = useConnection(person);
  const portal = useApi<PortalState>('/portal');
  const r = person.relationship;
  const primary = compact ? 'btn-primary h-9 rounded-full px-4 py-0 text-sm' : 'btn-primary';
  const ghost = compact ? `${HEADER_ICON} w-auto px-3 text-sm` : 'btn-ghost';
  const buttons =
    r === 'none' ? (
      <button type="button" className={primary} disabled={pending} onClick={() => void act('request')}>
        Add friend
      </button>
    ) : r === 'incoming' ? (
      <>
        <button type="button" className={primary} disabled={pending} onClick={() => void act('accept')}>
          Accept request
        </button>
        <button type="button" className={ghost} disabled={pending} onClick={() => void act('decline')}>
          Decline
        </button>
      </>
    ) : r === 'friends' && messagingAvailable(portal.data?.access) ? (
      <button type="button" className={primary} disabled={pending} onClick={() => void message()}>
        Message
      </button>
    ) : r === 'blocked' ? (
      <button type="button" className={ghost} disabled={pending} onClick={() => void act('unblock')}>
        Unblock
      </button>
    ) : null;
  if (!buttons && !error) return null;
  if (compact)
    return (
      <>
        {buttons}
        {error && (
          <div className="absolute right-0 top-full z-10 mt-2 w-72" role="alert">
            <ErrorNote message={error} />
          </div>
        )}
      </>
    );
  return (
    <div className="mt-4">
      {buttons && <div className="flex flex-wrap gap-2">{buttons}</div>}
      {error && (
        <div className="mt-3" role="alert">
          <ErrorNote message={error} />
        </div>
      )}
    </div>
  );
}

/** Your friends (and waiting requests) and whether search can find you, on one quiet line. */
function OwnStats({ person }: { person: SocialProfile }) {
  const requests = useApi<{ count: number; more: boolean }>('/social/requests/count');
  const count = person.friendCount ?? 0;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Link href="/friends" className="flex items-center gap-1.5 hover:text-accent-hover">
        <span className="font-semibold tabular-nums">{count}</span>
        <span className="text-ink-muted">{count === 1 ? 'friend' : 'friends'}</span>
        {!!requests.data?.count && (
          <span
            className="ml-1 rounded-full bg-info-solid px-1.5 py-0.5 text-[10px] font-semibold text-white"
            aria-label={`${requests.data.count} pending friend requests`}
          >
            {requests.data.count}
            {requests.data.more ? '+' : ''} new
          </span>
        )}
      </Link>
      {!person.discoverable && (
        <Link
          href="/settings/profile"
          className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-ink-muted"
          title="People can still open your profile link."
        >
          <LockKeyhole size={13} />
          Hidden from search
        </Link>
      )}
    </div>
  );
}

/** Your own photo. Tapping it picks a new one; with a photo already there, it can also go. */
function AvatarEditor({ person }: { person: SocialProfile }) {
  const config = useApi<MediaConfig>('/media/config');
  const input = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  useEffect(() => () => {
    if (local) URL.revokeObjectURL(local);
  }, [local]);
  const picture = (
    <span className="relative inline-flex">
      <BigAvatar name={person.displayName} url={local ?? person.avatarUrl} />
      {progress !== null ? (
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-xs font-semibold text-white">
          {Math.round(progress * 100)}%
        </span>
      ) : (
        config.data?.available && (
          <span className="absolute bottom-0.5 right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface-raised bg-accent-solid text-on-accent">
            <Camera size={14} />
          </span>
        )
      )}
    </span>
  );
  if (!config.data?.available) return picture;

  async function choose(file: File) {
    setError(null);
    try {
      const media = await prepareAvatar(file);
      setLocal(media.previewUrl);
      setProgress(0);
      const mediaId = await uploadMedia(media, setProgress, new AbortController().signal);
      await api.put('/social/me/avatar', { mediaId });
      await Promise.all([revalidate('/social'), revalidate('/messages')]);
    } catch (e) {
      setLocal(null);
      setError(e instanceof Error ? e.message : 'Could not upload the photo.');
    } finally {
      setProgress(null);
    }
  }
  async function remove() {
    setError(null);
    try {
      await api.delete('/social/me/avatar');
      setLocal(null);
      await Promise.all([revalidate('/social'), revalidate('/messages')]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the photo.');
    }
  }
  const pick = () => input.current?.click();
  return (
    <div>
      {person.avatarUrl || local ? (
        <DropdownMenu
          label="Change profile photo"
          align="left"
          triggerClassName="inline-flex rounded-full"
          trigger={picture}
          items={[
            ...(person.avatarUrl
              ? [
                  {
                    label: 'View photo',
                    icon: <Eye size={16} />,
                    onSelect: () => setViewing(true),
                  },
                ]
              : []),
            {
              label: 'Choose a new photo',
              icon: <ImagePlus size={16} />,
              onSelect: pick,
            },
            {
              label: 'Remove photo',
              icon: <Trash2 size={16} />,
              danger: true,
              onSelect: () => void remove(),
            },
          ]}
        />
      ) : (
        <button
          type="button"
          className="inline-flex rounded-full"
          aria-label="Add a profile photo"
          disabled={progress !== null}
          onClick={pick}
        >
          {picture}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {viewing && person.avatarUrl && <PhotoViewer url={person.avatarUrl} alt="Your photo" onClose={() => setViewing(false)} />}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void choose(file);
        }}
      />
    </div>
  );
}
