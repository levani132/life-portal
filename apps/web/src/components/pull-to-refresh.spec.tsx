import { act, fireEvent, render, screen } from '@testing-library/react';
import { PullToRefresh } from './pull-to-refresh';
import { refreshAll } from '../lib/hooks';
jest.mock('../lib/hooks', () => ({ refreshAll: jest.fn() }));
const refresh = jest.mocked(refreshAll);
const finger = (y: number, x = 100) => ({ clientX: x, clientY: y });
function mount() {
  render(
    <PullToRefresh>
      <div data-testid="content">Page</div>
    </PullToRefresh>,
  );
  return screen.getByTestId('content');
}
beforeEach(() => {
  refresh.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, 'scrollY', {
    value: 0,
    writable: true,
    configurable: true,
  });
});
it('does not refresh when a fast scroll or momentum arrives at the top', () => {
  mount();
  window.scrollY = 600;
  fireEvent.scroll(window);
  window.scrollY = 0;
  fireEvent.scroll(window);
  expect(refresh).not.toHaveBeenCalled();
});
it('does not turn a scroll that started down the page into a refresh', () => {
  const target = mount();
  window.scrollY = 300;
  fireEvent.touchStart(target, { touches: [finger(100)] });
  window.scrollY = 0;
  fireEvent.touchMove(target, { touches: [finger(400)] });
  fireEvent.touchEnd(target, { touches: [] });
  expect(refresh).not.toHaveBeenCalled();
});
it('refreshes once only after a deliberate pull from the top is released', async () => {
  const target = mount();
  fireEvent.touchStart(target, { touches: [finger(100)] });
  fireEvent.touchMove(target, { touches: [finger(300)] });
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.touchEnd(target, { touches: [] });
  });
  fireEvent.touchEnd(target, { touches: [] });
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('does not refresh after a short pull', () => {
  const target = mount();
  fireEvent.touchStart(target, { touches: [finger(100)] });
  fireEvent.touchMove(target, { touches: [finger(130)] });
  fireEvent.touchEnd(target, { touches: [] });
  expect(refresh).not.toHaveBeenCalled();
});
it.each(['touchCancel', 'multiTouch', 'claimed'])(
  'abandons an armed pull on %s',
  (reason) => {
    const target = mount();
    fireEvent.touchStart(target, { touches: [finger(100)] });
    fireEvent.touchMove(target, { touches: [finger(300)] });
    if (reason === 'touchCancel')
      fireEvent.touchCancel(target, { touches: [] });
    else if (reason === 'multiTouch')
      fireEvent.touchMove(target, { touches: [finger(300), finger(350)] });
    else {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [finger(320)] });
      event.preventDefault();
      fireEvent(target, event);
    }
    fireEvent.touchEnd(target, { touches: [] });
    expect(refresh).not.toHaveBeenCalled();
  },
);
it.each(['up', 'sideways'])(
  'keeps an ordinary %s gesture from becoming a refresh',
  (direction) => {
    const target = mount();
    fireEvent.touchStart(target, { touches: [finger(100)] });
    fireEvent.touchMove(target, {
      touches: [direction === 'up' ? finger(60) : finger(110, 180)],
    });
    fireEvent.touchMove(target, { touches: [finger(400)] });
    fireEvent.touchEnd(target, { touches: [] });
    expect(refresh).not.toHaveBeenCalled();
  },
);
