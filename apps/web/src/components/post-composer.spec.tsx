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
      path === '/posts/media/config'
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
    path === '/posts/preview' ? preview : { id: 'created' },
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
