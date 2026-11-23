import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toDay } from '@life-portal/shared-domain';
import type { NutritionService } from '../nutrition/nutrition.service';
import type { AssistantTool } from './page-assistant';

/** Session tracking for stateful MCP connections. */
interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  userId: string;
  open: number;
  lastActive: number;
}

const IDLE_MS = 30 * 60_000; // 30 minutes
const MAX_SESSIONS = 100;

/** Active sessions by session ID. */
const sessions = new Map<string, McpSession>();

// Cleanup idle sessions periodically
setInterval(() => {
  const cutoff = Date.now() - IDLE_MS;
  for (const [id, session] of sessions) {
    if (session.open === 0 && session.lastActive < cutoff) {
      session.transport.close().catch(console.error);
      sessions.delete(id);
    }
  }
}, 60_000).unref();

/** A refusal as the assistant should read it: the code and the sentence, never a stack. */
function toolError(error: unknown): { error: string; code?: string } {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  if (response && typeof response === 'object') {
    const body = response as { message?: unknown; code?: unknown };
    const message = Array.isArray(body.message) ? body.message.join('; ') : String(body.message ?? 'Refused.');
    return { error: message, ...(typeof body.code === 'string' ? { code: body.code } : {}) };
  }
  if (typeof response === 'string') return { error: response };
  return { error: 'Something went wrong.' };
}

/**
 * Creates an MCP server instance with all nutrition tools registered.
 */
