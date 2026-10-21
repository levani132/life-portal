import {
  MODULE_IDS,
  type Audience,
  type ConnectionAction,
  type FeatureAccess,
  type ModuleId,
  type Relationship,
} from '@life-portal/shared-types';
export interface ConnectionState {
  lowId: string;
  highId: string;
  state: 'none' | 'pending' | 'accepted';
  requestedBy?: string;
  blockedBy: string[];
  mutedBy: string[];
}
export function connectionPair(a: string, b: string) {
  return [a, b].sort().join(':');
}
export function relationshipFor(
  row: ConnectionState | null,
  viewerId: string,
  targetId: string,
): Relationship {
  if (viewerId === targetId) return 'self';
  if (!row) return 'none';
  if (row.blockedBy.includes(viewerId)) return 'blocked';
  if (row.blockedBy.length) return 'none';
  if (row.state === 'accepted') return 'friends';
  if (row.state === 'pending')
    return row.requestedBy === viewerId ? 'outgoing' : 'incoming';
  return 'none';
}
export function transitionAllowed(
  row: ConnectionState,
  actor: string,
  action: ConnectionAction,
): boolean {
  if (![row.lowId, row.highId].includes(actor)) return false;
  if (action === 'unblock') return row.blockedBy.includes(actor);
  if (action === 'block') return true;
  if (row.blockedBy.length) return false;
  if (action === 'request') return row.state === 'none';
  if (action === 'accept' || action === 'decline')
    return row.state === 'pending' && row.requestedBy !== actor;
  if (action === 'cancel')
    return row.state === 'pending' && row.requestedBy === actor;
  return row.state === 'accepted';
}
export function canViewAudience(
  audience: Audience | undefined,
  friends: boolean,
): boolean {
  return audience === 'public' || (audience === 'friends' && friends);
}
export const MODULE_CARD_IDS: Record<ModuleId, string> = {
  nutrition: 'nutrition',
  money: 'cashflow',
  stocks: 'stocks',
  loans: 'loans',
  items: 'items',
  personal: 'personal',
  projects: 'projects',
  epam: 'board:epam',
};
const DEFAULT_ORDER: Record<ModuleId, number> = {
  loans: 1,
  money: 2,
  items: 3,
  stocks: 4,
  projects: 10,
  epam: 10,
  personal: 20,
  nutrition: 25,
};
export function sharedModuleOrder(input: {
  selected: ModuleId[];
  ownerAccess: FeatureAccess;
  viewerAccess: FeatureAccess;
  visibility: Partial<Record<ModuleId, Audience>>;
  order: string[];
  friends: boolean;
}): ModuleId[] {
  const rank = (id: ModuleId) => {
    const i = input.order.indexOf(MODULE_CARD_IDS[id]);
    return i < 0 ? 1000 + DEFAULT_ORDER[id] : i;
  };
  return MODULE_IDS.filter(
    (id) =>
      id !== 'epam' &&
      input.selected.includes(id) &&
      input.ownerAccess[id] &&
      input.viewerAccess[id] &&
      canViewAudience(input.visibility[id], input.friends),
  ).sort((a, b) => rank(a) - rank(b));
}
