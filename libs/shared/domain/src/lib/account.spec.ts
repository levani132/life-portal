import { exportRecord, isStorageKey, storageKeysIn } from './account';

describe('account export helpers', () => {
  it('finds stored files at any depth and nothing that only looks like a key', () => {
    const rows = [
      { key: 'media/u1/abc.jpg', posterKey: 'media/u1/abc-poster.jpg' },
      { image: { key: 'foods/u1/f1-9.jpg', width: 10 } },
      { training: { exercises: [{ key: 'bench-press', image: { key: 'posts/u1/training/x.jpg' } }] } },
      { avatarKey: 'avatars/u1/a.jpg', wallpaper: 'dusk', wallpaperKey: 'wallpapers/u1/w.jpg' },
      { name: 'Coca-Cola', key: 'coca-cola', logo: { key: 'brands/b1-2.jpg' } },
      { linkKey: 'media/u1/not-a-file.jpg', note: 'media/u1/in-text.jpg' },
    ];
    expect([...storageKeysIn(rows)].sort()).toEqual([
      'avatars/u1/a.jpg',
      'brands/b1-2.jpg',
      'foods/u1/f1-9.jpg',
      'media/u1/abc-poster.jpg',
      'media/u1/abc.jpg',
      'posts/u1/training/x.jpg',
      // Spec 048: a portal's own wallpaper is a file to delete with the account; a preset is not.
      'wallpapers/u1/w.jpg',
    ]);
    expect(isStorageKey('../etc/passwd.jpg')).toBe(false);
    expect(isStorageKey('media/u1/abc.exe')).toBe(false);
  });

  it('exports a record without credentials, hashes, link keys or storage locations', () => {
    const id = { toString: () => '64aa' };
    Object.setPrototypeOf(id, class ObjectId {}.prototype);
    const out = exportRecord({
      _id: id,
      userId: 'u1',
      passwordHash: 'x',
      refreshTokenHash: 'y',
      tokenHash: 'z',
      ipHash: 'h',
      linkKey: 'secret',
      linkViewers: ['u2'],
      key: 'coca-cola',
      image: { key: 'foods/u1/f.jpg', width: 3 },
      createdAt: new Date('2026-11-22T10:00:00Z'),
      nested: [{ secretThing: 1, kcal: 200, none: undefined }],
    });
    expect(out).toEqual({
      id: '64aa',
      userId: 'u1',
      key: 'coca-cola',
      image: { width: 3 },
      createdAt: '2026-11-22T10:00:00.000Z',
      nested: [{ kcal: 200 }],
    });
  });
});
