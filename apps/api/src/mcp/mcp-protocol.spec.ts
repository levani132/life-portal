import type { Server } from 'node:http';
import express from 'express';
import type { NutritionService } from '../nutrition/nutrition.service';
import { handleMcpRequest } from './mcp-protocol';

// Use the real Streamable HTTP transport to verify session IDs cannot bypass authentication.
describe('MCP transport authentication', () => {
  let server: Server;
  let url: string;
  let expired = false;
  const profile = jest.fn(async () => ({ goal: 'maintain' }));
  const targets = jest.fn(async () => ({ energyKcal: { value: 2000 } }));
  beforeEach(async () => {
    expired = false;
    profile.mockClear();
    const app = express();
    app.use(express.json());
    app.all('/api/mcp', async (req, res) => handleMcpRequest(req, res, {
      profile, targets,
    } as unknown as NutritionService, async (token) => {
      if (expired || !['owner-token', 'other-token'].includes(token)) throw new Error('Invalid token');
      return token === 'owner-token' ? 'owner-1' : 'other-user';
    }, 'https://life-portal.example/.well-known/oauth-protected-resource/api/mcp'));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    url = `http://127.0.0.1:${address.port}/api/mcp`;
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
  function rpc(body: object, token?: string, session?: string, method = 'POST') {
    return fetch(url, { method, headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  }
  async function session() {
    const response = await rpc(init, 'owner-token');
    expect(response.status).toBe(200);
    await response.text();
    return response.headers.get('mcp-session-id')!;
  }

  it('returns an OAuth discovery challenge for missing or invalid credentials', async () => {
    for (const token of [undefined, 'bad-token']) {
      const response = await rpc(init, token);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
    }
  });

  it('checks ownership and credentials on every call and termination request', async () => {
    const sid = await session();
    const list = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
    expect((await rpc(list, undefined, sid)).status).toBe(401);
    expect((await rpc(list, 'other-token', sid)).status).toBe(404);
    expect((await rpc({}, 'other-token', sid, 'DELETE')).status).toBe(404);
    const tools = await rpc(list, 'owner-token', sid);
    expect(tools.status).toBe(200);
    expect(await tools.text()).toContain('securitySchemes');
    const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_profile', arguments: {} } }, 'owner-token', sid);
    expect(call.status).toBe(200);
    expect(await call.text()).toContain('maintain');
    expect(profile).toHaveBeenCalledWith('owner-1');
    expired = true;
    expect((await rpc(list, 'owner-token', sid)).status).toBe(401);
    expect((await rpc({}, 'owner-token', sid, 'DELETE')).status).toBe(401);
    expired = false;
    expect((await rpc({}, 'owner-token', sid, 'DELETE')).status).toBe(200);
  });
});
