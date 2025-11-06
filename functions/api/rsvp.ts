import { Hono } from 'hono';

export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET: string;
  SENDGRID_API_KEY?: string;
  FROM_EMAIL?: string;
  INTERNAL_NOTIFY_TO?: string;
  EVENT_SLUG?: string;
  EXPORT_TOKEN?: string;
  SITE_ORIGIN?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  const origin = c.req.header('origin') || '';
  const site = c.env.SITE_ORIGIN || '';
  if (site && origin && origin != site) {
    return c.json({ ok:false, error:'Origin not allowed' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const {
    first_name = '', last_name = '', phone = '', email = '',
    will_attend = '', notes = '',
    utm_source = '', utm_medium = '', utm_campaign = '',
    ['cf-turnstile-response']: turnstileToken
  } = body;

  if (!first_name || !last_name || !phone || !email || !will_attend) {
    return c.json({ ok:false, error:'Missing required fields' }, 400);
  }
  const emailOk = /[^@\s]+@[^@\s]+\.[^@\s]+/.test(email);
  if (!emailOk) return c.json({ ok:false, error:'Invalid email' }, 400);

  if (c.env.TURNSTILE_SECRET) {
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: c.env.TURNSTILE_SECRET,
        response: turnstileToken || '',
        remoteip: c.req.header('cf-connecting-ip') || ''
      })
    });
    const verifyJSON = await verifyRes.json().catch(() => ({}));
    if (!verifyJSON.success) {
      return c.json({ ok:false, error:'Captcha failed' }, 400);
    }
  }

  const event_slug = c.env.EVENT_SLUG || 'piedmont-2025-11-19';
  const ip = c.req.header('cf-connecting-ip') || '';
  const ua = c.req.header('user-agent') || '';

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO rsvps
      (id, created_at, event_slug, first_name, last_name, phone, email, will_attend, notes, ip, user_agent, utm_source, utm_medium, utm_campaign)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, now, event_slug, first_name, last_name, phone, email, will_attend, notes, ip, ua, utm_source, utm_medium, utm_campaign).run();

  const from = c.env.FROM_EMAIL || 'events@example.com';
  const internalTo = c.env.INTERNAL_NOTIFY_TO || 'events@example.com';

  const subjectGuest = `160 Main — ${will_attend.toLowerCase()==='yes' ? 'RSVP Confirmed' : 'RSVP Received'} — Piedmont Wine Dinner`;
  const textGuest = [
    `Hi ${first_name},`,
    ``,
    `We ${will_attend.toLowerCase()==='yes' ? 'look forward to seeing you' : 'received your response'} for the Piedmont Wine Dinner.`,
    `Date: Wed Nov 19 at 7:00 PM`,
    `Location: 160 Main, Northville, MI`,
    notes ? `Notes: ${notes}` : '',
    ``,
    `If your plans change, reply to this email.`
  ].filter(Boolean).join('\n');

  const jsonMail = (to: string, subject: string, text: string) => ({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: '160 Main Events' },
    subject,
    content: [{ type: 'text/plain', value: text }]
  });

  if (c.env.SENDGRID_API_KEY) {
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${c.env.SENDGRID_API_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify(jsonMail(email, subjectGuest, textGuest))
    });
    const textInternal = `New RSVP:\n${first_name} ${last_name}\n${email}\n${phone}\nAttend: ${will_attend}\nNotes: ${notes || '(none)'}\nUTM: ${utm_source}/${utm_medium}/${utm_campaign}\n`;
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${c.env.SENDGRID_API_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify(jsonMail(internalTo, 'New RSVP — Piedmont Wine Dinner', textInternal))
    });
  }

  const title = 'Piedmont Wine Dinner — 160 Main';
  const details = 'Multi-course tasting menu paired with Piedmont wines.';
  const location = '160 Main, Northville, MI';
  const start = '20251119T000000Z';
  const end   = '20251119T020000Z';

  const gcalUrl = new URL('https://calendar.google.com/calendar/render');
  gcalUrl.searchParams.set('action','TEMPLATE');
  gcalUrl.searchParams.set('text', title);
  gcalUrl.searchParams.set('details', details);
  gcalUrl.searchParams.set('location', location);
  gcalUrl.searchParams.set('dates', `${start}/${end}`);

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//160 Main//Events//EN',
    'BEGIN:VEVENT',
    `UID:${id}@160main.events`,
    `DTSTAMP:${start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${details}`,
    `LOCATION:${location}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const icsB64 = btoa(ics);
  const icsUrl = `${site}/api/ics/${id}.ics?d=${icsB64}`;

  return c.json({ ok:true, id, gcalUrl: gcalUrl.toString(), icsUrl });
});

export default app;
