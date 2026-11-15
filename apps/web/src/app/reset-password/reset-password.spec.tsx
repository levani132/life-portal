import { act, fireEvent, render, screen } from '@testing-library/react';
import ResetPasswordPage from './page';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const request = jest.fn();
jest.mock('../../lib/api', () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly details?: string[],
      readonly code?: string,
    ) {
      super(message);
    }
  }
  return { ApiError, request: (...args: unknown[]) => request(...args) };
});

const { ApiError } = jest.requireMock('../../lib/api') as { ApiError: new (m: string, s: number, d?: string[], c?: string) => Error };

async function open(hash: string) {
  window.history.replaceState(null, '', `/reset-password${hash}`);
  await act(async () => {
    render(<ResetPasswordPage />);
  });
}

async function fill(password: string, confirm = password) {
  const [first, second] = screen.getAllByLabelText(/password|repeat/i, { selector: 'input' });
  fireEvent.change(first as HTMLElement, { target: { value: password } });
  fireEvent.change(second as HTMLElement, { target: { value: confirm } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  });
}

beforeEach(() => {
  request.mockReset();
  replace.mockReset();
});

describe('the reset page (issue #27)', () => {
  it('takes the token out of the address bar and resets with it', async () => {
    request.mockResolvedValueOnce({ valid: true }).mockResolvedValueOnce({ success: true });
    await open('#token=abc_DEF-123');
    expect(window.location.hash).toBe('');
    expect(request).toHaveBeenCalledWith('/auth/reset-password/check', expect.objectContaining({ body: { token: 'abc_DEF-123' } }));

    await fill('a-good-new-password');
    expect(request).toHaveBeenLastCalledWith(
      '/auth/reset-password',
      expect.objectContaining({ body: { token: 'abc_DEF-123', password: 'a-good-new-password' }, anonymous: true }),
    );
    expect(replace).toHaveBeenCalledWith('/login?reset=done');
  });

  it('offers a new link when the link has expired or was used', async () => {
    request.mockResolvedValueOnce({ valid: false });
    await open('#token=old');
    expect(screen.getByRole('alert').textContent).toContain('expired or was already used');
    expect(screen.getByRole('link', { name: 'Request a new link' }).getAttribute('href')).toBe('/forgot-password');
  });

  it('treats a missing token as an invalid link without asking the server', async () => {
    await open('');
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('checks the two passwords match before sending', async () => {
    request.mockResolvedValueOnce({ valid: true });
    await open('#token=abc');
    await fill('a-good-new-password', 'something-else-1');
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText("The two passwords don't match.")).toBeTruthy();
  });

  it('shows the policy message and keeps the form for a weak password', async () => {
    request
      .mockResolvedValueOnce({ valid: true })
      .mockRejectedValueOnce(new ApiError('That password is too common.', 400, undefined, 'WEAK_PASSWORD'));
    await open('#token=abc');
    await fill('password1234');
    expect(screen.getByText('That password is too common.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save new password' })).toBeTruthy();
  });

  it('lets the password be shown and hidden', async () => {
    request.mockResolvedValueOnce({ valid: true });
    await open('#token=abc');
    const toggle = screen.getAllByRole('button', { name: 'Show password' })[0] as HTMLElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getAllByRole('button', { name: 'Hide password' })[0]?.getAttribute('aria-pressed')).toBe('true');
  });
});
