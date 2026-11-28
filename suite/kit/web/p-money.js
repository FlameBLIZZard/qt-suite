/* Toolkit panels: Kharcha on Home, subscriptions, bill splits with UPI links. */
(() => {
  const K = window.qtKit, { api, esc, say, qrSvg, money } = K;

  K.panel("kharcha", async el => {
    const k = await api("/api/kit/kharcha");
    const on = localStorage.getItem("qt-kit-home") !== "off";
    el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Home card</h3>
      <label class="krow"><button class="qt-switch" role="switch" id="kon" aria-checked="${on}"></button> Show the Kharcha card on Home</label>
      <p class="kmini">It reads the copy Kharcha syncs to Beam (Kharcha, Setup, PC sync). Click the card to open the full dashboard.</p></section>
      <section class="kp qt-card"><h3>This month</h3>${k.ok ? `<div class="krow">
        <div class="kstat"><b>${money(k.spent, k.cur)}</b><span>spent</span></div><div class="kstat"><b>${money(k.limit, k.cur)}</b><span>budget</span></div>
        <div class="kstat"><b>${money(k.today, k.cur)}</b><span>today</span></div><div class="kstat"><b>${k.left_per_day != null ? money(k.left_per_day, k.cur) : "-"}</b><span>a day left</span></div></div>
        <div class="klist">${k.recent.map(t => `<div class="kitem"><span>${t.emoji}</span><div class="grow"><b>${esc(t.note || "Spend")}</b><span>${new Date(t.ts).toLocaleString()}</span></div><b>${money(t.amt, k.cur)}</b></div>`).join("")}</div>`
        : `<div class="kempty">${esc(k.msg)}</div>`}</section></div>`;
    el.querySelector("#kon").onclick = e => { const v = e.currentTarget.getAttribute("aria-checked") !== "true"; e.currentTarget.setAttribute("aria-checked", v); localStorage.setItem("qt-kit-home", v ? "on" : "off"); say(v ? "Card is back on Home" : "Card hidden"); };
  });

  K.panel("subs", async el => {
    let s = await api("/api/kit/subs");
    const draw = () => {
      el.innerHTML = `<div class="kcols"><section class="kp qt-card"><h3>Your subscriptions</h3>
        <div class="krow"><div class="kstat"><b>${money(s.per_month, s.cur)}</b><span>a month</span></div><div class="kstat"><b>${money(s.per_year, s.cur)}</b><span>a year</span></div>
        <div class="kstat"><b>${s.subs.length}</b><span>tracked</span></div></div>
        <div class="klist">${s.subs.length ? s.subs.map(x => `<div class="kitem"><div class="grow"><b>${esc(x.name)}</b>
          <span>${x.cycle} · next ${x.next} (${x.in_days === 0 ? "today" : x.in_days === 1 ? "tomorrow" : "in " + x.in_days + " days"}) · ${x.auto ? "found in Kharcha: " + esc(x.why) : "added by you"}</span></div>
          <b>${money(x.amount, s.cur)}</b><button class="qt-btn ghost kbtn-sm" data-del="${esc(x.id)}" title="${x.auto ? "Not a subscription: hide it" : "Delete"}">✕</button></div>`).join("")
          : `<div class="kempty">None found yet. Kharcha spends in the Subscriptions category, or the same note paid monthly, show up here.</div>`}</div>
        ${s.hidden ? `<button class="qt-btn ghost kbtn-sm" data-unhide>Show ${s.hidden} hidden</button>` : ""}</section>
        <section class="kp qt-card"><h3>Add one by hand</h3>
          <label class="kfield">Name<input class="qt-input" id="sn" placeholder="Netflix"></label>
          <div class="krow"><label class="kfield grow">Amount<input type="number" id="sa" min="0" step="1"></label>
          <label class="kfield">Every<select id="sc"><option>monthly</option><option>weekly</option><option>quarterly</option><option>yearly</option></select></label>
          <label class="kfield">Next payment<input type="date" id="sd" value="${new Date().toISOString().slice(0, 10)}"></label></div>
          <button class="qt-btn primary" data-add>Add</button>
          <p class="kmini">Home shows anything due in the next 3 days.</p></section></div>`;
    };
    draw();
    el.addEventListener("click", async e => {
      try {
        if (e.target.closest("[data-add]")) { s = await api("/api/kit/subs", { op: "add", name: el.querySelector("#sn").value, amount: el.querySelector("#sa").value, cycle: el.querySelector("#sc").value, next: el.querySelector("#sd").value }); draw(); say("Added"); }
        const d = e.target.closest("[data-del]"); if (d) { s = await api("/api/kit/subs", { op: "del", id: d.dataset.del }); draw(); }
        if (e.target.closest("[data-unhide]")) { s = await api("/api/kit/subs", { op: "unhide" }); draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });

  K.panel("splits", async el => {
    let s = await api("/api/kit/splits");
    const draw = async () => {
      el.innerHTML = `<div class="kcols">
        <section class="kp qt-card"><h3>Your UPI ID</h3><p class="kmini">Friends pay this ID. It's saved on this PC only.</p>
          <div class="krow"><input class="qt-input grow" id="vpa" placeholder="yourname@okaxis" value="${esc(s.me.vpa)}"><input class="qt-input grow" id="vnm" placeholder="Name shown to them" value="${esc(s.me.name)}"><button class="qt-btn" data-me>Save</button></div>
          <h3>New split</h3>
          <div class="krow"><label class="kfield grow">What for<input class="qt-input" id="st" placeholder="Dinner at KP"></label><label class="kfield">Total<input type="number" id="sa" min="1"></label></div>
          <label class="kfield">Friends (comma separated)<input class="qt-input" id="sp" placeholder="Swan, Rohan, Priya"></label>
          <label class="krow kmini"><input type="checkbox" id="sme" checked> I'm in it too (my share counts)</label>
          ${s.recent.length ? `<div class="kfield">Or pick a recent Kharcha spend<div class="kpill">${s.recent.slice(0, 8).map(t => `<button data-fill="${t.amt}" data-note="${esc(t.note)}">${t.emoji} ${esc(t.note || "spend")} ${money(t.amt)}</button>`).join("")}</div></div>` : ""}
          <button class="qt-btn primary" data-add ${s.me.vpa ? "" : "disabled title='Save your UPI ID first'"}>Split it</button></section>
        <section class="kp qt-card"><h3>Splits <span class="qt-chip">${money(s.owed)} still owed</span></h3><div class="klist" id="sl"></div></section></div>`;
      const list = el.querySelector("#sl");
      if (!s.items.length) { list.innerHTML = `<div class="kempty">No splits yet.</div>`; return; }
      list.innerHTML = s.items.map(it => `<div class="kp" style="padding:12px;border:2px solid var(--qt-ink);border-radius:12px">
        <div class="krow sp"><b>${esc(it.title)} · ${money(it.total)}</b><span class="krow"><span class="kmini">${new Date(it.t * 1000).toLocaleDateString()}</span><button class="qt-btn ghost kbtn-sm" data-del="${it.id}">Delete</button></span></div>
        ${it.people.map(p => `<div class="kitem ${p.paid ? "done" : ""}"><div class="grow"><b>${esc(p.name)}</b><span>${p.me ? "your share" : p.paid ? "paid" : "owes you"}</span></div><b>${money(p.share)}</b>
          ${p.me ? "" : `<button class="qt-btn kbtn-sm" data-qr="${esc(p.link)}" data-who="${esc(p.name)}">QR</button><button class="qt-btn kbtn-sm" data-share="${esc(p.link)}" data-who="${esc(p.name)}" data-amt="${p.share}" data-what="${esc(it.title)}">Copy message</button>
          <button class="qt-btn ghost kbtn-sm" data-paid="${it.id}" data-name="${esc(p.name)}" data-v="${!p.paid}">${p.paid ? "Undo" : "Paid"}</button>`}</div>`).join("")}
        <div class="kqrbox"></div></div>`).join("");
    };
    await draw();
    el.addEventListener("click", async e => {
      const t = e.target;
      try {
        if (t.closest("[data-me]")) { s = await api("/api/kit/splits", { op: "me", vpa: el.querySelector("#vpa").value, name: el.querySelector("#vnm").value }); await draw(); say("Saved"); }
        const f = t.closest("[data-fill]"); if (f) { el.querySelector("#sa").value = f.dataset.fill; el.querySelector("#st").value = f.dataset.note; }
        if (t.closest("[data-add]")) { s = await api("/api/kit/splits", { op: "add", title: el.querySelector("#st").value, total: el.querySelector("#sa").value, people: el.querySelector("#sp").value.split(","), include_me: el.querySelector("#sme").checked }); await draw(); say("Split made. Send each friend their link."); }
        const q = t.closest("[data-qr]");
        if (q) { const box = q.closest(".kp").querySelector(".kqrbox"); box.innerHTML = `<div class="krow"><span class="kqr">${await qrSvg(q.dataset.qr, 4)}</span><span class="kmini">${esc(q.dataset.who)} scans this with any UPI app (GPay, PhonePe, Paytm) and the amount is filled in.</span></div>`; }
        const sh = t.closest("[data-share]");
        if (sh) { const msg = `Hey ${sh.dataset.who}, your share for ${sh.dataset.what} is ₹${(+sh.dataset.amt).toFixed(0)}. Pay here: ${sh.dataset.share}`; await navigator.clipboard.writeText(msg); say("Message copied. Paste it in WhatsApp."); }
        const p = t.closest("[data-paid]"); if (p) { s = await api("/api/kit/splits", { op: "paid", id: p.dataset.paid, name: p.dataset.name, paid: p.dataset.v === "true" }); await draw(); }
        const d = t.closest("[data-del]"); if (d) { s = await api("/api/kit/splits", { op: "del", id: d.dataset.del }); await draw(); }
      } catch (err) { say(err.message, { bad: true }); }
    });
  });
})();
