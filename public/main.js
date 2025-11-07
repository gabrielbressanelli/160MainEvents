// public/main.js
(() => {
  const form = document.getElementById('rsvp-form');
  const submitBtn = document.getElementById('submit');
  const alertBox = document.getElementById('form-alert');
  const successYes = document.getElementById('success-yes');
  const successNo  = document.getElementById('success-no');
  const gcalLink = document.getElementById('gcal');
  const icsLink  = document.getElementById('ics');

  if (!form) return;

  // UTM autofill from query string
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
    const fn = (form.first_name?.value || '').trim();
    const ln = (form.last_name?.value || '').trim();
    const ph = (form.phone?.value || '').trim();
    const em = (form.email?.value || '').trim();
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
    alertBox.hidden = true; alertBox.textContent='';
    if (!validate()) return;

    submitBtn.disabled = true; submitBtn.textContent = 'Submitting…';

    try{
      const data = Object.fromEntries(new FormData(form).entries());

      // Same-origin absolute URL is safest (avoids base tag quirks)
      const url = `${location.origin}/api/rsvp`;

      const res = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(data),
      });

      // If the function returned a non-2xx, surface message from JSON if any
      let json = {};
      try { json = await res.json(); } catch { /* ignore */ }
      if (!res.ok || !json || json.ok === false) {
        const msg = (json && json.error) ? json.error : `Submission failed (${res.status})`;
        throw new Error(msg);
      }

      // Safely attach links (guard for undefined)
      if (json.icsUrl && icsLink) icsLink.href = String(json.icsUrl);
      if (json.gcalUrl && gcalLink) gcalLink.href = String(json.gcalUrl);

      form.hidden = true;
      const attend = String(data.will_attend || '').toLowerCase();
      if (attend === 'yes') {
        successYes.hidden = false;
      } else {
        successNo.hidden = false;
      }
    }catch(err){
      alertBox.hidden = false;
      alertBox.textContent = err?.message || 'Something went wrong. Please try again.';
    }finally{
      submitBtn.disabled = false; submitBtn.textContent = 'Submit RSVP';
    }
  }

  form.addEventListener('submit', onSubmit);
})();
