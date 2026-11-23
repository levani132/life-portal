import type { Server } from 'node:http';
import express from 'express';
import type { NutritionService } from '../nutrition/nutrition.service';
import { handleMcpRequest } from './mcp-protocol';
import { PageAssistantService } from './page-assistant';

/**
 * Spec 041: the page tools as an assistant really gets them, over the Streamable HTTP endpoint:
 * every one is listed with its input schema, a call reaches the tool, and a refusal comes back
 * as an answer with its code.
 */
describe('page tools over the MCP endpoint', () => {
  let server: Server;
  let url: string;
  const pages = {
    mine: jest.fn(async () => ({ pages: [], remaining: 3, assistant: false })),
    assistantAllowed: jest.fn(async () => false),
  };
  const assistant = new PageAssistantService(
    {} as never, {} as never, {} as never, pages as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.all('/api/mcp', async (req, res) => handleMcpRequest(req, res, {} as NutritionService, async () => 'person-1', undefined, assistant.tools()));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    url = `http://127.0.0.1:${address.port}/api/mcp`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

  async function rpc(body: object, session?: string) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer token', ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = text.split('\n').find((line) => line.startsWith('data: '));
    return { response, json: JSON.parse(data ? data.slice(6) : text || 'null') as { result?: Record<string, unknown>; error?: unknown } };
  }

  it('lists every page tool beside the nutrition ones, and answers a call', async () => {
    const opened = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    const session = opened.response.headers.get('mcp-session-id') as string;
    expect(session).toBeTruthy();
    await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, session);

    const listed = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, session);
    const tools = listed.json.result?.['tools'] as { name: string; inputSchema: { properties?: Record<string, unknown> } }[];
    const names = tools.map((tool) => tool.name);
    for (const tool of assistant.tools()) expect(names).toContain(tool.name);
    expect(names).toContain('get_nutrition_day');
    expect(new Set(names).size).toBe(names.length);
    expect(tools.find((tool) => tool.name === 'create_page_post')?.inputSchema.properties).toHaveProperty('pageId');

    const called = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_my_pages', arguments: {} } }, session);
    const content = (called.json.result?.['content'] as { text: string }[])[0].text;
    expect(JSON.parse(content)).toMatchObject({ assistantAllowed: false, pages: [] });

    // A refusal is an answer the assistant can read, with its code.
    const refused = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_page', arguments: { name: 'Robot', username: 'robot-page' } } }, session);
    expect(refused.json.result?.['isError']).toBe(true);
    expect(JSON.parse((refused.json.result?.['content'] as { text: string }[])[0].text)).toMatchObject({ code: 'ASSISTANT_OFF' });
  });
});
