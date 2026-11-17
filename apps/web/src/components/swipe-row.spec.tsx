import { act, fireEvent, render, screen } from '@testing-library/react';
import { Pencil, X } from 'lucide-react';
import { SwipeRow, settle, shown } from './swipe-row';

describe('settle', () => {
  it('closes a short swipe, opens past half the actions, and goes all the way past most of the row', () => {
    expect(settle(-20, 112, 320, true)).toBe('closed');
    expect(settle(-60, 112, 320, true)).toBe('open');
    expect(settle(-200, 112, 320, true)).toBe('full');
    // Without a destructive action there is no full swipe.
    expect(settle(-200, 112, 320, false)).toBe('open');
  });
});

describe('shown', () => {
  it('uncovers the buttons one at a time, the rightmost first', () => {
    expect(shown(0, 0)).toBe(0);
    expect(shown(28, 0)).toBe(0.5);
    expect(shown(56, 0)).toBe(1);
    // The next one in starts only once the first is fully out.
    expect(shown(56, 1)).toBe(0);
    expect(shown(112, 1)).toBe(1);
  });
});

describe('SwipeRow', () => {
  const edit = jest.fn();
  const remove = jest.fn();
  const mount = () =>
    render(
      <SwipeRow
        actions={[
          { label: 'Edit oats', short: 'Edit', icon: Pencil, onClick: edit },
          { label: 'Remove oats', short: 'Remove', icon: X, onClick: remove, danger: true },
        ]}
      >
        <p>Oats</p>
      </SwipeRow>,
    );
  const swipe = (from: number, to: number) => {
    const row = screen.getByText('Oats').closest('[data-no-tab-swipe]') as HTMLElement;
    act(() => {
      fireEvent.touchStart(row, { touches: [{ clientX: from, clientY: 10 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: (from + to) / 2, clientY: 10 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: to, clientY: 10 }] });
    });
    act(() => {
      fireEvent.touchEnd(row);
    });
  };
  beforeEach(() => {
    edit.mockReset();
    remove.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 320 });
  });

  it('keeps the actions out of reach until the row is swiped open', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Edit oats' })).toBeNull();
    swipe(300, 220);
    fireEvent.click(screen.getByRole('button', { name: 'Edit oats' }));
    expect(edit).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    // Acting closes the row again.
    expect(screen.queryByRole('button', { name: 'Edit oats' })).toBeNull();
  });

  it('runs the destructive action on a full swipe, and nothing on a short one', () => {
    mount();
    swipe(300, 290);
    expect(remove).not.toHaveBeenCalled();
    swipe(300, 60);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('leaves a vertical move alone', () => {
    mount();
    const row = screen.getByText('Oats').closest('[data-no-tab-swipe]') as HTMLElement;
    act(() => {
      fireEvent.touchStart(row, { touches: [{ clientX: 300, clientY: 10 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 296, clientY: 80 }] });
      fireEvent.touchEnd(row);
    });
    expect(screen.queryByRole('button', { name: 'Edit oats' })).toBeNull();
  });
});
