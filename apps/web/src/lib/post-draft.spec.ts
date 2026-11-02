import { splitPostDraft } from './post-draft';
it('keeps a short title and separates the caption at the first newline', () => {
  expect(splitPostDraft('Breakfast\nA good start\nMore here')).toEqual({
    title: 'Breakfast',
    caption: 'A good start\nMore here',
  });
  expect(splitPostDraft('a'.repeat(70))).toEqual({
    title: 'a'.repeat(70),
    caption: '',
  });
});
it('preserves long opening text as a caption without inventing a title', () => {
  const text = 'a'.repeat(71) + '\nMore here';
  expect(splitPostDraft(text)).toEqual({ title: '', caption: text });
  expect(splitPostDraft('Title\r\nCaption')).toEqual({
    title: 'Title',
    caption: 'Caption',
  });
});
