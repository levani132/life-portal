import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PostComposer } from './post-composer';
import { api } from '../lib/api';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('../lib/api', () => ({ api: { post: jest.fn() } }));
jest.mock('../lib/hooks', () => ({
  revalidate: jest.fn(),
  useApi: (path: string | null) => ({
    data:
      path === '/media/config'
        ? { available: true, maxItems: 10, maxVideoSeconds: 30 }
        : path === '/nutrition/profile'
          ? { profile: { defaultFoodVisibility: 'public' } }
          : undefined,
  }),
}));
const source = { kind: 'food' as const, foodId: 'food' };
const preview = {
  previewHash: 'a'.repeat(64),
  publication: {
    kind: 'food',
    label: 'Oats',
    items: [
      {
        key: '0',
        name: 'Oats',
        unit: 'g',
        servingSize: 100,
        energyKcalPer100: 380,
        proteinMgPer100: 14000,
        carbMgPer100: 65000,
        fatMgPer100: 8000,
      },
    ],
  },
};
beforeEach(() => {
  jest.clearAllMocks();
  window.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  (api.post as jest.Mock).mockImplementation(async (path) =>
    path === '/posts/preview'
      ? preview
      : path === '/nutrition/foods'
        ? { id: 'new-food' }
        : path === '/nutrition/entries'
          ? { id: 'new-entry' }
          : { id: 'created' },
  );
});
it('opens directly into the selected preview using the configured audience', async () => {
  const view = render(
    <PostComposer
      initialSource={source}
      defaultAudience="public"
      onClose={jest.fn()}
    />,
  );
  await screen.findByText('Oats', { selector: 'h3' });
  expect(api.post).toHaveBeenCalledWith('/posts/preview', { source });
  expect(
    (screen.getByLabelText('Post audience') as HTMLSelectElement).value,
  ).toBe('public');
  expect(screen.queryByLabelText('What to share')).toBeNull();
  view.unmount();
});
it('publishes long text as caption-only while keeping the specific shared source', async () => {
  const view = render(
    <PostComposer
      initialSource={source}
      defaultAudience="public"
      onClose={jest.fn()}
    />,
  );
  await screen.findByLabelText('Post title');
  const text = 'a'.repeat(71);
  fireEvent.change(screen.getByLabelText('Post title'), {
    target: { value: text },
  });
  expect(screen.queryByLabelText('Post title')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/posts',
      expect.objectContaining({
        title: '',
        caption: text,
        audience: 'public',
        source,
      }),
    ),
  );
  view.unmount();
});

it('publishes a text-only post from an empty composer, with the profile audience', async () => {
  const view = render(<PostComposer onClose={jest.fn()} />);
  const share = screen.getByRole('button', { name: 'Share' });
  expect(share).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('Add from Food')).toBeTruthy();
  expect(screen.getByLabelText('Add photos')).toBeTruthy();
  // The camera starts open under the composer; putting it away offers it back in the toolbar.
  expect(screen.queryByLabelText('Camera')).toBeNull();
  fireEvent.click(screen.getByLabelText('Put the camera away'));
  expect(screen.getByLabelText('Camera')).toBeTruthy();
  expect(
    (screen.getByLabelText('Post audience') as HTMLSelectElement).value,
  ).toBe('public');
  fireEvent.change(screen.getByLabelText('Post title'), {
    target: { value: 'Back from the gym' },
  });
  expect(share).toHaveProperty('disabled', false);
  fireEvent.click(share);
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/posts', {
      title: 'Back from the gym',
      caption: '',
      audience: 'public',
      requestId: expect.any(String),
    }),
  );
  expect(api.post).not.toHaveBeenCalledWith('/posts/preview', expect.anything());
  view.unmount();
});
it('drops the food attachment when removed, leaving a text post', async () => {
  const view = render(
    <PostComposer initialSource={source} defaultAudience="friends" onClose={jest.fn()} />,
  );
  await screen.findByText('Oats', { selector: 'h3' });
  fireEvent.click(screen.getByLabelText('Remove food'));
  expect(screen.queryByText('Oats', { selector: 'h3' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Share' })).toHaveProperty('disabled', true);
  view.unmount();
});

function typeNewFood() {
  fireEvent.click(screen.getByLabelText('New food'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Khachapuri' } });
  fireEvent.change(screen.getByLabelText('Portion'), { target: { value: '250' } });
  fireEvent.change(screen.getByLabelText('Calories (kcal)'), { target: { value: '700' } });
  fireEvent.change(screen.getByLabelText('Protein (g)'), { target: { value: '25,5' } });
}
it('saves a new food and posts it, with labels that say so', async () => {
  const onDone = jest.fn();
  const view = render(<PostComposer onClose={jest.fn()} onDone={onDone} />);
  typeNewFood();
  expect(screen.getByRole('button', { name: 'Save food' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save and Post' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('/posts/created'));
  expect(api.post).toHaveBeenCalledWith(
    '/nutrition/foods',
    expect.objectContaining({
      name: 'Khachapuri',
      entryMode: 'per_serving',
      servingSize: 250,
      energyKcal: 700,
      proteinMg: 25500,
    }),
  );
  expect((api.post as jest.Mock).mock.calls.find(([path]) => path === '/nutrition/foods')[1]).not.toHaveProperty('archived');
  expect(api.post).toHaveBeenCalledWith('/posts/preview', { source: { kind: 'food', foodId: 'new-food' } });
  expect(api.post).not.toHaveBeenCalledWith('/nutrition/entries', expect.anything());
  view.unmount();
});
it('logs the new food as the current meal and posts the entry', async () => {
  const onDone = jest.fn();
  const view = render(<PostComposer onClose={jest.fn()} onDone={onDone} />);
  typeNewFood();
  fireEvent.click(screen.getByLabelText(/^Log as/));
  expect(screen.getByRole('button', { name: 'Save and log food' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save, Log and Post' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('/posts/created'));
  expect(api.post).toHaveBeenCalledWith(
    '/nutrition/entries',
    expect.objectContaining({ foodId: 'new-food', servings: 1 }),
  );
  expect(api.post).toHaveBeenCalledWith('/posts/preview', { source: { kind: 'entry', entryId: 'new-entry' } });
  view.unmount();
});
it('posts an unsaved food without keeping it, and cannot log it', async () => {
  const onDone = jest.fn();
  const view = render(<PostComposer onClose={jest.fn()} onDone={onDone} />);
  typeNewFood();
  fireEvent.click(screen.getByLabelText('Save to my foods'));
  expect(screen.getByLabelText(/^Log as/)).toHaveProperty('disabled', true);
  expect(screen.queryByRole('button', { name: 'Save food' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('/posts/created'));
  expect(api.post).toHaveBeenCalledWith('/nutrition/foods', expect.objectContaining({ archived: true }));
  view.unmount();
});
it('saves a new food without posting and goes to Food', async () => {
  const onDone = jest.fn();
  const view = render(<PostComposer onClose={jest.fn()} onDone={onDone} />);
  typeNewFood();
  fireEvent.click(screen.getByRole('button', { name: 'Save food' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('/nutrition'));
  expect(api.post).not.toHaveBeenCalledWith('/posts', expect.anything());
  view.unmount();
});
