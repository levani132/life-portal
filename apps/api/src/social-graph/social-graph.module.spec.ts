import { SocialGraphService } from './social-graph.module';
describe('graph mutations', () => {
  it('does not create a relationship row for an invalid accept, cancel or unblock', async () => {
    const connections = {
      findOne: jest.fn(() => ({ lean: async () => null })),
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    const graph = new SocialGraphService(connections as never);
    for (const action of [
      'accept',
      'decline',
      'cancel',
      'unblock',
      'unfriend',
      'mute',
    ] as const)
      await expect(graph.act('actor', 'target', action)).rejects.toThrow(
        'connection changed',
      );
    expect(connections.updateOne).not.toHaveBeenCalled();
    expect(connections.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
describe('change reporting for notifications', () => {
  const row = (over: Record<string, unknown>) => ({
    pair: 'actor:target',
    lowId: 'actor',
    highId: 'target',
    state: 'none',
    blockedBy: [],
    mutedBy: [],
    ...over,
  });
  function graphWith(current: Record<string, unknown>) {
    const connections = {
      findOne: jest.fn(() => ({ lean: async () => current })),
      updateOne: jest.fn(),
      findOneAndUpdate: jest.fn(async (..._args: unknown[]) => current),
    };
    return { connections, graph: new SocialGraphService(connections as never) };
  }
  it('reports a repeated outgoing request as unchanged, so it does not notify twice', async () => {
    const { graph, connections } = graphWith(
      row({ state: 'pending', requestedBy: 'actor' }),
    );
    await expect(graph.act('actor', 'target', 'request')).resolves.toBe(false);
    expect(connections.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('stamps acceptedAt on accept and clears it when the pair returns to none', async () => {
    const accept = graphWith(row({ state: 'pending', requestedBy: 'target' }));
    await expect(accept.graph.act('actor', 'target', 'accept')).resolves.toBe(true);
    const [, acceptUpdate] = accept.connections.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $set: { acceptedAt?: Date } },
    ];
    expect(acceptUpdate.$set.acceptedAt).toBeInstanceOf(Date);

    const unfriend = graphWith(row({ state: 'accepted', requestedBy: 'target' }));
    await unfriend.graph.act('actor', 'target', 'unfriend');
    const [, unfriendUpdate] = unfriend.connections.findOneAndUpdate.mock.calls[0] as [
      unknown,
      { $unset: Record<string, string> },
    ];
    expect(unfriendUpdate.$unset).toHaveProperty('acceptedAt');
  });
});
