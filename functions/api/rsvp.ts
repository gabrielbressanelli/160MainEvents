import { Hono } from 'hono';

export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET: string;
  SENDGRID_API_KEY?: string;
  FROM_EMAIL?: string;
  INTERNAL_NOTIFY_TO?: string;
  EVENT_SLUG?: string;
  EXPORT_TOKEN?: string;
  SITE_ORIGIN?: string; // comma-separated allow-list, e.g. "https://events.160maincarryout.com,https://160maincarryout.com"
}

const app = new Hono<{ Bindings: Env }>();

/**
 * Basic preflight support (useful if you ever switch to cross-origin POSTs)
 */
app.options('/', (c) => {
  const origin = c.req.header('origin') || '';
  const allow = allowedOrigin(origin, c.env.SITE_ORIGIN);
  if (allow) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
  }
  c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  return c.body(null, 204);
});

app.post('/', async (c) => {
  // Origin enforcement: only block when we *know* it’s a foreign origin
  const origin = c.req.header('origin') || '';
  const siteList = c.env.SITE_ORIGIN || '';
  if (origin && !allowedOrigin(origin, siteList)) {
    return c.json({ ok: false, error: 'Origin not allowed' }, 403);
  }
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
  }

  // Parse/validate body
  const body = await c.req.json().catch(() => ({} as Record<string, string>));
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

  // Verify Turnstile when configured
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

  try {
    await c.env.DB.prepare(
      `INSERT INTO rsvps
        (id, created_at, event_slug, first_name, last_name, phone, email, will_attend, notes, ip, user_agent, utm_source, utm_medium, utm_campaign)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, now, event_slug, first_name, last_name, phone, email, will_attend, notes, ip, ua, utm_source, utm_medium, utm_campaign
    ).run();
  } catch (e) {
    return c.json({ ok:false, error:'Database error' }, 500);
  }

  // Email notifications (optional)
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

  const textInternal = [
    `New RSVP:`,
    `${first_name} ${last_name}`,
    `${email}`,
    `${phone}`,
    `Attend: ${will_attend}`,
    `Notes: ${notes || '(none)'}`,
    `UTM: ${utm_source}/${utm_medium}/${utm_campaign}`,
  ].join('\n');

  const jsonMail = (to: string, subject: string, text: string) => ({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: '160 Main Events' },
    subject,
    content: [{ type: 'text/plain', value: text }]
  });

  if (c.env.SENDGRID_API_KEY) {
    const hdrs = {
      'Authorization': `Bearer ${c.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    };
    // fire-and-forget; don't fail request if email API hiccups
    await Promise.allSettled([
      fetch('https://api.sendgrid.com/v3/mail/send', {
        method:'POST', headers: hdrs,
        body: JSON.stringify(jsonMail(email, subjectGuest, textGuest))
      }),
      fetch('https://api.sendgrid.com/v3/mail/send', {
        method:'POST', headers: hdrs,
        body: JSON.stringify(jsonMail(internalTo, 'New RSVP — Piedmont Wine Dinner', textInternal))
      })
    ]);
  }

  /**
   * Calendar links
   * Wed Nov 19, 2025 7:00–9:00 PM America/Detroit (EST) => 2025-11-20 00:00–02:00Z
   */
  const title = 'Piedmont Wine Dinner — 160 Main';
  const details = 'Multi-course tasting menu paired with Piedmont wines.';
  const location = '160 Main, Northville, MI';
  const startZ = '20251120T000000Z';
  const endZ   = '20251120T020000Z';

  const gcalUrl = new URL('https://calendar.google.com/calendar/render');
  gcalUrl.searchParams.set('action','TEMPLATE');
  gcalUrl.searchParams.set('text', title);
  gcalUrl.searchParams.set('details', details);
  gcalUrl.searchParams.set('location', location);
  gcalUrl.searchParams.set('dates', `${startZ}/${endZ}`);

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//160 Main//Events//EN',
    'BEGIN:VEVENT',
    `UID:${id}@160main.events`,
    `DTSTAMP:${startZ}`,
    `DTSTART:${startZ}`,
    `DTEND:${endZ}`,
    `SUMMARY:${escapeICS(title)}`,
    `DESCRIPTION:${escapeICS(details)}`,
    `LOCATION:${escapeICS(location)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const icsB64 = btoa(ics);
  const icsUrl = `data:text/calendar;base64,${icsB64}`;

  return c.json({ ok:true, id, gcalUrl: gcalUrl.toString(), icsUrl });
});

/** Helpers */
function allowedOrigin(origin: string, list: string | undefined) {
  if (!list) return false;
  const allowed = list.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}

function escapeICS(value: string) {
  return value.replace(/\\|,|;|\n/g, (m) => {
    if (m === '\n') return '\\n';
    return '\\' + m;
  });
}

export default app;
