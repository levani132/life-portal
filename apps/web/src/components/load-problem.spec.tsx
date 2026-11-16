import { fireEvent, render, screen } from '@testing-library/react';
import { ApiError, NetworkError } from '../lib/api';
import { LoadProblem, LoadProblemBar } from './load-problem';

/** Issue #34: a failed read says what happened and offers a retry, without blanking loaded content. */
describe('LoadProblem', () => {
  it('says offline only when the request never left', () => {
    render(<LoadProblem error={new NetworkError(undefined, true)} onRetry={jest.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/You’re offline/);
  });

  it('calls a server error a server error, and retries on tap', () => {
    const onRetry = jest.fn();
    render(<LoadProblem error={new ApiError('Internal server error', 503)} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toMatch(/having trouble/);
    expect(screen.getByRole('alert').textContent).not.toMatch(/No connection/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('LoadProblemBar', () => {
  it('keeps the page and says it shows what was last loaded', () => {
    render(<LoadProblemBar error={new NetworkError()} onRetry={jest.fn()} />);
    expect(screen.getByRole('status').textContent).toMatch(/Can’t reach Life Portal right now\. Showing what was last loaded\./);
  });
});
