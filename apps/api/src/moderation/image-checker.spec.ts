import { ImageCheckError, OpenAiImageChecker } from './image-checker';

const answer = (categories: Record<string, boolean>, status = 200) =>
  ({ ok: status < 300, status, json: async () => ({ results: [{ flagged: true, categories, category_scores: Object.fromEntries(Object.entries(categories).map(([name, on], i) => [name, on ? 0.91234 : 0.01 * (i + 1)])) }] }) }) as Response;

describe('OpenAiImageChecker', () => {
  it('sends one image link per request and gathers the flagged categories', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(answer({ sexual: false, violence: true }))
      .mockResolvedValueOnce(answer({ sexual: true, violence: true }));
    const verdict = await new OpenAiImageChecker('sk-key', fetchImpl as unknown as typeof fetch).check(['https://files/a.jpg?sig=1', 'https://files/b.jpg?sig=2']);
    expect(verdict).toEqual({ flagged: ['sexual', 'violence'], scores: { sexual: 0.912, violence: 0.912 } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/moderations');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-key');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'omni-moderation-latest',
      input: [{ type: 'image_url', image_url: { url: 'https://files/a.jpg?sig=1' } }],
    });
  });

  it('fails without naming the link or the key when the service refuses, is down or answers oddly', async () => {
    const down = jest.fn().mockRejectedValue(new Error('socket https://files/a.jpg sk-key'));
    const refused = jest.fn().mockResolvedValue(answer({}, 429));
    const odd = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ nothing: true }) } as Response);
    for (const fetchImpl of [down, refused, odd]) {
      const error = await new OpenAiImageChecker('sk-key', fetchImpl as unknown as typeof fetch).check(['https://files/a.jpg']).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ImageCheckError);
      expect((error as Error).message).not.toMatch(/files|sk-key/);
    }
  });
});
