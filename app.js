/* Minimaler Survey-Renderer für das SurveyJS-JSON (html, checkbox, panel, rating, matrix).
   Antworten werden flach gespeichert:
     Rating:  c01_sem_competent = 5
     Matrix:  c01_trust__confident = 3   (Matrixname "__" Zeilenwert)
     Meta:    pid, submitted_at, duration_s, order_part1..4, survey_version         */
(() => {
  const CFG = window.SURVEY_CONFIG || {};
  const app = document.getElementById("app");
  const answers = {};
  const orders = {};         // pageName -> [Panel-Namen in gezeigter Reihenfolge]
  let survey, pageIdx = 0, startedAt = Date.now();
  const pid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).slice(0, 8);

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v; else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    kids.flat().forEach(c => n.append(c));
    return n;
  };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const safeStore = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  // ---------- Rendering ----------
  function renderElement(e, parent) {
    if (e.type === "html") { parent.append(el("div", { html: e.html })); return; }

    if (e.type === "panel") {
      const p = el("div", { class: "panel" });
      if (e.title) p.append(el("div", { class: "panel-title", html: e.title }));
      (e.elements || []).forEach(c => renderElement(c, p));
      parent.append(p); return;
    }

    if (e.type === "checkbox") {
      const wrap = el("div", { class: "item consent", "data-key": e.name });
      if (e.title) wrap.append(el("h3", {}, e.title));
      e.choices.forEach((c, i) => {
        const id = `${e.name}_${i}`;
        const cb = el("input", { type: "checkbox", id, value: c.value });
        cb.checked = (answers[e.name] || "").split(",").includes(c.value);
        cb.addEventListener("change", () => {
          const cur = new Set((answers[e.name] || "").split(",").filter(Boolean));
          cb.checked ? cur.add(c.value) : cur.delete(c.value);
          answers[e.name] = [...cur].join(",");
          wrap.classList.remove("missing");
        });
        wrap.append(el("label", { for: id }, cb, el("span", {}, c.text)));
      });
      wrap.append(el("div", { class: "err-msg" }, e.requiredErrorText || "Please answer this question."));
      parent.append(wrap); return;
    }

    if (e.type === "rating") {
      const wrap = el("div", { class: "item", "data-key": e.name });
      const row = el("div", { class: "rating", role: "radiogroup", "aria-label": e.title || e.name });
      const n = e.rateCount || 5, min = e.rateMin || 1;
      row.append(el("span", { class: "lbl min" }, e.minRateDescription || ""));
      const btns = el("div", { class: "btns" });
      for (let v = min; v < min + n; v++) {
        const id = `${e.name}_${v}`;
        const inp = el("input", { type: "radio", name: e.name, id, value: v });
        if (answers[e.name] === v) inp.checked = true;
        inp.addEventListener("change", () => { answers[e.name] = v; wrap.classList.remove("missing"); });
        btns.append(inp, el("label", { for: id }, String(v)));
      }
      row.append(btns, el("span", { class: "lbl max" }, e.maxRateDescription || ""));
      wrap.append(row, el("div", { class: "err-msg" }, "Please select a value."));
      parent.append(wrap); return;
    }

    if (e.type === "matrix") {
      const m = el("div", { class: "matrix" });
      const cols = e.columns;
      m.append(el("div", { class: "mx-legend" }, cols.map(c => el("span", {}, el("b", {}, String(c.value)), " = " + c.text))));
      m.append(el("div", { class: "mx-head" }, el("span"), cols.map(c => el("span", {}, c.text))));
      e.rows.forEach(r => {
        const key = `${e.name}__${r.value}`;
        const row = el("div", { class: "mx-row", role: "radiogroup", "data-key": key, "aria-label": r.text }, el("div", { class: "mx-text" }, r.text));
        const sel = el("div", { class: "mx-sel" });
        const labelOf = v => { const c = cols.find(x => x.value === v); return c ? c.value + " = " + c.text : ""; };
        sel.textContent = labelOf(answers[key]);
        cols.forEach(c => {
          const id = `${key}_${c.value}`;
          const inp = el("input", { type: "radio", name: key, id, value: c.value });
          if (answers[key] === c.value) inp.checked = true;
          inp.addEventListener("change", () => { answers[key] = c.value; sel.textContent = labelOf(c.value); row.classList.remove("missing"); });
          row.append(el("div", { class: "mx-cell", title: c.text }, inp, el("label", { for: id }, String(c.value))));
        });
        row.append(sel);
        m.append(row);
      });
      parent.append(m); return;
    }
    console.warn("Unbekannter Elementtyp:", e.type, e.name);
  }

  // Pflichtfelder einer Seite einsammeln
  function requiredKeys(elements, out = []) {
    for (const e of elements) {
      if (e.type === "panel") requiredKeys(e.elements || [], out);
      else if (e.type === "rating" && e.isRequired) out.push(e.name);
      else if (e.type === "checkbox" && e.isRequired) out.push(e.name);
      else if (e.type === "matrix" && e.eachRowRequired) e.rows.forEach(r => out.push(`${e.name}__${r.value}`));
    }
    return out;
  }

  function pageElements(page) {
    // questionOrder:"random" -> Top-Level-Elemente (Konversations-Panels) mischen, einmal pro Seite fixieren
    if (page.questionOrder !== "random") return page.elements;
    if (!orders[page.name]) orders[page.name] = shuffle(page.elements.map(x => x.name));
    return orders[page.name].map(n => page.elements.find(x => x.name === n));
  }

  function renderPage() {
    const page = survey.pages[pageIdx], last = pageIdx === survey.pages.length - 1;
    const pct = Math.round(pageIdx / survey.pages.length * 100);
    const body = el("div");
    pageElements(page).forEach(e => renderElement(e, body));

    const next = el("button", { class: "btn", type: "button" }, last ? (survey.completeText || "Submit") : "Next");
    next.addEventListener("click", () => onNext(page, last, next));
    const nav = el("div", { class: "nav" },
      pageIdx > 0 ? el("button", { class: "btn secondary", type: "button", onclick: () => go(-1) }, "Back") : el("span"), next);

    app.replaceChildren(el("div", { class: "card" },
      !CFG.SHEETDB_URL ? el("div", { class: "banner" }, "Test mode: no SHEETDB_URL configured – answers are NOT sent anywhere.") : "",
      survey.showProgressBar ? el("div", { class: "progress" }, el("div", { style: `width:${pct}%` })) : "",
      el("div", { class: "progress-label" }, `${pageIdx + 1} / ${survey.pages.length}`),
      pageIdx === 0 ? el("h1", { class: "title" }, survey.title) : el("h2", { class: "page-title" }, page.title || ""),
      body, nav, el("div", { class: "fail", id: "fail" })));
    window.scrollTo(0, 0);
  }

  app.addEventListener("change", () => { const f = document.getElementById("fail"); if (f && !document.querySelector(".missing")) f.textContent = ""; });
  function go(d) { pageIdx += d; renderPage(); }

  function onNext(page, last, btn) {
    const missing = requiredKeys(page.elements).filter(k => answers[k] === undefined || answers[k] === "");
    document.querySelectorAll(".missing").forEach(n => n.classList.remove("missing"));
    if (missing.length) {
      missing.forEach(k => document.querySelector(`[data-key="${k}"]`)?.classList.add("missing"));
      document.querySelector(".missing")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("fail").textContent = `Please answer all questions (${missing.length} missing).`;
      return;
    }
    document.getElementById("fail").textContent = "";
    last ? submit(btn) : go(1);
  }

  // ---------- Absenden ----------
  function buildPayload() {
    const row = { pid, survey_version: CFG.SURVEY_VERSION || "", submitted_at: new Date().toISOString(), duration_s: Math.round((Date.now() - startedAt) / 1000) };
    for (const [k, v] of Object.entries(answers)) if (!k.startsWith("ex_")) row[k] = v;   // Übungsseite nicht speichern
    for (const p of survey.pages) if (orders[p.name]) row[`order_${p.name}`] = orders[p.name].map(n => n.replace(/_conversation$/, "")).join(",");
    return row;
  }

  async function submit(btn) {
    const payload = buildPayload();
    safeStore("survey_backup_" + pid, JSON.stringify(payload));
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      if (CFG.SHEETDB_URL) {
        const r = await fetch(CFG.SHEETDB_URL, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ data: [payload] }) });
        if (!r.ok) throw new Error("HTTP " + r.status);
      } else console.log("TEST MODE payload:", payload);
      window.__lastPayload = payload;
      app.replaceChildren(el("div", { class: "card", html: survey.completedHtml || "<h3>Thank you!</h3>" }));
      window.scrollTo(0, 0);
    } catch (err) {
      btn.disabled = false; btn.textContent = survey.completeText || "Submit";
      const f = document.getElementById("fail");
      f.replaceChildren("Your answers could not be sent (" + err.message + "). Please check your connection and try again. ",
        el("a", { href: "#", onclick: ev => { ev.preventDefault(); download(payload); } }, "Download my answers"));
    }
  }
  function download(obj) {
    const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" })), download: `answers_${pid}.json` });
    document.body.append(a); a.click(); a.remove();
  }

  fetch("survey.json").then(r => r.json()).then(s => { survey = s; document.title = s.title; renderPage(); })
    .catch(e => app.textContent = "Could not load survey: " + e.message);
})();
