import type { FastifyInstance } from 'fastify';
import { gotrue } from '../supabase.js';
import { env } from '../env.js';

/**
 * Auth proxy: the extension talks only to this backend, one origin for
 * everything. GoTrue error messages pass through so failures stay specific.
 */
export function authRoutes(app: FastifyInstance): void {
  app.post('/api/auth/signup', async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return reply.code(400).send({ error: 'Email and password required', code: 'bad_request' });
    const res = await gotrue('/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, options: { email_redirect_to: `http://localhost:${env.port}/confirmed` } }),
    });
    const body = await res.json();
    return reply.code(res.status).send(body);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return reply.code(400).send({ error: 'Email and password required', code: 'bad_request' });
    const res = await gotrue('/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    return reply.code(res.status).send(body);
  });

  app.post('/api/auth/refresh', async (req, reply) => {
    const { refresh_token } = req.body as { refresh_token?: string };
    if (!refresh_token) return reply.code(400).send({ error: 'refresh_token required', code: 'bad_request' });
    const res = await gotrue('/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token }),
    });
    const body = await res.json();
    return reply.code(res.status).send(body);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.headers.authorization?.slice(7);
    if (token) await gotrue('/logout', { method: 'POST' }, token).catch(() => {});
    return reply.send({ ok: true });
  });

  app.post('/api/auth/reset', async (req, reply) => {
    const { email } = req.body as { email?: string };
    if (!email) return reply.code(400).send({ error: 'Email required', code: 'bad_request' });
    const res = await gotrue('/recover', {
      method: 'POST',
      body: JSON.stringify({ email, options: { redirect_to: `http://localhost:${env.port}/reset` } }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return reply.code(res.status).send(body);
    }
    return reply.send({ ok: true, message: 'Reset email sent — check your inbox.' });
  });

  // The extension's Google sign-in uses chrome.identity.launchWebAuthFlow and
  // needs the GoTrue authorize URL without knowing the Supabase project.
  app.get('/api/auth/google-url', async (req, reply) => {
    const { redirect } = req.query as { redirect?: string };
    if (!redirect) return reply.code(400).send({ error: 'redirect required', code: 'bad_request' });
    return {
      url: `${env.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}`,
    };
  });

  // Landing page for the confirmation link in signup emails.
  app.get('/confirmed', async (_req, reply) => {
    reply.type('text/html').send(page('Email confirmed', 'Your email is confirmed. Return to the extension and sign in.'));
  });

  // Landing page for password-recovery links. The recovery token arrives in
  // the URL hash, so this must be handled in page JS against GoTrue directly
  // (the anon key is public by design).
  app.get('/reset', async (_req, reply) => {
    reply.type('text/html').send(`<!doctype html><meta charset="utf-8">
<title>Set a new password</title>
<style>body{font-family:system-ui;max-width:26rem;margin:4rem auto;padding:0 1rem}input,button{font-size:1rem;padding:.6rem;width:100%;box-sizing:border-box;margin-top:.5rem}button{cursor:pointer}p.err{color:#b00}p.ok{color:#070}</style>
<h2>Set a new password</h2>
<input id="pw" type="password" placeholder="New password (min 6 characters)">
<button id="go">Save new password</button>
<p id="msg"></p>
<script>
const msg = document.getElementById('msg');
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('access_token');
if (!token) { msg.textContent = 'This link is invalid or expired. Request a new reset email from the extension.'; msg.className='err'; }
document.getElementById('go').onclick = async () => {
  const pw = document.getElementById('pw').value;
  if (pw.length < 6) { msg.textContent = 'Password must be at least 6 characters.'; msg.className='err'; return; }
  const res = await fetch(${JSON.stringify(env.supabaseUrl)} + '/auth/v1/user', {
    method: 'PUT',
    headers: { apikey: ${JSON.stringify(env.supabaseAnonKey)}, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) { msg.textContent = 'Password updated. Return to the extension and sign in.'; msg.className='ok'; }
  else { const b = await res.json().catch(()=>({})); msg.textContent = 'Failed: ' + (b.msg || b.error_description || res.status); msg.className='err'; }
};
</script>`);
  });
}

function page(title: string, text: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;max-width:26rem;margin:4rem auto;padding:0 1rem;text-align:center}</style>
<h2>${title}</h2><p>${text}</p>`;
}
