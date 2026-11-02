import { act, fireEvent, render, screen } from '@testing-library/react';
import type { WidgetCard } from '@life-portal/shared-types';
import { WidgetCarousel } from './widget-carousel';

const scrollTo = jest.fn();
let viewportWidth = 768;
const card = (id: string): WidgetCard => ({
  id,
  key: id === 'nutrition' ? 'nutrition' : 'stocks',
  title: id === 'nutrition' ? 'Food' : id,
  href: '/',
  icon: '',
  accent: 'sky',
  tone: 'neutral',
  stats: [],
  order: 1,
});
const cards = ['stocks', 'nutrition', 'projects'].map(card);
function mount(items = cards, editing = false) {
  const onEditingChange = jest.fn();
  const onOrderChange = jest.fn();
  const onCommit = jest.fn();
  render(
    <WidgetCarousel
      cards={items}
      editing={editing}
      onEditingChange={onEditingChange}
      onOrderChange={onOrderChange}
      onCommit={onCommit}
    >
      {(item, _state, expanded, select) => (
        <button onClick={select} aria-label={`Select ${item.title}`}>
          {item.title}: {expanded ? 'expanded' : 'compact'}
        </button>
      )}
    </WidgetCarousel>,
  );
  return { onEditingChange, onOrderChange, onCommit };
}
beforeEach(() => {
  viewportWidth = 768;
  scrollTo.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => viewportWidth,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  });
  window.matchMedia = jest.fn().mockReturnValue({ matches: false });
  global.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
});
it('gives a single widget the full available width', () => {
  mount([card('nutrition')]);
  expect(screen.getByRole('listitem').style.width).toBe('768px');
  expect(screen.queryByRole('button', { name: 'Next widget' })).toBeNull();
});
it('keeps Food expanded and scrolls to the next widget without swapping widths before scrolling', () => {
  mount();
  expect(screen.getAllByRole('listitem').map((el) => el.style.width)).toEqual([
    '128px',
    '488px',
    '128px',
  ]);
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 140, behavior: 'instant' });
  fireEvent.click(screen.getByRole('button', { name: 'Next widget' }));
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 280, behavior: 'smooth' });
  expect(screen.getAllByRole('listitem').map((el) => el.style.width)).toEqual([
    '128px',
    '488px',
    '128px',
  ]);
});
it('uses a native scrolling mobile strip and follows its actual scroll position', () => {
  viewportWidth = 360;
  mount();
  const viewport = screen.getByLabelText(/Food selected/);
  expect(viewport.className).toContain('overflow-x-auto');
  expect(viewport.style.scrollSnapType).toBe('x mandatory');
  expect(screen.getAllByRole('listitem').map((el) => el.style.width)).toEqual([
    '56px',
    '232px',
    '56px',
  ]);
  scrollTo.mockClear();
  fireEvent.scroll(viewport, { target: { scrollLeft: 96 } });
  expect(screen.getAllByRole('listitem').map((el) => el.style.width)).toEqual([
    '56px',
    '160px',
    '160px',
  ]);
  fireEvent.scroll(viewport, { target: { scrollLeft: 128 } });
  expect(screen.getAllByRole('listitem').map((el) => el.style.width)).toEqual([
    '56px',
    '56px',
    '296px',
  ]);
  expect(screen.getByText('projects · 3 / 3')).toBeTruthy();
  // Observing a native scroll must never jump the viewport back or start another animation.
  expect(scrollTo).not.toHaveBeenCalled();
});
it('does not turn touch release or trackpad input into a widget swap', () => {
  mount();
  const viewport = screen.getByLabelText(/Food selected/);
  scrollTo.mockClear();
  fireEvent.touchStart(viewport, { touches: [{ clientX: 200, clientY: 100 }] });
  fireEvent.touchMove(viewport, { touches: [{ clientX: 80, clientY: 104 }] });
  fireEvent.touchEnd(viewport, {
    changedTouches: [{ clientX: 80, clientY: 104 }],
  });
  const wheel = new Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(wheel, { deltaX: 80, deltaY: 0 });
  fireEvent(viewport, wheel);
  expect(wheel.defaultPrevented).toBe(false);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(screen.getByText('Food · 2 / 3')).toBeTruthy();
});
it('drags with a mouse continuously, suppresses the resulting click, then snaps on release', () => {
  mount();
  const viewport = screen.getByLabelText(/Food selected/);
  viewport.scrollLeft = 140;
  viewport.setPointerCapture = jest.fn();
  viewport.hasPointerCapture = jest.fn(() => true);
  viewport.releasePointerCapture = jest.fn();
  const pointer = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
      clientX: x,
      clientY: 100,
    });
    fireEvent(viewport, event);
  };
  pointer('pointerdown', 200);
  pointer('pointermove', 100);
  expect(viewport.scrollLeft).toBe(240);
  expect(viewport.style.scrollSnapType).toBe('none');
  pointer('pointermove', 60);
  expect(viewport.scrollLeft).toBe(280);
  pointer('pointerup', 60);
  expect(viewport.style.scrollSnapType).toBe('x mandatory');
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 280, behavior: 'smooth' });
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  fireEvent(screen.getByRole('button', { name: 'Select stocks' }), click);
  expect(click.defaultPrevented).toBe(true);
  expect(screen.getByText('projects · 3 / 3')).toBeTruthy();
});
it('supports keyboard navigation and reduced-motion preferences', () => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  mount();
  fireEvent.keyDown(screen.getByLabelText(/Food selected/), {
    key: 'ArrowRight',
  });
  expect(scrollTo).toHaveBeenLastCalledWith({
    left: 280,
    behavior: 'instant',
  });
});
it('keeps keyboard arrangement connected to the existing persistence callback', () => {
  const { onOrderChange, onCommit } = mount(cards, true);
  fireEvent.keyDown(
    screen.getByRole('listitem', { name: /Food, arrow keys/ }),
    { key: 'ArrowLeft' },
  );
  expect(onOrderChange).toHaveBeenCalledWith([
    'nutrition',
    'stocks',
    'projects',
  ]);
  expect(onCommit).toHaveBeenCalledWith(['nutrition', 'stocks', 'projects']);
});
it('retains the long-press shortcut to arrangement mode', () => {
  jest.useFakeTimers();
  const { onEditingChange } = mount();
  const event = new Event('pointerdown', { bubbles: true });
  Object.assign(event, {
    button: 0,
    pointerType: 'touch',
    pointerId: 1,
    clientX: 50,
    clientY: 80,
  });
  fireEvent(screen.getAllByRole('listitem', { hidden: true })[0], event);
  act(() => {
    jest.advanceTimersByTime(425);
  });
  expect(onEditingChange).toHaveBeenCalledWith(true);
  jest.useRealTimers();
});
