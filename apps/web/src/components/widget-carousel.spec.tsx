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
it('initially focuses Food without changing persisted order and expands a tapped neighbor', () => {
  mount(cards.slice(0, 2));
  expect(
    screen
      .getAllByRole('listitem', { hidden: true })
      .map((el) => el.style.width),
  ).toEqual(['128px', '628px']);
  fireEvent.click(screen.getByRole('button', { name: 'Select stocks' }));
  expect(
    screen
      .getAllByRole('listitem', { hidden: true })
      .map((el) => el.style.width),
  ).toEqual(['628px', '128px']);
});
it('shows both compact neighbors for a middle selection and only one at the end', () => {
  mount();
  expect(
    screen
      .getAllByRole('listitem', { hidden: true })
      .map((el) => el.style.width),
  ).toEqual(['128px', '488px', '128px']);
  fireEvent.click(screen.getByRole('button', { name: 'Next widget' }));
  expect(
    screen
      .getAllByRole('listitem', { hidden: true })
      .map((el) => el.style.width),
  ).toEqual(['128px', '128px', '628px']);
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 140, behavior: 'smooth' });
});
it('uses narrow previews on mobile while keeping the strip height independent of selection', () => {
  viewportWidth = 360;
  mount();
  expect(
    screen
      .getAllByRole('listitem', { hidden: true })
      .map((el) => el.style.width),
  ).toEqual(['56px', '232px', '56px']);
  const viewport = screen.getByLabelText(/Food selected/);
  fireEvent.touchStart(viewport, { touches: [{ clientX: 200, clientY: 100 }] });
  fireEvent.touchEnd(viewport, {
    changedTouches: [{ clientX: 80, clientY: 104 }],
  });
  expect(screen.getByText('projects: expanded')).toBeTruthy();
  expect(
    screen
      .getAllByRole('listitem', { hidden: true })
      .map((el) => el.style.width),
  ).toEqual(['56px', '56px', '296px']);
});
it('leaves vertical touch gestures for page scrolling and supports horizontal wheel selection', () => {
  mount();
  const viewport = screen.getByLabelText(/Food selected/);
  fireEvent.touchStart(viewport, { touches: [{ clientX: 200, clientY: 100 }] });
  fireEvent.touchEnd(viewport, {
    changedTouches: [{ clientX: 180, clientY: 250 }],
  });
  expect(screen.getByText('Food: expanded')).toBeTruthy();
  jest.spyOn(performance, 'now').mockReturnValue(500);
  fireEvent.wheel(viewport, { deltaX: 80, deltaY: 0 });
  expect(screen.getByText('projects: expanded')).toBeTruthy();
  jest.restoreAllMocks();
});
it('supports keyboard selection and turns off smooth scrolling for reduced motion', () => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  mount();
  fireEvent.keyDown(screen.getByLabelText(/Food selected/), {
    key: 'ArrowRight',
  });
  expect(screen.getByText('projects: expanded')).toBeTruthy();
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 140, behavior: 'instant' });
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
