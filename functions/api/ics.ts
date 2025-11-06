// functions/api/ics.ts
export const onRequestGet: PagesFunction = async (context) => {
    const url = new URL(context.request.url);
    const data = url.searchParams.get('d') || '';
    try {
      const raw = atob(data);
      return new Response(raw, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="Piedmont-Wine-Dinner.ics"',
          'Cache-Control': 'no-store'
        }
      });
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
  };