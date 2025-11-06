import { Hono } from 'hono';
export interface Env { DB: D1Database; EXPORT_TOKEN?: string }
const app = new Hono<{ Bindings: Env }>();
app.get('/', async (c) => {
  const token = c.req.query('token') || '';
  if (!c.env.EXPORT_TOKEN || token !== c.env.EXPORT_TOKEN) {
    return c.text('Forbidden', 403);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT created_at, first_name, last_name, email, phone, will_attend, notes
     FROM rsvps ORDER BY created_at DESC`
  ).all();
  const header = 'created_at,first_name,last_name,email,phone,will_attend,notes\n';
  const rows = (results || []).map((r:any) => [
    r.created_at, r.first_name, r.last_name, r.email, r.phone, r.will_attend, (r.notes||'').replace(/\n/g,' ')
  ].map((v)=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  return new Response(header + rows, {
    headers: { 'Content-Type':'text/csv; charset=utf-8', 'Cache-Control':'no-store' }
  });
});
export default app;
