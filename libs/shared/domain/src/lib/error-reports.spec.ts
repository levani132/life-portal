import { errorFingerprint, isServerFault, pagePattern, scrubErrorText, scrubStack } from './error-reports';

describe('scrubErrorText', () => {
  it('removes what could identify a person or carry their data', () => {
    const scrubbed = scrubErrorText('Cast to ObjectId failed for value "64f0c1e2a3b4c5d6e7f80912" at ana@example.com, token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef, amount 123456');
    expect(scrubbed).toBe('Cast to ObjectId failed for value "<value>" at <email>, token <token>, amount <n>');
    expect(scrubErrorText('user 64f0c1e2a3b4c5d6e7f80912 and 3f2b1c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f')).toBe('user <id> and <uuid>');
    expect(scrubErrorText("food 'Chicken, 250 g' is too long")).toBe("food '<value>' is too long");
  });

  it('keeps the shape of the error and its small numbers', () => {
    expect(scrubErrorText('Cannot read properties of undefined (reading map) after 3 tries')).toBe('Cannot read properties of undefined (reading map) after 3 tries');
  });

  it('cuts long text and survives nothing', () => {
    expect(scrubErrorText('word '.repeat(200))).toHaveLength(300);
    expect(scrubErrorText(undefined)).toBe('');
  });
});

describe('scrubStack', () => {
  it('keeps the first lines, without query strings', () => {
    const stack = ['TypeError: boom', ...Array.from({ length: 30 }, (_, i) => `    at fn${i} (https://app.example/_next/chunk.js?dpl=abc:1:2)`)].join('\n');
    const kept = scrubStack(stack)!;
    expect(kept.split('\n')).toHaveLength(12);
    expect(kept).not.toContain('dpl=');
    expect(scrubStack(undefined)).toBeUndefined();
  });
});

describe('pagePattern', () => {
  it('turns ids into :id and drops the query and hash', () => {
    expect(pagePattern('/posts/64f0c1e2a3b4c5d6e7f80912?k=secretkey#top')).toBe('/posts/:id');
    expect(pagePattern('/training/sessions/42/edit')).toBe('/training/sessions/:id/edit');
    expect(pagePattern('/nutrition')).toBe('/nutrition');
    expect(pagePattern('')).toBe('/');
  });
});

describe('errorFingerprint', () => {
  const base = { source: 'api', name: 'TypeError', message: 'boom', where: 'GET /posts/:id' };
  it('is the same for the same error and different for another', () => {
    expect(errorFingerprint(base)).toBe(errorFingerprint({ ...base }));
    expect(errorFingerprint(base)).not.toBe(errorFingerprint({ ...base, where: 'GET /posts' }));
    expect(errorFingerprint(base)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('isServerFault', () => {
  it('counts a crash and a 5xx, not a refusal', () => {
    expect(isServerFault(undefined)).toBe(true);
    expect(isServerFault(500)).toBe(true);
    expect(isServerFault(503)).toBe(true);
    expect(isServerFault(404)).toBe(false);
    expect(isServerFault(409)).toBe(false);
  });
});
