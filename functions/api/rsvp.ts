// Cloudflare Pages Functions (no external deps)

export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET?: string;
  SENDGRID_API_KEY?: string;
  FROM_EMAIL?: string;
  INTERNAL_NOTIFY_TO?: string;
  EVENT_SLUG?: string;
  EXPORT_TOKEN?: string;
  SITE_ORIGIN?: string; // e.g. "https://events.160maincarryout.com" (no trailing slash)
}

// CORS / preflight (useful if you ever post from a different origin)
export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  // Same-origin guard (optional but recommended)
  const origin = request.headers.get('origin') || '';
  const site = (env.SITE_ORIGIN || '').replace(/\/+$/, ''); // strip trailing slash
  if (site && origin && origin !== site) {
    return json({ ok: false, error: 'Origin not allowed' }, 403);
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const {
    first_name = '', last_name = '', phone = '', email = '',
    will_attend = '', notes = '',
    utm_source = '', utm_medium = '', utm_campaign = '',
    ['cf-turnstile-response']: turnstileToken,
  } = body;

  if (!first_name || !last_name || !phone || !email || !will_attend) {
    return json({ ok: false, error: 'Missing required fields' }, 400);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: 'Invalid email' }, 400);
  }

  // Turnstile verify if configured
  if (env.TURNSTILE_SECRET) {
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: turnstileToken || '',
        remoteip: request.headers.get('cf-connecting-ip') || '',
      }),
    });
    const verifyJSON = await verifyRes.json().catch(() => ({}));
    if (!verifyJSON?.success) {
      return json({ ok: false, error: 'Captcha failed' }, 400);
    }
  }

  const event_slug = env.EVENT_SLUG || 'piedmont-2025-11-19';
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // D1 insert
  try {
    await env.DB.prepare(
      `INSERT INTO rsvps
       (id, created_at, event_slug, first_name, last_name, phone, email, will_attend, notes, ip, user_agent, utm_source, utm_medium, utm_campaign)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id, now, event_slug,
        first_name, last_name, phone, email,
        will_attend, notes, ip, ua,
        utm_source, utm_medium, utm_campaign
      )
      .run();
  } catch (e: any) {
    return json({ ok: false, error: 'DB insert failed' }, 500);
  }

  // Optional email notifications (SendGrid)
  const from = env.FROM_EMAIL || 'events@example.com';
  const internalTo = env.INTERNAL_NOTIFY_TO || 'events@example.com';

  const subjectGuest =
    `160 Main — ${will_attend.toLowerCase() === 'yes' ? 'RSVP Confirmed' : 'RSVP Received'} — Piedmont Wine Dinner`;

  const textGuest = [
    `Hi ${first_name},`,
    ``,
    `We ${will_attend.toLowerCase() === 'yes' ? 'look forward to seeing you' : 'received your response'} for the Piedmont Wine Dinner.`,
    `Date: Wed Nov 19 at 7:00 PM`,
    `Location: 160 Main, Northville, MI`,
    notes ? `Notes: ${notes}` : '',
    ``,
    `If your plans change, reply to this email.`,
  ].filter(Boolean).join('\n');

  // Simple HTML version with same “feel” (logo, headings, inline styles)
  const htmlGuest = `
<div style="font-family: Arial, sans-serif; color: #333; line-height:1.6;">
  <img src="https://onesixtymain.com/wp-content/uploads/2023/06/160Main-New.png"
       alt="One Sixty Main Logo"
       style="max-width: 200px; margin-bottom: 20px;">
  <h2 style="color:#2c3e50; margin:0 0 8px;">
    ${will_attend.toLowerCase() === 'yes' ? '🍷 RSVP Confirmed' : '🍷 RSVP Received'}
  </h2>
  <p style="margin:0 0 12px;">
    Hi <strong>${escapeHtml(first_name)}</strong>, we
    ${will_attend.toLowerCase() === 'yes' ? 'look forward to seeing you' : 'have recorded your response'}
    for the <strong>Piedmont Wine Dinner</strong>.
  </p>

  <p>
    We will have more information coming out soon, stay tuned to your email!  
  </p>

  <div style="margin:16px 0; padding:12px; background:#f7f9fc; border-radius:10px;">
    <p style="margin:0 0 6px;"><strong>Guest:</strong> ${escapeHtml(first_name)} ${escapeHtml(last_name)}</p>
    <p style="margin:0 0 6px;"><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p style="margin:0 0 6px;"><strong>Phone:</strong> ${escapeHtml(phone)}</p>
    <p style="margin:0 0 6px;"><strong>Attendance:</strong> ${escapeHtml(will_attend)}</p>
    ${notes ? `<p style="margin:0 0 6px;"><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ''}
  </div>

  <h3 style="color:#2c3e50; margin:18px 0 10px;">Event Details</h3>
  <p style="margin:0 0 6px;"><strong>Date:</strong> Wed Nov 19 at 7:00 PM</p>
  <p style="margin:0 0 6px;"><strong>Location:</strong> 160 Main, Northville, MI</p>

  <p style="margin-top: 24px;">– <em>160 Main Events</em></p>
</div>`.trim();

  const jsonMail = (to: string, subject: string, text: string, html?: string) => ({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from, name: '160 Main Events' },
    subject,
    content: [
      { type: 'text/plain', value: text },
      ...(html ? [{ type: 'text/html', value: html }] : []),
    ],
  });

  if (env.SENDGRID_API_KEY) {
    const headers = {
      'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    };

    // Guest (text + html)
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(jsonMail(email, subjectGuest, textGuest, htmlGuest)),
    }).catch(() => {});

    // Internal (text + html)
    const textInternal =
      `New RSVP:\n${first_name} ${last_name}\n${email}\n${phone}\nAttend: ${will_attend}\nNotes: ${notes || '(none)'}\nUTM: ${utm_source}/${utm_medium}/${utm_campaign}\n`;

    const htmlInternal = `
<div style="font-family: Arial, sans-serif; color:#333; line-height:1.6;">
  <h2 style="color:#2c3e50; margin:0 0 8px;">New RSVP — Piedmont Wine Dinner</h2>
  <ul style="margin:0; padding-left:18px;">
    <li><strong>Name:</strong> ${escapeHtml(first_name)} ${escapeHtml(last_name)}</li>
    <li><strong>Email:</strong> ${escapeHtml(email)}</li>
    <li><strong>Phone:</strong> ${escapeHtml(phone)}</li>
    <li><strong>Attend:</strong> ${escapeHtml(will_attend)}</li>
    <li><strong>Notes:</strong> ${notes ? escapeHtml(notes) : '(none)'}</li>
  </ul>
</div>`.trim();

    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(jsonMail(internalTo, 'New RSVP — Piedmont Wine Dinner', textInternal, htmlInternal)),
    }).catch(() => {});
  }

  // Calendar links
  const title = 'Piedmont Wine Dinner — 160 Main';
  const details = 'Multi-course tasting menu paired with Piedmont wines.';
  const location = '160 Main, Northville, MI';
  // NOTE: below are *UTC* Zulu timestamps; adjust if needed
  const start = '20251119T000000Z';
  const end   = '20251119T020000Z';

  const gcalUrl = new URL('https://calendar.google.com/calendar/render');
  gcalUrl.searchParams.set('action', 'TEMPLATE');
  gcalUrl.searchParams.set('text', title);
  gcalUrl.searchParams.set('details', details);
  gcalUrl.searchParams.set('location', location);
  gcalUrl.searchParams.set('dates', `${start}/${end}`);

  // UTF-8 safe base64 for ICS (prevents “string did not match the expected pattern”)
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
    'END:VCALENDAR',
  ].join('\r\n');

  const utf8 = new TextEncoder().encode(ics);
  let bin = '';
  for (let i = 0; i < utf8.length; i++) bin += String.fromCharCode(utf8[i]);
  const icsB64 = btoa(bin);

  // If SITE_ORIGIN is set, use it; else use relative path
  const base = site || '';
  const icsUrl = `${base}/api/ics/${id}.ics?d=${icsB64}`;

  return json({
    ok: true,
    id,
    gcalUrl: gcalUrl.toString(),
    icsUrl,
  });
};

// Fallback for wrong methods (so you don't get a 405 from the platform)
export const onRequest: PagesFunction<Env> = async ({ request }) => {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }
  return json({ ok: false, error: 'Bad request' }, 400);
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Minimal HTML escaping for email fields
function escapeHtml(s: string) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