function createMcpServer(userId: string, nutrition: NutritionService, pageTools: AssistantTool[] = []): McpServer {
  const server = new McpServer(
    {
      name: 'life-portal',
      version: '1.0.0',
    },
    { capabilities: { logging: {} } },
  );

  const today = () => toDay(new Date().toISOString());

  // Tool: get_nutrition_day
  server.registerTool(
    'get_nutrition_day',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Get full nutrition data for a specific day including meals, macros, and targets.',
      inputSchema: {
        day: z.string().optional().describe('Date in YYYY-MM-DD format. Defaults to today.'),
      },
    },
    async ({ day }) => {
      const t = today();
      const overview = await nutrition.overview(userId, t, day || t);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              day: overview.day,
              totals: overview.dayTotals.totals,
              slots: overview.dayTotals.slots,
              entryCount: overview.dayTotals.entryCount,
              targets: overview.targets,
              week: overview.week,
            }, null, 2),
          },
        ],
      };
    },
  );

  // Tool: log_meal
  server.registerTool(
    'log_meal',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Log a meal entry. Requires food ID, day, slot, and amount.',
      inputSchema: {
        foodId: z.string().describe('MongoDB ID of the food'),
        day: z.string().describe('Date in YYYY-MM-DD format'),
        slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'uncategorized']).describe('Meal slot'),
        amount: z.number().optional().describe('Amount in grams or ml'),
        servings: z.number().optional().describe('Number of servings (alternative to amount)'),
        note: z.string().optional().describe('Optional note'),
      },
    },
    async (args) => {
      const entry = await nutrition.createEntry(userId, {
        foodId: args.foodId,
        day: args.day,
        slot: args.slot,
        amount: args.amount,
        servings: args.servings,
        note: args.note,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(entry, null, 2) }] };
    },
  );

  // Tool: update_meal
  server.registerTool(
    'update_meal',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Update an existing meal entry.',
      inputSchema: {
        entryId: z.string().describe('MongoDB ID of the meal entry'),
        day: z.string().optional().describe('New date'),
        slot: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'uncategorized']).optional(),
        amount: z.number().optional().describe('New amount'),
        servings: z.number().optional().describe('New servings'),
        note: z.string().optional().describe('New note'),
      },
    },
    async (args) => {
      const entry = await nutrition.updateEntry(userId, args.entryId, {
        day: args.day,
        slot: args.slot,
        amount: args.amount,
        servings: args.servings,
        note: args.note,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(entry, null, 2) }] };
    },
  );

  // Tool: delete_meal
  server.registerTool(
    'delete_meal',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Delete a meal entry.',
      inputSchema: {
        entryId: z.string().describe('MongoDB ID of the meal entry'),
      },
    },
    async ({ entryId }) => {
      const result = await nutrition.removeEntry(userId, entryId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool: list_foods
  server.registerTool(
    'list_foods',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'List foods from the database. Can filter by search query.',
      inputSchema: {
        q: z.string().optional().describe('Search query'),
        favourite: z.boolean().optional().describe('Only favourites'),
        includeArchived: z.boolean().optional().describe('Include archived'),
      },
    },
    async (args) => {
      const foods = await nutrition.listFoods(userId, args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(foods, null, 2) }] };
    },
  );

  // Tool: create_food
  server.registerTool(
    'create_food',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Add a new food to the database.',
      inputSchema: {
        name: z.string().describe('Food name'),
        brand: z.string().optional().describe('Brand name'),
        unit: z.enum(['g', 'ml']).optional().describe('Base unit'),
        servingSize: z.number().describe('Serving size in base units'),
        servingLabel: z.string().optional().describe('e.g. "1 slice"'),
        energyKcal: z.number().describe('Calories per serving'),
        proteinMg: z.number().describe('Protein in mg per serving'),
        fatMg: z.number().describe('Fat in mg per serving'),
        carbMg: z.number().describe('Carbs in mg per serving'),
        fibreMg: z.number().optional().describe('Fibre in mg'),
        favourite: z.boolean().optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      const food = await nutrition.createFood(userId, {
        name: args.name,
        brand: args.brand,
        unit: args.unit || 'g',
        servingSize: args.servingSize,
        servingLabel: args.servingLabel,
        energyKcal: args.energyKcal,
        proteinMg: args.proteinMg,
        fatMg: args.fatMg,
        carbMg: args.carbMg,
        fibreMg: args.fibreMg,
        favourite: args.favourite,
        notes: args.notes,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(food, null, 2) }] };
    },
  );

  // Tool: update_food
  server.registerTool(
    'update_food',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Update an existing food.',
      inputSchema: {
        foodId: z.string().describe('MongoDB ID of the food'),
        name: z.string().optional(),
        brand: z.string().optional(),
        servingSize: z.number().optional(),
        energyKcal: z.number().optional(),
        proteinMg: z.number().optional(),
        fatMg: z.number().optional(),
        carbMg: z.number().optional(),
        favourite: z.boolean().optional(),
        archived: z.boolean().optional(),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      const food = await nutrition.updateFood(userId, args.foodId, {
        name: args.name,
        brand: args.brand,
        servingSize: args.servingSize,
        energyKcal: args.energyKcal,
        proteinMg: args.proteinMg,
        fatMg: args.fatMg,
        carbMg: args.carbMg,
        favourite: args.favourite,
        archived: args.archived,
        notes: args.notes,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(food, null, 2) }] };
    },
  );

  // Tool: delete_food
  server.registerTool(
    'delete_food',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Delete a food. Logged foods are archived instead.',
      inputSchema: {
        foodId: z.string().describe('MongoDB ID of the food'),
      },
    },
    async ({ foodId }) => {
      const result = await nutrition.removeFood(userId, foodId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // Tool: get_profile
  server.registerTool(
    'get_profile',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Get nutrition profile and calculated targets.',
      inputSchema: {},
    },
    async () => {
      const t = today();
      const [profile, targets] = await Promise.all([
        nutrition.profile(userId),
        nutrition.targets(userId, t),
      ]);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ profile, targets }, null, 2) }] };
    },
  );

  // Tool: update_profile
  server.registerTool(
    'update_profile',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Update nutrition profile settings.',
      inputSchema: {
        sex: z.enum(['male', 'female']).optional(),
        heightCm: z.number().optional().describe('Height in cm'),
        birthDate: z.string().optional().describe('YYYY-MM-DD'),
        activityLevel: z.enum(['sedentary', 'light', 'moderate', 'very', 'athlete']).optional(),
        goal: z.enum(['pure_weight_loss', 'fat_loss', 'recomp', 'maintain', 'lean_gain', 'max_gain']).optional(),
        energyOverrideKcal: z.number().optional(),
        proteinOverrideG: z.number().optional(),
        fatOverrideG: z.number().optional(),
        carbOverrideG: z.number().optional(),
      },
    },
    async (args) => {
      const t = today();
      const profile = await nutrition.updateProfile(userId, args);
      const targets = await nutrition.targets(userId, t);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ profile, targets }, null, 2) }] };
    },
  );

  // Tool: log_weight
  server.registerTool(
    'log_weight',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Log a weigh-in.',
      inputSchema: {
        day: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
        weightGrams: z.number().describe('Weight in grams (e.g. 75000 for 75kg)'),
        bodyFatPct: z.number().optional().describe('Body fat as decimal (0.18 = 18%)'),
        note: z.string().optional(),
      },
    },
    async (args) => {
      const t = today();
      const weighIn = await nutrition.upsertWeighIn(userId, t, {
        day: args.day,
        weightGrams: args.weightGrams,
        bodyFatPct: args.bodyFatPct,
        note: args.note,
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(weighIn, null, 2) }] };
    },
  );

  // Tool: get_weigh_ins
  server.registerTool(
    'get_weigh_ins',
    {
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] },
      description: 'Get all weigh-in records.',
      inputSchema: {},
    },
    async () => {
      const weighIns = await nutrition.listWeighIns(userId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(weighIns, null, 2) }] };
    },
  );

  // Spec 041: the tools for pages. Each checks for itself that the person allowed assistants
  // and that the page is marked "run with AI"; a refusal is an answer the assistant can relay.
  for (const tool of pageTools) {
    server.registerTool(
      tool.name,
      { _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['nutrition'] }] }, description: tool.description, inputSchema: tool.shape },
      async (args: Record<string, unknown>) => {
        try {
          return { content: [{ type: 'text' as const, text: JSON.stringify(await tool.run(userId, args ?? {})) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(toolError(error)) }] };
        }
      },
    );
  }

  return server;
}

