import {
  canViewAudience,
  connectionPair,
  relationshipFor,
  sharedModuleOrder,
  transitionAllowed,
  type ConnectionState,
} from './social';
import { resolveFeatureAccess } from './portal';
const row = (
  state: ConnectionState['state'],
  requestedBy = 'a',
  blockedBy: string[] = [],
): ConnectionState => ({
  lowId: 'a',
  highId: 'b',
  state,
  requestedBy,
  blockedBy,
  mutedBy: [],
});
describe('social authorization policy', () => {
  it('uses a canonical pair and directional request views', () => {
    expect(connectionPair('b', 'a')).toBe(connectionPair('a', 'b'));
    expect(relationshipFor(row('pending'), 'a', 'b')).toBe('outgoing');
    expect(relationshipFor(row('pending'), 'b', 'a')).toBe('incoming');
    expect(relationshipFor(row('accepted'), 'b', 'a')).toBe('friends');
  });
  it('only lets the receiver accept/decline and the sender cancel', () => {
    expect(transitionAllowed(row('pending'), 'a', 'accept')).toBe(false);
    expect(transitionAllowed(row('pending'), 'a', 'decline')).toBe(false);
    expect(transitionAllowed(row('pending'), 'b', 'accept')).toBe(true);
    expect(transitionAllowed(row('pending'), 'b', 'cancel')).toBe(false);
    expect(transitionAllowed(row('pending'), 'a', 'cancel')).toBe(true);
    expect(transitionAllowed(row('pending'), 'c', 'accept')).toBe(false);
  });
  it('blocks either-direction relationships and allows only the owner to unblock', () => {
    for (const actor of ['a', 'b'])
      for (const action of [
        'request',
        'accept',
        'decline',
        'cancel',
        'unfriend',
        'mute',
        'unmute',
      ] as const)
        expect(
          transitionAllowed(row('accepted', 'a', ['a']), actor, action),
        ).toBe(false);
    expect(transitionAllowed(row('none', 'a', ['a']), 'a', 'unblock')).toBe(
      true,
    );
    expect(transitionAllowed(row('none', 'a', ['a']), 'b', 'unblock')).toBe(
      false,
    );
    expect(transitionAllowed(row('none'), 'b', 'accept')).toBe(false);
  });
  it('requires explicit visibility and never treats private as visible to friends', () => {
    for (const friends of [true, false]) {
      expect(canViewAudience(undefined, friends)).toBe(false);
      expect(canViewAudience('private', friends)).toBe(false);
      expect(canViewAudience('public', friends)).toBe(true);
    }
    expect(canViewAudience('friends', false)).toBe(false);
    expect(canViewAudience('friends', true)).toBe(true);
  });
  it('intersects audience, both accounts’ flags and selection, in Home order', () => {
    const ownerAccess = resolveFeatureAccess('developer');
    const viewerAccess = resolveFeatureAccess('internal');
    const input = {
      selected: ['nutrition', 'money', 'stocks', 'epam'] as const,
      ownerAccess,
      viewerAccess,
      visibility: {
        nutrition: 'friends',
        money: 'public',
        stocks: 'private',
        epam: 'public',
      } as const,
      order: ['nutrition', 'cashflow'],
      friends: true,
    };
    expect(
      sharedModuleOrder({ ...input, selected: [...input.selected] }),
    ).toEqual(['nutrition', 'money']);
    expect(
      sharedModuleOrder({
        ...input,
        selected: [...input.selected],
        friends: false,
      }),
    ).toEqual(['money']);
    expect(
      sharedModuleOrder({
        ...input,
        selected: [...input.selected],
        viewerAccess: resolveFeatureAccess('production'),
      }),
    ).toEqual(['nutrition']);
    expect(
      sharedModuleOrder({
        ...input,
        selected: ['money'],
        ownerAccess: { ...ownerAccess, money: false },
      }),
    ).toEqual([]);
  });
  it('keeps social disabled for production and configurable independently of modules', () => {
    expect(resolveFeatureAccess('production').social).toBe(false);
    expect(resolveFeatureAccess('internal').social).toBe(true);
    expect(resolveFeatureAccess('production', { social: true }).money).toBe(
      false,
    );
  });
});
