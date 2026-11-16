import { act, fireEvent, render, screen } from '@testing-library/react';
import type { WidgetCard } from '@life-portal/shared-types';
import { WidgetCarousel, cutEdges } from './widget-carousel';

const scrollTo = jest.fn();
const VIEW = 360;
const CARD = 316;
const GAP = 8;
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
      {(item) => <span>{item.title}</span>}
    </WidgetCarousel>,
  );
  return { onEditingChange, onOrderChange, onCommit };
}
const viewport = () => screen.getByLabelText(/selected\. Scroll/);
beforeEach(() => {
  scrollTo.mockReset();
  // jsdom lays nothing out: give the strip and its cards the sizes CSS would.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => VIEW,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => CARD,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      const index = Array.from(this.parentElement?.children ?? []).indexOf(this);
      return index * (CARD + GAP);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  });
  window.matchMedia = jest.fn().mockReturnValue({ matches: false });
  jest
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      callback(0);
      return 0;
    });
});
afterEach(() => jest.restoreAllMocks());

it('snaps the first card to the left, the last to the right and the rest to the middle', () => {
  mount();
  expect(
    screen.getAllByRole('listitem').map((el) => el.style.scrollSnapAlign),
  ).toEqual(['start', 'center', 'end']);
  expect(viewport().style.scrollSnapType).toBe('x mandatory');
});

it('shows no dots for a single widget', () => {
  mount([card('nutrition')]);
  expect(screen.getByRole('listitem').style.scrollSnapAlign).toBe('start');
  expect(screen.queryByRole('button', { name: /^Show / })).toBeNull();
});

it('opens on Food, centred, without animating', () => {
  mount();
  // Food is the middle card: its left edge minus half the spare width.
  expect(scrollTo).toHaveBeenCalledWith({
    left: CARD + GAP - (VIEW - CARD) / 2,
    behavior: 'instant',
  });
  expect(
    screen.getByRole('button', { name: 'Show Food' }).getAttribute('aria-current'),
  ).toBe('true');
});

it('does not scroll on open when Food is already first', () => {
  mount(['nutrition', 'stocks'].map(card));
  expect(scrollTo).not.toHaveBeenCalled();
});

it('names the card nearest its resting place as the strip scrolls, without scrolling itself', () => {
  mount();
  scrollTo.mockClear();
  const last = 2 * (CARD + GAP) - (VIEW - CARD);
  act(() => {
    fireEvent.scroll(viewport(), { target: { scrollLeft: last - 20 } });
  });
  expect(
    screen
      .getByRole('button', { name: 'Show projects' })
      .getAttribute('aria-current'),
  ).toBe('true');
  expect(viewport().getAttribute('aria-label')).toMatch(/^projects selected/);
  expect(scrollTo).not.toHaveBeenCalled();
});

it('scrolls to a card from its dot and from the arrow keys', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show stocks' }));
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' });
  fireEvent.keyDown(viewport(), { key: 'ArrowRight' });
  // From Food to the last card, which rests against the right edge.
  expect(scrollTo).toHaveBeenLastCalledWith({
    left: 2 * (CARD + GAP) - (VIEW - CARD),
    behavior: 'smooth',
  });
});

it('honours reduced motion', () => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show stocks' }));
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'instant' });
});

it('turns snapping off while arranging and keeps keyboard arrangement wired to saving', () => {
  const { onOrderChange, onCommit } = mount(cards, true);
  expect(viewport().style.scrollSnapType).toBe('none');
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
  fireEvent(screen.getAllByRole('listitem')[0], event);
  act(() => {
    jest.advanceTimersByTime(425);
  });
  expect(onEditingChange).toHaveBeenCalledWith(true);
  jest.useRealTimers();
});

describe('the strip\'s walls', () => {
  const at = (scroll: number) => cutEdges([0, 1, 2].map((index) => ({ left: index * (CARD + GAP) - scroll, size: CARD })), VIEW);

  it('shows a wall only where a card is cut, never at an end of the strip or over a gap', () => {
    // At rest on the first card: nothing is cut on the left, the next card is cut on the right.
    expect(at(0)).toEqual({ left: false, right: true });
    // Mid-strip: a card on both sides.
    expect(at(CARD / 2)).toEqual({ left: true, right: true });
    // The gap between the first and second card sits on the left edge: no wall there.
    expect(at(CARD + GAP / 2).left).toBe(false);
    // The gap between the second and third card sits on the right edge: no wall there.
    expect(at(CARD + GAP / 2 + CARD + GAP - VIEW).right).toBe(false);
    // Scrolled to the very end: nothing is cut on the right.
    expect(at(3 * CARD + 2 * GAP - VIEW)).toEqual({ left: true, right: false });
  });

  it('marks the walls on the strip as it renders', () => {
    mount();
    const walls = viewport().parentElement as HTMLElement;
    expect(walls.hasAttribute('data-cut-right')).toBe(true);
    expect(walls.hasAttribute('data-cut-left')).toBe(false);
  });
});
