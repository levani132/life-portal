import { act, fireEvent, render, screen } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { ChangePasswordPanel, DevicesPanel } from './account-security';

const post = jest.fn();
const get = jest.fn();
const del = jest.fn();
jest.mock('../lib/api', () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    api: {
      post: (...a: unknown[]) => post(...a),
      get: (...a: unknown[]) => get(...a),
      delete: (...a: unknown[]) => del(...a),
    },
  };
});
const logout = jest.fn(async () => undefined);
jest.mock('../lib/auth-context', () => ({ useAuth: () => ({ logout }) }));

const { ApiError } = jest.requireMock('../lib/api') as { ApiError: new (m: string, s: number) => Error };
const fresh = ({ children }: { children: ReactNode }) => <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>;

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  del.mockReset();
  logout.mockClear();
});

describe('ChangePasswordPanel (issue #27)', () => {
  async function fill(current: string, next: string, repeat = next) {
    fireEvent.change(screen.getByLabelText('Current password', { selector: 'input' }), { target: { value: current } });
    fireEvent.change(screen.getByLabelText(/^New password/, { selector: 'input' }), { target: { value: next } });
    fireEvent.change(screen.getByLabelText('Repeat the new password', { selector: 'input' }), { target: { value: repeat } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    });
  }

  it('sends the current and new password and says other devices were signed out', async () => {
    post.mockResolvedValue({ success: true });
    const onChanged = jest.fn();
    render(<ChangePasswordPanel onChanged={onChanged} />);
    await fill('old-password-1', 'new-password-22');
    expect(post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old-password-1', newPassword: 'new-password-22' });
    expect(screen.getByRole('status').textContent).toContain('other devices were signed out');
    expect(onChanged).toHaveBeenCalled();
    expect((screen.getByLabelText('Current password', { selector: 'input' }) as HTMLInputElement).value).toBe('');
  });

  it('shows a wrong current password without clearing the form', async () => {
    post.mockRejectedValue(new ApiError('Your current password is incorrect.', 401));
    render(<ChangePasswordPanel />);
    await fill('nope', 'new-password-22');
    expect(screen.getByText('Your current password is incorrect.')).toBeTruthy();
    expect((screen.getByLabelText(/^New password/, { selector: 'input' }) as HTMLInputElement).value).toBe('new-password-22');
  });

  it('checks the two new passwords match before sending', async () => {
    render(<ChangePasswordPanel />);
    await fill('old-password-1', 'new-password-22', 'new-password-23');
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText("The two new passwords don't match.")).toBeTruthy();
  });
});

describe('DevicesPanel (issue #27)', () => {
  const rows = [
    { id: 'here', device: 'Chrome on Mac', createdAt: '2026-11-01T10:00:00Z', lastUsedAt: '2026-11-15T10:00:00Z', current: true },
    { id: 'phone', device: 'Safari on iPhone', createdAt: '2026-11-02T10:00:00Z', lastUsedAt: '2026-11-14T10:00:00Z', current: false },
  ];

  async function show() {
    get.mockResolvedValue(rows);
    await act(async () => {
      render(<DevicesPanel />, { wrapper: fresh });
    });
  }

  it('lists devices, marks this one, and offers sign-out only for the others', async () => {
    await show();
    expect(screen.getByText('This device')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Sign out Safari on iPhone/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Sign out Chrome on Mac/ })).toBeNull();
  });

  it('signs one device out and refreshes the list', async () => {
    await show();
    del.mockResolvedValue({ success: true });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Sign out Safari on iPhone/ }));
    });
    expect(del).toHaveBeenCalledWith('/auth/sessions/phone');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('signs out everywhere by ending the others, then this device the usual way', async () => {
    await show();
    post.mockResolvedValue({ success: true, ended: 1 });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    });
    expect(post).toHaveBeenCalledWith('/auth/sessions/revoke-others');
    expect(logout).toHaveBeenCalled();
  });
});