/**
 * Track open responses to avoid closing sessions with active streams.
 */
function trackResponse(session: McpSession, res: ServerResponse) {
  if (!res.socket || res.destroyed) return;
  session.open++;
  res.on('close', () => {
    session.open--;
    session.lastActive = Date.now();
  });
}

/**
 * One request with no session: a server and transport for it alone, closed when it is answered.
 */
async function handleStateless(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  body: unknown,
  userId: string,
  nutrition: NutritionService,
  pageTools: AssistantTool[],
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(userId, nutrition, pageTools);
  res.on('close', () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });
  await server.connect(transport);
  // The stateless transport answers without a session; the caller's header is not one it knows.
  delete req.headers['mcp-session-id'];
  await transport.handleRequest(req, res, body);
}

/**
 * Handle MCP protocol requests (POST/GET/DELETE on /api/mcp).
 */
export async function handleMcpRequest(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  nutrition: NutritionService,
  verifyToken: (token: string) => Promise<string>,
  metadataUrl?: string,
  pageTools: AssistantTool[] = [],
): Promise<void> {
  const method = req.method?.toUpperCase();
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  // Extract bearer token from Authorization header
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  // A session ID is routing information, never an authentication credential.
  let userId: string;
  try {
    if (!token) throw new Error('Missing credential');
    userId = await verifyToken(token);
  } catch {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      ...(metadataUrl ? { 'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}", scope="nutrition"` } : {}),
    });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Authorization required' }, id: null }));
    return;
  }

  try {
    if (method === 'POST') {
      const body = req.body;

      // Check if this is an initialization request
      if (!sessionId && isInitializeRequest(body)) {
        if (sessions.size >= MAX_SESSIONS) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Too many sessions' }, id: null }));
          return;
        }

        // Create new transport and server
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, server, userId, open: 0, lastActive: Date.now() });
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) sessions.delete(sid);
        };

        const server = createMcpServer(userId, nutrition, pageTools);
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      // Existing session
      if (sessionId) {
        const session = sessions.get(sessionId);
        // Another account's session: never theirs to use.
        if (session && session.userId !== userId) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }));
          return;
        }
        if (!session) {
          // A session this server does not hold: the server restarted (every push to main does)
          // or it expired. Sessions keep no state any tool needs, and the caller was just signed
          // in by its token, so the request is answered on its own rather than failed. Assistants
          // that do not start a new session on a 404 (ChatGPT) otherwise break mid-run.
          await handleStateless(req, res, body, userId, nutrition, pageTools);
          return;
        }
        trackResponse(session, res);
        await session.transport.handleRequest(req, res, body);
        return;
      }

      // No session and not init
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Missing session ID' }, id: null }));
      return;
    }

    if (method === 'GET' || method === 'DELETE') {
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing session ID');
        return;
      }

      const session = sessions.get(sessionId);
      if (!session || session.userId !== userId) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }));
        return;
      }

      trackResponse(session, res);
      await session.transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
    }
  }
}
