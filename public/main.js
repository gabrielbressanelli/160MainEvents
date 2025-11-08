(() => {
  const form = document.getElementById('rsvp-form');
  if (!form) return; // page safety

  const submitBtn  = document.getElementById('submit');
  const alertBox   = document.getElementById('form-alert');
  const successYes = document.getElementById('success-yes');
  const successNo  = document.getElementById('success-no');
  const gcalLink   = document.getElementById('gcal');
  const icsLink    = document.getElementById('ics');

  // UTM autopopulation
  const params = new URLSearchParams(location.search);
  ['utm_source','utm_medium','utm_campaign'].forEach(k => {
    const el = form.querySelector(`input[name="${k}"]`);
    if (el && params.get(k)) el.value = params.get(k);
  });

  function setError(name, message) {
    const small = form.querySelector(`small[data-for="${name}"]`);
    if (small) small.textContent = message || '';
  }

  function validate() {
    let ok = true;
    setError('first_name',''); setError('last_name',''); setError('phone',''); setError('email',''); setError('will_attend','');
    const fn = form.first_name?.value.trim();
    const ln = form.last_name?.value.trim();
    const ph = form.phone?.value.trim();
    const em = form.email?.value.trim();
    const attend = form.querySelector('input[name="will_attend"]:checked');

    if (!fn){ setError('first_name','Please enter your first name.'); ok=false; }
    if (!ln){ setError('last_name','Please enter your last name.'); ok=false; }
    if (!ph){ setError('phone','Please enter a phone number.'); ok=false; }
    if (!em || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ setError('email','Please provide a valid email.'); ok=false; }
    if (!attend){ setError('will_attend','Select Yes or No.'); ok=false; }
    return ok;
  }

  async function onSubmit(e){
    e.preventDefault();
    alertBox.hidden = true; alertBox.textContent = '';

    if (!validate()) return;

    submitBtn.disabled = true;
    const origLabel = submitBtn.textContent;
    submitBtn.textContent = 'Submitting…';

    try {
      const data = Object.fromEntries(new FormData(form).entries());

      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      let json;
      try { json = await res.json(); } catch { json = {}; }

      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Submission failed (${res.status})`);
      }

      if (json.icsUrl && icsLink)  icsLink.href  = json.icsUrl;
      if (json.gcalUrl && gcalLink) gcalLink.href = json.gcalUrl;

      form.hidden = true;
      const attend = (data.will_attend || '').toLowerCase();
      if (attend === 'yes') successYes.hidden = false;
      else successNo.hidden = false;

    } catch (err) {
      alertBox.hidden = false;
      alertBox.textContent = err && err.message ? err.message : 'Something went wrong. Please try again.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = origLabel || 'Submit RSVP';
    }
  }

  if (icsLink) {
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const ics = `
  BEGIN:VCALENDAR
  VERSION:2.0
  PRODID:-//160 Main//Piedmont Wine Dinner//EN
  BEGIN:VEVENT
  UID:piedmont-wine-dinner@160main.com
  DTSTAMP:${now}
  DTSTART:20251119T190000
  DTEND:20251119T220000
  SUMMARY:Piedmont Wine Dinner
  DESCRIPTION:$250 per person
  LOCATION:160 Main Restaurant
  END:VEVENT
  END:VCALENDAR
  `.trim();
  
    const data = btoa(ics);
    icsLink.href = `/api/ics?d=${encodeURIComponent(data)}`;
  }
  

  form.addEventListener('submit', onSubmit);
})();
 
