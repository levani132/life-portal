import { act, render, screen } from '@testing-library/react';
import { COLLAPSE_MS, Collapsible } from './collapsible';

function motion(reduce: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
}

describe('Collapsible (#24)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays mounted while it animates closed, then unmounts', () => {
    motion(false);
    const { rerender } = render(<Collapsible open>body</Collapsible>);
    expect(screen.getByTestId('collapsible').dataset.state).toBe('open');

    rerender(<Collapsible open={false}>body</Collapsible>);
    expect(screen.getByText('body')).toBeTruthy();
    expect(screen.getByTestId('collapsible').dataset.state).toBe('closed');

    act(() => jest.advanceTimersByTime(COLLAPSE_MS + 60));
    expect(screen.queryByText('body')).toBeNull();
  });

  it('opens from closed on the next frame so the height can animate', () => {
    motion(false);
    const { rerender } = render(<Collapsible open={false}>body</Collapsible>);
    expect(screen.queryByText('body')).toBeNull();
    rerender(<Collapsible open>body</Collapsible>);
    expect(screen.getByTestId('collapsible').dataset.state).toBe('closed');
    act(() => jest.advanceTimersByTime(20));
    expect(screen.getByTestId('collapsible').dataset.state).toBe('open');
  });

  it('reverses mid-close instead of blocking: reopening keeps it', () => {
    motion(false);
    const { rerender } = render(<Collapsible open>body</Collapsible>);
    rerender(<Collapsible open={false}>body</Collapsible>);
    act(() => jest.advanceTimersByTime(COLLAPSE_MS / 2));
    rerender(<Collapsible open>body</Collapsible>);
    act(() => jest.advanceTimersByTime(COLLAPSE_MS * 2));
    expect(screen.getByTestId('collapsible').dataset.state).toBe('open');
  });

  it('closes at once with reduced motion', () => {
    motion(true);
    const { rerender } = render(<Collapsible open>body</Collapsible>);
    rerender(<Collapsible open={false}>body</Collapsible>);
    expect(screen.queryByText('body')).toBeNull();
  });
});
