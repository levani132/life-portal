import { ASSISTANT_CAP_DEFAULTS, ASSISTANT_CAP_NONE } from '@life-portal/shared-types';
import { assistantCap, assistantDefaults, underAssistantCap } from './assistant';

describe('assistant caps (spec 041)', () => {
  const defaults = ASSISTANT_CAP_DEFAULTS;
  it('uses the default until the owner sets an override for the person', () => {
    expect(assistantCap({ kind: 'comment', defaults, developer: false })).toBe(defaults.comment);
    expect(assistantCap({ kind: 'comment', defaults, override: { comment: 5 }, developer: false })).toBe(5);
    expect(assistantCap({ kind: 'like', defaults, override: { comment: 5 }, developer: false })).toBe(defaults.like);
  });
  it('has no cap for the owner, or where a cap is lifted', () => {
    expect(assistantCap({ kind: 'post', defaults, developer: true })).toBeNull();
    expect(assistantCap({ kind: 'post', defaults, override: { post: ASSISTANT_CAP_NONE }, developer: false })).toBeNull();
    expect(assistantCap({ kind: 'post', defaults: { ...defaults, post: ASSISTANT_CAP_NONE }, developer: false })).toBeNull();
  });
  it('ignores a malformed override', () => {
    expect(assistantCap({ kind: 'post', defaults, override: { post: -7 }, developer: false })).toBe(defaults.post);
    expect(assistantCap({ kind: 'post', defaults, override: { post: 1.5 }, developer: false })).toBe(defaults.post);
  });
  it('counts up to the cap and no further; zero allows nothing', () => {
    expect(underAssistantCap(9, 10)).toBe(true);
    expect(underAssistantCap(10, 10)).toBe(false);
    expect(underAssistantCap(0, 0)).toBe(false);
    expect(underAssistantCap(1_000_000, null)).toBe(true);
  });
  it('fills stored defaults with the code’s for anything missing or wrong', () => {
    expect(assistantDefaults({ post: 3, like: 'many' })).toEqual({ ...defaults, post: 3 });
    expect(assistantDefaults(null)).toEqual(defaults);
  });
});
