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
