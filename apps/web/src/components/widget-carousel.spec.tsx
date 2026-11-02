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
const widths = () =>
  screen.getAllByRole('listitem').map((el) => el.style.width);
it('keeps Food expanded and scrolls to the next widget without swapping widths before scrolling', () => {
  mount();
  expect(widths()).toEqual(['128px', '488px', '128px']);
  expect(screen.getByText('Food: expanded')).toBeTruthy();
  // One widget of scroll is the distance the incoming edge travels: 768 - 2 * 128 - 12.
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 500, behavior: 'instant' });
  fireEvent.click(screen.getByRole('button', { name: 'Next widget' }));
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 1000, behavior: 'smooth' });
  expect(widths()).toEqual(['128px', '488px', '128px']);
  // Nothing is expanded while the strip travels to the next widget.
  expect(screen.queryByText(/: expanded/)).toBeNull();
});
it('lays the strip out from the scroll position so the moving edges follow the finger 1:1', () => {
  viewportWidth = 360;
  mount();
  const viewport = screen.getByLabelText(/Food selected/);
  expect(viewport.className).toContain('overflow-x-auto');
  expect(viewport.style.scrollSnapType).toBe('x mandatory');
  expect(widths()).toEqual(['56px', '232px', '56px']);
  scrollTo.mockClear();
  const items = screen.getAllByRole('listitem');
  const grid = items[0].parentElement as HTMLElement;
  // Viewport x of the right edge of Food and of the left edge of projects.
  const edges = () => {
    const shift = Number(
      /translate3d\((-?[\d.]+)px/.exec(grid.style.transform)?.[1] ?? 0,
    );
    const w = items.map((el) => parseFloat(el.style.width));
    const foodRight = shift + w[0] + 8 + w[1];
    return [foodRight, foodRight + 8];
  };
  const [foodRight, nextLeft] = edges();
  fireEvent.scroll(viewport, { target: { scrollLeft: 240 + 100 } });
  const [movedRight, movedLeft] = edges();
  expect(foodRight - movedRight).toBeCloseTo(100);
  expect(nextLeft - movedLeft).toBeCloseTo(100);
  fireEvent.scroll(viewport, { target: { scrollLeft: 480 } });
  expect(widths()).toEqual(['56px', '56px', '296px']);
  expect(grid.style.transform).toBe('translate3d(-64px, 0, 0)');
  expect(screen.getByText('projects · 3 / 3')).toBeTruthy();
  // Observing a native scroll must never jump the viewport back or start another animation.
  expect(scrollTo).not.toHaveBeenCalled();
});
it('collapses the outgoing widget as soon as it moves and expands the incoming one only at rest', () => {
  jest.useFakeTimers();
  viewportWidth = 360;
  mount();
  const viewport = screen.getByLabelText(/Food selected/);
  fireEvent.touchStart(viewport, { touches: [{ clientX: 300, clientY: 100 }] });
  fireEvent.scroll(viewport, { target: { scrollLeft: 250 } });
  expect(screen.getByText('Food: compact')).toBeTruthy();
  fireEvent.scroll(viewport, { target: { scrollLeft: 470 } });
  act(() => {
    jest.advanceTimersByTime(200);
  });
  // The finger is still down: nothing expands yet, even past the midpoint.
  expect(screen.getByText('projects: compact')).toBeTruthy();
  fireEvent.touchEnd(viewport, { touches: [] });
  fireEvent.scroll(viewport, { target: { scrollLeft: 480 } });
  expect(screen.getByText('projects: compact')).toBeTruthy();
  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(screen.getByText('projects: expanded')).toBeTruthy();
  expect(screen.getByText('Food: compact')).toBeTruthy();
  jest.useRealTimers();
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
  viewport.scrollLeft = 500;
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
  expect(viewport.scrollLeft).toBe(600);
  expect(viewport.style.scrollSnapType).toBe('none');
  pointer('pointermove', -100);
  expect(viewport.scrollLeft).toBe(800);
  pointer('pointerup', -100);
  expect(viewport.style.scrollSnapType).toBe('x mandatory');
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 1000, behavior: 'smooth' });
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
    left: 1000,
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
it('expands the landing widget as soon as a released strip is settling onto it', () => {
  jest.useFakeTimers();
  viewportWidth = 360;
  mount();
  const viewport = screen.getByLabelText(/Food selected/);
  fireEvent.touchStart(viewport, { touches: [{ clientX: 300, clientY: 100 }] });
  fireEvent.scroll(viewport, { target: { scrollLeft: 400 } });
  fireEvent.touchEnd(viewport, { touches: [] });
  // Still travelling fast: not landed.
  fireEvent.scroll(viewport, { target: { scrollLeft: 460 } });
  expect(screen.getByText('projects: compact')).toBeTruthy();
  // Slow and within a few pixels of the snap point: landed, with no timer involved.
  fireEvent.scroll(viewport, { target: { scrollLeft: 474 } });
  fireEvent.scroll(viewport, { target: { scrollLeft: 477 } });
  expect(screen.getByText('projects: expanded')).toBeTruthy();
  // The rest of the snap's tail does not collapse it again.
  fireEvent.scroll(viewport, { target: { scrollLeft: 479.5 } });
  expect(screen.getByText('projects: expanded')).toBeTruthy();
  jest.useRealTimers();
});
it('lets a button-driven scroll land only on the widget it is heading for', () => {
  viewportWidth = 360;
  mount();
  const viewport = screen.getByLabelText(/Food selected/);
  fireEvent.click(screen.getByRole('button', { name: 'Next widget' }));
  // A smooth scroll starts slowly, right next to the widget it is leaving.
  fireEvent.scroll(viewport, { target: { scrollLeft: 241 } });
  fireEvent.scroll(viewport, { target: { scrollLeft: 243 } });
  expect(screen.queryByText(/: expanded/)).toBeNull();
  fireEvent.scroll(viewport, { target: { scrollLeft: 476 } });
  fireEvent.scroll(viewport, { target: { scrollLeft: 479 } });
  expect(screen.getByText('projects: expanded')).toBeTruthy();
});
