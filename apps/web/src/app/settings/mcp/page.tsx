'use client';

import { useState } from 'react';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { ErrorNote, Panel, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useAction } from '../../../lib/hooks';

export default function McpPage() {
  return (
    <AppShell>
      <McpSetup />
    </AppShell>
  );
}

function McpSetup() {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { run, pending, error } = useAction();

  const generateToken = () =>
    run(async () => {
      const res = await api.post<{ token: string; expiresAt: string }>('/mcp/token', {});
      setToken(res.token);
      setExpiresAt(res.expiresAt);
    });

  const copyToken = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const apiUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/mcp`
    : 'http://localhost:3333/api/mcp';

  return (
    <>
      <PageHeader
        title="AI Assistant Setup"
        subtitle="Connect ChatGPT, Claude, or other AI assistants to your Life Portal nutrition data."
      />

      {error && <ErrorNote message={error} />}

      <div className="grid gap-6">
        <Panel title="1. Generate an MCP Token" description="This token lets AI assistants access your nutrition data.">
          {token ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-surface-sunken p-3">
                <code className="block break-all text-xs text-ink-muted">{token}</code>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" className="btn-primary" onClick={copyToken} disabled={pending}>
                  {copied ? 'Copied!' : 'Copy Token'}
                </button>
                <span className="text-xs text-ink-faint">
                  Expires: {new Date(expiresAt!).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs text-amber-400">
                ⚠️ Keep this token secret. Anyone with it can read and modify your nutrition data.
              </p>
            </div>
          ) : (
            <button type="button" className="btn-primary" onClick={generateToken} disabled={pending}>
              {pending ? <Spinner label="" /> : 'Generate Token'}
            </button>
          )}
        </Panel>

        <Panel title="2. Configure Your AI Assistant" description="Add this MCP server to your AI app.">
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-sm font-medium text-ink">For Claude Desktop</h4>
              <p className="mb-2 text-xs text-ink-muted">
                Add this to your <code className="rounded bg-surface-sunken px-1">claude_desktop_config.json</code>:
              </p>
              <pre className="overflow-x-auto rounded-lg border border-line bg-surface-sunken p-3 text-xs">
{`{
  "mcpServers": {
    "life-portal": {
      "command": "curl",
      "args": ["-X", "POST", "${apiUrl}/call",
        "-H", "Content-Type: application/json",
        "-d", "{\\"token\\": \\"YOUR_TOKEN\\", \\"tool\\": \\"$TOOL\\", \\"arguments\\": $ARGS}"]
    }
  }
}`}
              </pre>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-medium text-ink">For ChatGPT / Custom GPTs</h4>
              <p className="mb-2 text-xs text-ink-muted">
                Use these endpoints in your GPT&apos;s Actions:
              </p>
              <pre className="overflow-x-auto rounded-lg border border-line bg-surface-sunken p-3 text-xs">
{`Base URL: ${apiUrl}

POST /call
Body: {
  "token": "YOUR_TOKEN",
  "tool": "tool_name",
  "arguments": { ... }
}`}
              </pre>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-medium text-ink">For Amazon Q / Other MCP Clients</h4>
              <p className="mb-2 text-xs text-ink-muted">
                Discover available tools at:
              </p>
              <pre className="overflow-x-auto rounded-lg border border-line bg-surface-sunken p-3 text-xs">
{`GET ${apiUrl}/tools`}
              </pre>
            </div>
          </div>
        </Panel>

        <Panel title="3. Available Tools" description="What your AI assistant can do with your nutrition data.">
          <div className="grid gap-3 sm:grid-cols-2">
            <ToolCard
              name="get_nutrition_day"
              description="Get full nutrition data for any day — meals, macros, and targets."
            />
            <ToolCard
              name="log_meal"
              description="Log a meal entry with food, amount, and meal slot."
            />
            <ToolCard
              name="update_meal / delete_meal"
              description="Edit or remove existing meal entries."
            />
            <ToolCard
              name="list_foods"
              description="Search your food database by name or brand."
            />
            <ToolCard
              name="create_food / update_food"
              description="Add or edit foods in your database."
            />
            <ToolCard
              name="get_profile / update_profile"
              description="View or update your nutrition goals and settings."
            />
            <ToolCard
              name="log_weight"
              description="Record a weigh-in with optional body fat percentage."
            />
            <ToolCard
              name="get_weigh_ins"
              description="Get your weight history."
            />
          </div>
        </Panel>

        <Panel title="Example Prompts" description="Try these with your AI assistant.">
          <ul className="space-y-2 text-sm text-ink-muted">
            <li>• &quot;What did I eat today and how does it compare to my targets?&quot;</li>
            <li>• &quot;Log 200g of chicken breast for lunch&quot;</li>
            <li>• &quot;Add a new food: Greek yogurt, 170g serving, 100 calories, 17g protein, 0g fat, 6g carbs&quot;</li>
            <li>• &quot;Show me my food database&quot;</li>
            <li>• &quot;Update my goal to fat loss&quot;</li>
            <li>• &quot;Log my weight: 75.5 kg&quot;</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function ToolCard({ name, description }: { name: string; description: string }) {
  return (
    <div className="rounded-lg border border-line/60 bg-surface-sunken/40 p-3">
      <code className="text-xs font-medium text-sky-400">{name}</code>
      <p className="mt-1 text-xs text-ink-muted">{description}</p>
    </div>
  );
}
