/** All dynamic content is escaped; credentials are submitted only to the API origin. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function consentPage(ticket: string, clientOrigin: string, error = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Life Portal</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b1220;color:#e5e7eb;font:16px system-ui;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:100%;max-width:420px}form{background:#162033;border:1px solid #334155;border-radius:16px;padding:24px}h1{font-size:24px}p{line-height:1.6;overflow-wrap:anywhere}label{display:block;margin:16px 0}input,button{font:inherit;width:100%;padding:12px;border-radius:8px}input{margin-top:8px;border:1px solid #64748b}button{cursor:pointer;border:0;margin-top:12px;background:#38bdf8;color:#071323;font-weight:600}button[name=cancel]{background:#334155;color:#e5e7eb}.error{color:#fca5a5}
</style></head><body><main><h1>Connect Life Portal</h1>
<p>Sign in to let the assistant at <strong>${escapeHtml(clientOrigin)}</strong> read and update your meals, foods, nutrition goals and weight. It will have no access to your finances.</p>
<form method="post" action="/oauth/consent"><input type="hidden" name="ticket" value="${escapeHtml(ticket)}">
<label>Email<input name="email" type="email" autocomplete="username" required maxlength="254"></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<button type="submit">Sign in and allow nutrition access</button>
<button type="submit" name="cancel" value="yes" formnovalidate>Cancel</button>
</form></main></body></html>`;
}
