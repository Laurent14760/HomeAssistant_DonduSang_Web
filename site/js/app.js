/* Interface : formulaire, appels API, rendu des trois visuels. Aucune dépendance. */
(function () {
  "use strict";

  const C = window.EfsCore;
  const $ = (id) => document.getElementById(id);
  const SVG = "http://www.w3.org/2000/svg";
  const REFRESH_MS = 60 * 60 * 1000;
  const AGENDA_LIMIT = 12;

  // Proxy local (Docker/nginx) d'abord, appel direct ensuite.
  const ENDPOINTS = {
    geo: ["api/geo/communes", "https://geo.api.gouv.fr/communes"],
    efs: ["api/efs/samplingcollection/searchnearpoint",
      "https://oudonner.api.efs.sante.fr/carto-api/v3/samplingcollection/searchnearpoint"],
  };
  const preferred = { geo: 0, efs: 0 };

  const state = {
    cp: "", insee: null, communes: [], cpLoaded: null,
    center: null, radius: 10, don: "sang", horizon: 30, pro: false,
    demo: false, raw: null, result: null, fetchedAt: null, error: null,
    showAll: false, busy: false, timer: null,
    rdvOnly: false, communeVue: "auto", base: null,
    mode: "normal", tabLieu: "auto", tabLieuNom: "", tabCfg: null, tabTimer: null, tabPremier: false,
  };

  // Bornes communes avec l'intégration Home Assistant (1.4.1) et la carte Lovelace (1.3.1).
  const BORNES = { rayon: [0, 50], jours: [1, 180] };
  const JOURS_DEFAUT = 30;
  /** Entier dans les bornes, sinon null (valeur vide, décimale ou hors bornes). */
  function entierBorne(v, [min, max]) {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  }

  // ------------------------------------------------------------ rayon 0 = commune seule
  const communeSeule = () => state.radius === 0;
  /** Rayon réellement interrogé : rayon 0 → recherche autour de la commune, puis filtre sur son nom. */
  const rayonRecherche = () => (communeSeule() ? C.COMMUNE_SEARCH_RADIUS : state.radius);
  /** Libellé du périmètre : « rayon 10 km » ou « Bretteville-sur-Odon seulement ». */
  function perimetre() {
    return communeSeule() ? `${state.center ? state.center.label : "commune"} seulement` : `rayon ${state.radius} km`;
  }
  /** Rayon du plan : celui de la recherche, ou cadré sur le lieu le plus éloigné en mode commune. */
  function rayonCarte(collectes) {
    if (!communeSeule()) return state.radius;
    return Math.max(2, Math.ceil(Math.max(0, ...collectes.map((c) => c.distance || 0))));
  }

  // ---------------------------------------------------------- lieu de base (cookie)
  // Cookie fonctionnel déposé uniquement à la demande de l'utilisateur ; lu par ce seul navigateur.
  const COOKIE = "efs_lieu_base";
  const COOKIE_MAX_AGE = 365 * 24 * 3600;
  const Base = {
    read() {
      try {
        const m = document.cookie.split("; ").find((c) => c.startsWith(COOKIE + "="));
        if (!m) return null;
        const b = JSON.parse(decodeURIComponent(m.slice(COOKIE.length + 1)));
        const ok = Number.isFinite(b?.lat) && Number.isFinite(b?.lon) && typeof b?.nom === "string"
          && (b.t === "geo" || (b.t === "cp" && /^\d{5}$/.test(b.cp || "")));
        return ok ? b : null;
      } catch {
        return null;
      }
    },
    write(b, persistent) {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      const age = persistent ? `; Max-Age=${COOKIE_MAX_AGE}` : ""; // sans Max-Age : effacé à la fermeture du navigateur
      document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(b))}; Path=/; SameSite=Lax${age}${secure}`;
      return Base.read() !== null; // faux si le navigateur refuse les cookies (fichier local, blocage)
    },
    clear() {
      document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    },
  };

  function currentAsBase() {
    const c = state.center;
    if (!c) return null;
    if (c.cp) return { t: "cp", cp: c.cp, insee: state.insee, nom: c.label, lat: +c.lat.toFixed(5), lon: +c.lon.toFixed(5), p: !!state.base?.p };
    return { t: "geo", nom: "Ma position", lat: +c.lat.toFixed(4), lon: +c.lon.toFixed(4), p: !!state.base?.p };
  }
  function isBase(center) {
    const b = state.base;
    if (!b || !center) return false;
    return C.haversineKm(b.lat, b.lon, center.lat, center.lon) < 0.5;
  }
  function baseLabel(b) {
    return b.t === "cp" ? `${b.nom} (${b.cp})` : "ma position enregistrée";
  }

  // ------------------------------------------------------------ utilitaires DOM
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    applyAttrs(el, attrs, false);
    append(el, kids);
    return el;
  }
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVG, tag);
    applyAttrs(el, attrs, true);
    append(el, kids);
    return el;
  }
  function applyAttrs(el, attrs, isSvg) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") isSvg ? el.setAttribute("class", v) : (el.className = v);
      else if (k === "style") Object.assign(el.style, v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  function mount(id, ...nodes) {
    const host = $(id);
    host.replaceChildren(...nodes.flat().filter(Boolean));
  }
  const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);

  // Prise de rendez-vous : lien direct de la collecte quand son planning est ouvert ;
  // sinon, page de réservation du site de l'EFS (recherche de collecte, filtrée sur le sang total).
  const EFS_RDV = "https://dondesang.efs.sante.fr/trouver-une-collecte";
  function rendezVous(c) {
    const direct = c.statut === C.STATUT.OUVERT ? safeUrl(c.lienRdv) : null;
    if (direct) return { url: direct, note: null };
    const url = state.don === "sang" ? `${EFS_RDV}?type_don=S` : EFS_RDV;
    const note = c.statut === C.STATUT.COMPLET
      ? "Collecte complète : le site de l’EFS propose les autres créneaux et lieux disponibles."
      : c.statut === C.STATUT.NON_OUVERT
        ? "Planning pas encore ouvert : la réservation se fera sur le site de l’EFS dès son ouverture."
        : "Lien direct indisponible : réservation sur le site de l’EFS.";
    return { url, note };
  }
  function boutonRdv(c, extraCls = "") {
    const r = rendezVous(c);
    return {
      bouton: h("a", { class: `btn primary block ${extraCls}`.trim(), href: r.url, target: "_blank", rel: "noopener",
        title: "Ouvre le site de l’Établissement français du sang pour réserver un créneau" }, "Prendre rendez-vous"),
      note: r.note ? h("p", { class: "rdv-note" }, r.note) : null,
    };
  }
  const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const km = (v) => `${nf.format(v)} km`;
  const pct = (v) => `${Math.round(v)} %`;

  const fDateLong = new Intl.DateTimeFormat("fr-FR", { timeZone: C.TZ, weekday: "long", day: "numeric", month: "long" });
  const fWd = new Intl.DateTimeFormat("fr-FR", { timeZone: C.TZ, weekday: "short" });
  const fDay = new Intl.DateTimeFormat("fr-FR", { timeZone: C.TZ, day: "numeric" });
  const fMon = new Intl.DateTimeFormat("fr-FR", { timeZone: C.TZ, month: "short" });
  const fShort = new Intl.DateTimeFormat("fr-FR", { timeZone: C.TZ, day: "2-digit", month: "2-digit" });
  const fTime = new Intl.DateTimeFormat("fr-FR", { timeZone: C.TZ, hour: "2-digit", minute: "2-digit" });
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  function daysUntil(c) {
    const today = C.parisDate(parisYmd(new Date()), { h: 12, m: 0 });
    const day = C.parisDate(c.jour, { h: 12, m: 0 });
    return Math.round((day - today) / 864e5);
  }
  function parisYmd(d) {
    const [y, mo, dd] = new Intl.DateTimeFormat("en-CA", { timeZone: C.TZ }).format(d).split("-").map(Number);
    return { y, mo, d: dd };
  }
  function relDay(n) {
    if (n <= 0) return "aujourd’hui";
    if (n === 1) return "demain";
    return `dans ${n} jours`;
  }

  // ------------------------------------------------------------------ réseau
  class ApiError extends Error {
    constructor(kind, details) {
      super(kind === "efs" ? "L’API de l’EFS n’a pas répondu." : "L’API Géo n’a pas répondu.");
      this.kind = kind;
      this.details = details;
    }
  }

  async function fetchJson(kind, query) {
    const urls = ENDPOINTS[kind];
    const order = [preferred[kind], ...urls.keys()].filter((v, i, a) => a.indexOf(v) === i);
    const details = [];
    for (const i of order) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const resp = await fetch(`${urls[i]}?${query}`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch { throw new Error("réponse non JSON"); }
        preferred[kind] = i;
        return data;
      } catch (err) {
        const msg = err.name === "AbortError" ? "délai dépassé" : err.message || String(err);
        details.push(`${i === 0 ? "via le proxy local" : "en direct"} : ${msg}`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ApiError(kind, details);
  }

  async function searchCommunes(cp) {
    const raw = state.demo
      ? window.EFS_DEMO.geo
      : await fetchJson("geo", new URLSearchParams({ codePostal: cp, fields: "nom,centre,code", format: "json" }).toString());
    return (Array.isArray(raw) ? raw : [])
      .map((c) => ({ nom: c.nom, code: c.code, lon: c.centre?.coordinates?.[0], lat: c.centre?.coordinates?.[1] }))
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }

  function demoPayload() {
    const d = window.EFS_DEMO;
    const ref = Date.UTC(...d.refDate.split("-").map((v, i) => (i === 1 ? v - 1 : +v)));
    const t = parisYmd(new Date());
    const offset = Math.round((Date.UTC(t.y, t.mo - 1, t.d) - ref) / 864e5);
    const shift = (str) => {
      const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})(.*)$/);
      if (!m) return str;
      const x = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + offset));
      return x.toISOString().slice(0, 10) + m[4];
    };
    const payload = JSON.parse(JSON.stringify(d.efs));
    for (const loc of payload.samplingLocationCollections || []) {
      for (const col of loc.collections || []) col.date = shift(col.date);
    }
    return payload;
  }

  // -------------------------------------------------------------- orchestration
  /** Lit le formulaire ; faux si le nombre de jours est hors bornes (signalé sous le champ). */
  function readForm() {
    state.cp = $("cp").value.trim();
    state.radius = +$("rayon").value;
    state.don = $("don").value;
    state.pro = $("pro").checked;
    state.rdvOnly = $("rdv").checked;
    const j = entierBorne($("horizon").value, BORNES.jours);
    $("horizon").setAttribute("aria-invalid", String(j === null));
    $("horizon-err").textContent = j === null ? "Nombre de jours : un entier de 1 à 180." : "";
    if (j === null) return false;
    state.horizon = j;
    return true;
  }

  function setBusy(b) {
    state.busy = b;
    for (const id of ["go", "geoloc", "demo"]) $(id).disabled = b;
    $("go").textContent = b ? "Recherche…" : "Rechercher";
  }

  async function onSubmit(ev) {
    if (ev) {
      ev.preventDefault();
      if (state.demo) { state.demo = false; state.cpLoaded = null; $("notice").replaceChildren(); }
    }
    if (!readForm()) { $("horizon").focus(); return; }
    $("cp-err").textContent = "";
    if (!/^\d{5}$/.test(state.cp)) {
      $("cp-err").textContent = "Saisissez un code postal à 5 chiffres.";
      $("cp").focus();
      return;
    }
    setBusy(true);
    try {
      if (state.cpLoaded !== state.cp || !state.communes.length) {
        state.communes = await searchCommunes(state.cp);
        state.cpLoaded = state.cp;
        if (!state.communes.length) {
          state.center = null;
          fillCommunes();
          $("cp-err").textContent = "Aucune commune ne correspond à ce code postal.";
          return;
        }
        if (!state.communes.some((c) => c.code === state.insee)) state.insee = state.communes[0].code;
        fillCommunes();
      }
      selectCommune();
      await loadCollectes();
    } catch (err) {
      showError(err);
      if (!state.result) renderEmptyAll();
    } finally {
      setBusy(false);
    }
  }

  function fillCommunes() {
    const sel = $("commune");
    sel.replaceChildren(...state.communes.map((c) => h("option", { value: c.code, selected: c.code === state.insee }, c.nom)));
    $("commune-field").hidden = state.communes.length < 2;
  }

  function selectCommune() {
    const c = state.communes.find((x) => x.code === state.insee) || state.communes[0];
    state.insee = c.code;
    state.center = { lat: c.lat, lon: c.lon, label: c.nom, cp: state.cp };
  }

  async function loadCollectes({ silent = false } = {}) {
    if (!state.center) return;
    if (communeSeule() && !state.center.cp) {
      // « Ma position » n'a pas de commune de référence : le rayon 0 n'a pas de sens.
      $("notice").replaceChildren(h("div", { class: "notice error", role: "alert" },
        h("p", null, "Le rayon 0 (uniquement la commune de départ) nécessite un code postal. Choisissez un rayon d’au moins 1 km ou saisissez un code postal.")));
      return;
    }
    if (!silent) showLoading();
    try {
      state.raw = state.demo
        ? demoPayload()
        : await fetchJson("efs", C.efsQuery(state.center.lat, state.center.lon, rayonRecherche(), 100));
      state.fetchedAt = new Date();
      state.error = null;
      $("notice").replaceChildren();
    } catch (err) {
      showError(err);
      if (!state.raw) { renderEmptyAll(); return; }
    }
    reparse();
    syncUrl();
    scheduleRefresh();
  }

  function reparse() {
    if (!state.raw || !state.center) return;
    const r = C.parseCollections(state.raw, {
      centerLat: state.center.lat, centerLon: state.center.lon, radiusKm: rayonRecherche(),
      donType: state.don, includePro: state.pro, horizonDays: state.horizon, now: new Date(),
    });
    state.result = communeSeule() ? C.filterCommune(r, state.center.label) : r;
    renderAll();
  }

  function scheduleRefresh() {
    clearInterval(state.timer);
    if (!state.demo) state.timer = setInterval(() => loadCollectes({ silent: true }), REFRESH_MS);
  }

  function syncUrl() {
    if (state.mode === "tablette") {
      // En mode tablette, les réglages viennent du cookie : l'adresse reste courte (favori de la tablette).
      history.replaceState(null, "", `${location.pathname}?mode=tablette`);
      return;
    }
    const p = new URLSearchParams();
    if (state.demo) p.set("demo", "1");
    if (state.cp) p.set("cp", state.cp);
    if (state.insee && state.communes.length > 1) p.set("insee", state.insee);
    if (state.center && state.center.label === "Ma position") {
      p.delete("cp"); p.delete("insee");
      p.set("lat", state.center.lat.toFixed(4)); p.set("lon", state.center.lon.toFixed(4));
    }
    p.set("r", state.radius);
    if (state.don !== "sang") p.set("don", state.don);
    if (state.horizon !== JOURS_DEFAUT) p.set("h", state.horizon);
    if (state.pro) p.set("pro", "1");
    if (state.rdvOnly) p.set("rdv", "1");
    if (state.communeVue !== "auto") p.set("vc", state.communeVue);
    history.replaceState(null, "", `${location.pathname}?${p}${location.hash}`);
  }

  // ------------------------------------------------------------------ messages
  function showLoading() {
    for (const id of ["v1", "v2", "v3"]) {
      if (!state.result) mount(id, h("div", { class: "skeleton", "aria-hidden": "true" }));
    }
    $("status").replaceChildren(h("span", null, "Interrogation de l’API de l’EFS…"));
  }

  function showError(err) {
    state.error = err;
    const isEfs = err instanceof ApiError && err.kind === "efs";
    const kept = isEfs && state.result;
    $("notice").replaceChildren(
      h("div", { class: "notice error", role: "alert" },
        h("p", null, h("strong", null, err.message || "Erreur inattendue."), kept ? " Les dernières données valides restent affichées." : ""),
        h("p", null, isEfs
          ? "Si la page est servie sans le proxy fourni (par exemple depuis le dossier www de Home Assistant), le navigateur peut bloquer l’appel direct à l’API (règle CORS). L’hébergement Docker du kit résout ce point."
          : "Vérifiez la connexion Internet du poste, puis relancez la recherche."),
        err.details ? h("p", { class: "muted" }, "Détail : ", err.details.join(" ; ")) : null,
        h("p", null, h("button", { class: "btn secondary", type: "button", onclick: startDemo }, "Afficher les données de démonstration")),
      ),
    );
    renderStatus();
    renderTablette();
  }

  function renderStatus() {
    const st = $("status");
    if (!state.result) { st.replaceChildren(); return; }
    const r = state.result;
    const dot = state.demo ? "demo" : state.error ? "err" : "";
    const parts = [
      state.demo ? "Mode démonstration (réponses enregistrées)" : `Données EFS de ${fTime.format(state.fetchedAt)}`,
      `${state.center.label}${state.center.cp && state.center.label !== "Ma position" ? ` (${state.center.cp})` : ""}${isBase(state.center) ? " – lieu de base" : ""}`,
      perimetre(),
      `${visibles().length} collecte${visibles().length > 1 ? "s" : ""}${state.rdvOnly ? " avec rendez-vous possible" : ""}`,
    ];
    if (r.rejets.length) parts.push(`${r.rejets.length} lieu${r.rejets.length > 1 ? "x" : ""} écarté${r.rejets.length > 1 ? "s" : ""} (hors rayon ou incohérent)`);
    mount("status",
      h("span", null, h("span", { class: `dot ${dot}`, "aria-hidden": "true" }), parts.join(" · ")),
      state.demo ? null : h("button", { class: "btn ghost", type: "button", onclick: () => loadCollectes() }, "Actualiser"),
    );
  }

  // ------------------------------------------------------------------- rendus
  /** Collectes affichées : celles de la recherche, éventuellement réduites aux rendez-vous ouverts. */
  function visibles() {
    const list = state.result.collectes;
    return state.rdvOnly ? list.filter((c) => c.statut === C.STATUT.OUVERT) : list;
  }
  const cle = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Graphie usuelle des communes : « BRETTEVILLE SUR ODON » → « Bretteville-sur-Odon ».
  const PETITS_MOTS = new Set(["sur", "sous", "en", "le", "la", "les", "de", "du", "des", "aux", "au", "et", "lès", "lez"]);
  const titreCommune = (s) => {
    const mots = String(s || "").toLowerCase().trim()
      .replace(/(^|[\s-])([ld])[\s-]+(?=[a-zà-ÿ])/g, "$1$2'") // « L ORGUEILLEUSE » → « l'Orgueilleuse »
      .split(/[\s-]+/).filter(Boolean);
    const forme = mots.map((m, i) => {
      if (i > 0 && PETITS_MOTS.has(m)) return m;
      return m.replace(/^([dl]['’])?(.)/, (x, el, c) => (el ? (i > 0 ? el : el.toUpperCase()) : "") + c.toUpperCase());
    });
    // Les noms composés s'écrivent avec des traits d'union, sauf l'article initial (« Le Fresne-Camilly »).
    const article = forme.length > 1 && ["Le", "La", "Les"].includes(forme[0]);
    return article ? `${forme[0]} ${forme.slice(1).join("-")}` : forme.join("-");
  };

  function fillVueCommune() {
    const sel = $("vue-commune");
    const groupes = new Map();
    for (const c of visibles()) {
      const nom = c.commune || c.lieu;
      const k = cle(nom);
      if (!groupes.has(k)) groupes.set(k, { nom, dates: [] });
      groupes.get(k).dates.push(fShort.format(c.debut));
    }
    const opts = [h("option", { value: "auto" }, "Prochaine collecte (la plus proche dans le temps)")];
    for (const [k, g] of groupes) {
      opts.push(h("option", { value: k }, `${titreCommune(g.nom)} · ${g.dates.slice(0, 4).join(", ")}${g.dates.length > 4 ? "…" : ""}`));
    }
    if (state.communeVue !== "auto" && !groupes.has(state.communeVue)) {
      opts.push(h("option", { value: state.communeVue }, `${titreCommune(state.communeVue)} · aucune collecte ${state.rdvOnly ? "avec rendez-vous possible" : "à venir"}`));
    }
    sel.replaceChildren(...opts);
    sel.value = state.communeVue;
  }

  function renderAll() {
    if (state.mode === "tablette") renderTablette();
    renderStatus();
    renderBase();
    fillVueCommune();
    renderV1();
    renderV2();
    renderV3();
  }
  function renderEmptyAll() {
    const msg = h("div", { class: "card empty" }, "Aucune donnée à afficher pour le moment.");
    mount("v1", msg.cloneNode(true)); mount("v2", msg.cloneNode(true)); mount("v3", msg);
  }
  function emptyCard() {
    return h("div", { class: "card empty" },
      communeSeule()
        ? `Aucune collecte à ${state.center ? state.center.label : "cette commune"} dans les ${state.horizon} prochains jours. `
        : `Aucune collecte dans les ${state.horizon} prochains jours à moins de ${state.radius} km. `,
      communeSeule() ? "Augmentez le nombre de jours ou choisissez un rayon." : "Élargissez le rayon ou le nombre de jours.");
  }

  function statusChip(c) {
    if (c.statut === C.STATUT.COMPLET) return h("span", { class: "chip full" }, "Complet");
    if (c.statut === C.STATUT.NON_OUVERT) return h("span", { class: "chip neutral" }, "Planning non ouvert");
    return h("span", { class: "chip ok" }, "Planning ouvert");
  }
  function directionsUrl(c) {
    const o = state.center;
    return `https://www.openstreetmap.org/directions?route=${o.lat.toFixed(5)}%2C${o.lon.toFixed(5)}%3B${c.latitude.toFixed(5)}%2C${c.longitude.toFixed(5)}`;
  }
  function osmUrl(lat, lon) {
    return `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=16/${lat.toFixed(5)}/${lon.toFixed(5)}`;
  }
  function dropIcon() {
    return s("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2,
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
    s("path", { d: "M12 2.7c3.6 4.6 6 8 6 11.3a6 6 0 0 1-12 0c0-3.3 2.4-6.7 6-11.3z" }));
  }
  function pinIcon() {
    return s("svg", { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2,
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "muted" },
    s("path", { d: "M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z" }), s("circle", { cx: 12, cy: 9.5, r: 2.5 }));
  }

  // Visuel 1 – synthèse
  function renderV1() {
    const list = visibles();
    const now = new Date();
    // Par défaut la prochaine collecte du calendrier ; sinon la prochaine dans la commune choisie.
    const voulue = state.communeVue !== "auto" ? state.communeVue : null;
    const dansCommune = voulue ? list.find((x) => x.fin > now && cle(x.commune || x.lieu) === voulue) : null;
    const c = dansCommune || C.nextCollecte(list, now);
    if (!c) { mount("v1", emptyCard()); return; }
    const remplacee = voulue && !dansCommune
      ? h("div", { class: "notice inline" }, h("p", null,
        `Aucune collecte à venir à ${titreCommune(voulue)}${state.rdvOnly ? " avec rendez-vous possible" : ""} : la prochaine collecte est affichée.`))
      : null;
    const open = c.placesRestantes !== null;
    const rdv = boutonRdv(c);
    const others = list.length - 1;

    const card = h("article", { class: "card v1", "aria-label": "Prochaine collecte" },
      h("div", { class: "row" },
        h("div", { class: "row", style: { justifyContent: "flex-start" } },
          h("div", { class: "icon" }, dropIcon()), h("strong", { style: { fontSize: "17px" } }, "Don du sang")),
        h("span", { class: "chip neutral" }, C.DON_FIELDS[state.don].label)),
      h("div", null,
        h("div", { class: "kicker" }, `${dansCommune ? `Prochaine collecte à ${titreCommune(c.commune || c.lieu)}` : "Prochaine collecte"} · ${relDay(daysUntil(c))}`),
        h("div", { class: "date" }, cap(fDateLong.format(c.debut))),
        h("div", { style: { color: "var(--text-2)" } }, c.horaires)),
      h("div", { class: "place" }, pinIcon(),
        h("div", null,
          h("strong", null, [c.lieu, titreCommune(c.commune)].filter(Boolean).join(" · ")),
          h("div", { class: "muted", style: { fontSize: "14px" } }, [c.adresse, km(c.distance)].filter(Boolean).join(" · ")))),
      open
        ? h("div", null,
          h("div", { class: "row", style: { alignItems: "baseline" } },
            h("div", null, h("span", { class: "big" }, c.placesRestantes), " ",
              h("span", { style: { color: "var(--text-2)" } }, c.placesTotales ? `places restantes sur ${c.placesTotales}` : "places restantes")),
            statusChip(c)),
          c.taux !== null
            ? [h("div", { class: "bar", style: { margin: "10px 0 8px" }, role: "img", "aria-label": `${pct(c.taux)} des places réservées` },
              h("span", { style: { width: `${Math.min(100, c.taux)}%` } })),
            h("div", { class: "row muted", style: { fontSize: "13px" } },
              h("span", null, `Taux de remplissage ${pct(c.taux)}`),
              c.placesReservees !== null ? h("span", null, `${c.placesReservees} réservées`) : null)]
            : null)
        : h("div", { class: "row" },
          h("span", { style: { color: "var(--text-2)" } }, "Les rendez-vous ne sont pas encore ouverts pour cette collecte."),
          statusChip(c)),
      h("div", { class: "btns" },
        rdv.bouton,
        h("a", { class: "btn secondary", href: directionsUrl(c), target: "_blank", rel: "noopener" }, "Itinéraire")),
      rdv.note,
      h("div", { class: "row muted", style: { fontSize: "12px", borderTop: "1px solid var(--line)", paddingTop: "12px" } },
        h("span", null, state.demo ? "Données de démonstration" : `Mis à jour à ${fTime.format(state.fetchedAt)}`),
        h("span", null, others > 0 ? `${others} autre${others > 1 ? "s" : ""} collecte${others > 1 ? "s" : ""} ${communeSeule() ? "dans la commune" : `dans ${state.radius} km`}` : "Seule collecte de la période")),
    );

    const ouverts = list.filter((x) => x.placesRestantes !== null && x.placesRestantes > 0);
    const dispo = ouverts.reduce((a, x) => a + x.placesRestantes, 0);
    const proche = list.reduce((a, x) => (!a || x.distance < a.distance ? x : a), null);
    const fact = (k, v, sub) => h("div", { class: "fact" }, h("div", { class: "k" }, k), h("div", { class: "v" }, v), h("div", { class: "s" }, sub));
    const facts = h("div", { class: "facts" },
      fact("Collectes à venir", list.length, `sur ${state.horizon} jours`),
      fact("Rendez-vous possibles", ouverts.length, ouverts.length ? "collectes au planning ouvert" : "aucun planning ouvert"),
      fact("Places disponibles", dispo, "cumul des collectes ouvertes"),
      fact("Collecte la plus proche", km(proche.distance), titreCommune(proche.commune || proche.lieu)),
    );
    mount("v1", remplacee, h("div", { class: "v1-layout" }, card, facts));
  }

  // Visuel 2 – agenda
  function renderV2() {
    const list = visibles();
    if (!list.length) { mount("v2", emptyCard()); return; }
    const shown = state.showAll ? list : list.slice(0, AGENDA_LIMIT);
    const items = shown.map((c) => {
      const rdv = safeUrl(c.lienRdv);
      let right;
      if (c.statut === C.STATUT.OUVERT) {
        right = [
          h("span", null, c.placesTotales ? `${c.placesRestantes} / ${c.placesTotales}` : `${c.placesRestantes} places`),
          c.taux !== null ? h("div", { class: "bar", role: "img", "aria-label": `${pct(c.taux)} réservées` }, h("span", { style: { width: `${Math.min(100, c.taux)}%` } })) : null,
          rdv ? h("a", { href: rdv, target: "_blank", rel: "noopener" }, "Rendez-vous") : null,
        ];
      } else {
        right = statusChip(c);
      }
      const pro = C.isProfessional(c.nature);
      return h("li", null,
        h("div", { class: "d" }, h("small", null, fWd.format(c.debut)), h("strong", null, fDay.format(c.debut)), h("em", null, fMon.format(c.debut))),
        h("div", { class: "who" },
          h("b", null, titreCommune(c.commune || c.lieu)),
          h("span", null, [c.lieu, km(c.distance), pro ? "réservée (professionnelle)" : null].filter(Boolean).join(" · ")),
          h("span", null, c.horaires)),
        h("div", { class: "st" }, right));
    });
    const more = list.length > AGENDA_LIMIT
      ? h("div", { class: "more" }, h("button", {
        class: "btn secondary", type: "button",
        onclick: () => { state.showAll = !state.showAll; renderV2(); },
      }, state.showAll ? "Réduire la liste" : `Afficher les ${list.length - AGENDA_LIMIT} autres collectes`))
      : null;
    mount("v2", h("article", { class: "card", "aria-label": "Agenda des collectes" },
      h("div", { class: "row", style: { alignItems: "baseline", paddingBottom: "6px" } },
        h("strong", { style: { fontSize: "19px" } }, "Collectes à venir"),
        h("span", { class: "muted", style: { fontSize: "13px" } }, `${list.length} · ${perimetre()} · ${state.horizon} jours`)),
      h("ul", { class: "agenda" }, items),
      more));
  }

  // Visuel 3 – carte, jauge, remplissage
  function renderV3() {
    const r = { ...state.result, collectes: visibles() };
    const map = buildMap(r);
    const now = new Date();
    const gaugeTarget = r.collectes.find((c) => c.fin > now && c.taux !== null);
    const filled = r.collectes.filter((c) => c.taux !== null).slice(0, 6);

    const gauge = h("article", { class: "card", "aria-label": "Jauge de remplissage" },
      gaugeTarget
        ? [h("strong", { style: { fontSize: "16px" } }, `Remplissage · ${titreCommune(gaugeTarget.commune || gaugeTarget.lieu)}`),
          h("div", { class: "muted", style: { fontSize: "13px" } }, `${cap(fDateLong.format(gaugeTarget.debut))} · prochaine collecte aux rendez-vous ouverts`),
          buildGauge(gaugeTarget)]
        : [h("strong", { style: { fontSize: "16px" } }, "Remplissage"),
          h("p", { class: "muted" }, "Aucune collecte au planning ouvert pour l’instant.")]);

    const fills = h("article", { class: "card", "aria-label": "Remplissage des prochaines collectes" },
      h("div", { class: "row", style: { alignItems: "baseline" } },
        h("strong", { style: { fontSize: "16px" } }, "Places réservées par collecte"),
        h("span", { class: "muted", style: { fontSize: "13px" } }, `${filled.length} au planning ouvert`)),
      filled.length
        ? h("ul", { class: "fill-list" }, filled.map((c) => h("li", null,
          h("div", { class: "row" },
            h("span", null, `${fShort.format(c.debut)} · ${titreCommune(c.commune || c.lieu)}`),
            h("span", { class: "muted" }, c.placesTotales ? `${c.placesRestantes} / ${c.placesTotales} libres` : pct(c.taux))),
          h("div", { class: "bar", role: "img", "aria-label": `${pct(c.taux)} réservées` }, h("span", { style: { width: `${Math.min(100, c.taux)}%` } })))))
        : h("p", { class: "muted" }, "Les compteurs apparaîtront à l’ouverture des plannings."));

    mount("v3", h("div", { class: "v3" }, map, h("div", { class: "side" }, gauge, fills)));
  }

  function buildGauge(c) {
    const p = Math.max(0, Math.min(100, c.taux)) / 100;
    const a = Math.PI - p * Math.PI;
    const x = (100 + 80 * Math.cos(a)).toFixed(1);
    const y = (100 - 80 * Math.sin(a)).toFixed(1);
    return s("svg", { class: "gauge", viewBox: "0 0 200 116", role: "img", "aria-label": `Jauge : ${pct(c.taux)} des places réservées`, style: { maxWidth: "260px", margin: "8px auto 0" } },
      s("path", { class: "gauge-bg", d: "M20 100 A80 80 0 0 1 180 100" }),
      p > 0 ? s("path", { class: "gauge-fg", d: `M20 100 A80 80 0 0 1 ${x} ${y}` }) : null,
      s("text", { x: 100, y: 92, "text-anchor": "middle", "font-size": 30, class: "svg-strong" }, pct(c.taux)),
      s("text", { x: 100, y: 112, "text-anchor": "middle", "font-size": 11, class: "svg-muted" },
        c.placesReservees !== null && c.placesTotales ? `${c.placesReservees} réservées / ${c.placesTotales}` : ""));
  }

  function buildMap(r) {
    const W = 512, H = 480, CX = 256, CY = 240, RPX = 200;
    const o = state.center;
    const R = rayonCarte(r.collectes);
    const scale = RPX / R;
    const cosLat = Math.cos((o.lat * Math.PI) / 180);
    const proj = (lat, lon) => [CX + (lon - o.lon) * 111 * cosLat * scale, CY - (lat - o.lat) * 111 * scale];

    // Grille kilométrique
    const step = [1, 2, 5, 10, 20, 25, 50].find((v) => R / v <= 3) || 50;
    const grid = [];
    for (let k = -Math.floor(R / step) * step; k <= R; k += step) {
      const p = CX + k * scale, q = CY + k * scale;
      grid.push(s("line", { class: "map-grid", x1: p, y1: 0, x2: p, y2: H }), s("line", { class: "map-grid", x1: 0, y1: q, x2: W, y2: q }));
    }

    // Un marqueur par lieu, coloré selon sa prochaine collecte
    const now = new Date();
    const next = C.nextCollecte(r.collectes, now);
    const byPlace = new Map();
    for (const c of r.collectes) {
      const k = `${c.lieu}|${c.latitude}|${c.longitude}`;
      if (!byPlace.has(k)) byPlace.set(k, c);
    }
    const placed = [];
    const markers = [];
    for (const c of byPlace.values()) {
      const [x, y] = proj(c.latitude, c.longitude);
      const cls = c.statut === C.STATUT.OUVERT ? "mk-open" : c.statut === C.STATUT.COMPLET ? "mk-full" : "mk-closed";
      const isNext = c === next;
      const label = `${titreCommune(c.commune || c.lieu)} · ${fShort.format(c.debut)}${c.statut === C.STATUT.COMPLET ? " complet" : ""}`;
      const right = x < W - 170;
      let ly = y + 4;
      for (let t = 0; t < 6 && placed.some((p) => Math.abs(p.y - ly) < 14 && Math.abs(p.x - x) < 170); t++) ly += 15;
      placed.push({ x, y: ly });
      markers.push(s("a", { href: osmUrl(c.latitude, c.longitude), target: "_blank", rel: "noopener" },
        s("title", null, `${c.lieu}, ${c.commune || ""} – ${c.textePlaces}`),
        s("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: isNext ? 11 : 8, class: `${cls}${isNext ? " mk-next" : ""}` }),
        s("text", { class: "map-label", x: (right ? x + 14 : x - 14).toFixed(1), y: ly.toFixed(1), "text-anchor": right ? "start" : "end" }, label)));
    }
    const maisons = r.maisons.map((m) => {
      const [x, y] = proj(m.latitude, m.longitude);
      return s("a", { href: osmUrl(m.latitude, m.longitude), target: "_blank", rel: "noopener" },
        s("title", null, `${m.nom} – horaires fixes`),
        s("rect", { x: (x - 7).toFixed(1), y: (y - 7).toFixed(1), width: 14, height: 14, rx: 3, class: "mk-maison" }));
    });

    const svg = s("svg", { class: "map", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": communeSeule() ? `Carte des lieux de collecte de ${o.label}` : `Carte des lieux de collecte dans un rayon de ${R} km autour de ${o.label}`, style: { borderRadius: "12px" } },
      s("rect", { class: "map-bg", x: 0, y: 0, width: W, height: H }),
      grid,
      s("circle", { class: "map-circle", cx: CX, cy: CY, r: RPX }),
      s("text", { class: "map-small", x: CX, y: CY - RPX - 8, "text-anchor": "middle" }, `${R} km`),
      s("text", { class: "map-small", x: 12, y: H - 12 }, `Quadrillage : ${step} km`),
      s("circle", { class: "map-home", cx: CX, cy: CY, r: 9 }),
      s("path", { class: "map-home-roof", d: `M${CX - 5} ${CY + 2} L${CX} ${CY - 4} L${CX + 5} ${CY + 2} V${CY + 6} H${CX - 5} Z` }),
      maisons, markers);

    const dot = (cls, shape) => s("svg", { width: 12, height: 12, "aria-hidden": "true" },
      shape === "rect" ? s("rect", { x: 1, y: 1, width: 10, height: 10, rx: 2, class: cls }) : s("circle", { cx: 6, cy: 6, r: 4.5, class: cls }));
    return h("article", { class: "card", "aria-label": "Carte des collectes" },
      h("div", { class: "row", style: { alignItems: "baseline", marginBottom: "12px" } },
        h("strong", { style: { fontSize: "17px" } }, communeSeule() ? `Collectes à ${o.label}` : `Collectes dans un rayon de ${state.radius} km`),
        h("span", { class: "muted", style: { fontSize: "13px" } }, `${byPlace.size} lieu${byPlace.size > 1 ? "x" : ""}`)),
      svg,
      h("div", { class: "legend" },
        h("span", null, dot("mk-open"), "Planning ouvert"),
        h("span", null, dot("mk-closed"), "Non ouvert"),
        h("span", null, dot("mk-full"), "Complet"),
        r.maisons.length ? h("span", null, dot("mk-maison", "rect"), "Maison du don") : null),
      r.maisons.length
        ? h("p", { class: "maisons" }, "Maisons du don (horaires fixes) : ", r.maisons.map((m) => `${m.nom} (${km(m.distance)})`).join(", "))
        : null);
  }

  function renderBase() {
    const b = state.base;
    const here = state.center;
    const pinSvg = s("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true" },
      s("path", { d: "M12 2C8 2 5 5.1 5 9.1 5 14.5 12 22 12 22s7-7.5 7-12.9C19 5.1 16 2 12 2zm0 9.6a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" }));
    const persist = h("label", { class: "check" },
      h("input", { type: "checkbox", id: "base-persist", checked: b ? b.p : true }),
      " Mémoriser sur cet appareil (cookie, 1 an)");
    const btn = (label, onclick, cls = "secondary") => h("button", { class: `btn ${cls}`, type: "button", onclick }, label);
    const parts = [];
    if (b) {
      parts.push(h("span", { class: "pin" }, pinSvg, `Lieu de base : ${baseLabel(b)}`));
      const acts = [];
      if (!isBase(here)) acts.push(btn("Revenir au lieu de base", goToBase));
      if (here && !isBase(here) && !state.demo) acts.push(btn(`Remplacer par ${here.label}`, saveBase, "ghost"));
      acts.push(btn("Oublier", forgetBase, "ghost"));
      parts.push(h("div", { class: "actions-base" }, acts));
      parts.push(h("p", { class: "note" }, b.p
        ? "Enregistré dans un cookie de ce navigateur pour un an : la page s’ouvrira directement sur ce lieu."
        : "Gardé pour cette session seulement : le cookie s’effacera à la fermeture du navigateur."));
    } else {
      parts.push(h("span", null, "Aucun lieu de base : la page s’ouvre sur le dernier lien utilisé ou sur 14760."));
      if (here && !state.demo) {
        parts.push(h("div", { class: "actions-base" }, btn(`Définir ${here.label} comme lieu de base`, saveBase), persist));
      }
    }
    mount("base", parts);
  }

  function saveBase() {
    const persistBox = $("base-persist");
    const persistent = persistBox ? persistBox.checked : !!state.base?.p;
    const b = { ...currentAsBase(), p: persistent };
    if (!Base.write(b, persistent)) {
      $("notice").replaceChildren(h("div", { class: "notice error", role: "alert" },
        h("p", null, "Le navigateur a refusé le cookie (page ouverte depuis un fichier local, ou cookies bloqués pour ce site). Le lieu de base est gardé jusqu’à la fermeture de la page.")));
    }
    state.base = b;
    renderBase();
    renderStatus();
  }

  function forgetBase() {
    Base.clear();
    state.base = null;
    renderBase();
    renderStatus();
  }

  async function goToBase() {
    const b = state.base;
    if (!b) return;
    state.demo = false;
    state.communeVue = "auto";
    if (b.t === "geo") {
      readForm();
      state.center = { lat: b.lat, lon: b.lon, label: "Ma position", cp: null };
      await loadCollectes();
      return;
    }
    $("cp").value = b.cp;
    state.insee = b.insee || null;
    state.cpLoaded = null;
    await onSubmit();
  }

  // ================================================================ mode tablette
  // Affichage compact et lisible de loin d'un lieu de collecte choisi. Les réglages (lieu initial,
  // rayon, nombre de jours, type de don, lieu affiché) sont conservés dans un cookie fonctionnel,
  // déposé uniquement quand l'utilisateur clique sur « Enregistrer ».
  const TAB_COOKIE = "efs_tablette";
  const Tab = {
    read() {
      try {
        const m = document.cookie.split("; ").find((c) => c.startsWith(TAB_COOKIE + "="));
        if (!m) return null;
        const t = JSON.parse(decodeURIComponent(m.slice(TAB_COOKIE.length + 1)));
        const ok = /^\d{5}$/.test(t?.cp || "") && Number.isFinite(t?.lat) && Number.isFinite(t?.lon)
          && entierBorne(t.r, BORNES.rayon) !== null && entierBorne(t.j, BORNES.jours) !== null
          && t.don in C.DON_FIELDS && typeof t.nom === "string";
        return ok ? t : null;
      } catch {
        return null;
      }
    },
    write(t) {
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${TAB_COOKIE}=${encodeURIComponent(JSON.stringify(t))}; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`;
      return Tab.read() !== null; // faux si le navigateur refuse les cookies
    },
    clear() {
      document.cookie = `${TAB_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    },
  };

  /** Clé d'un lieu de collecte (un même lieu revient à plusieurs dates). */
  const cleLieu = (c) => `${cle(c.lieu)}|${cle(c.commune)}`;
  const nomLieu = (c) => [c.lieu, titreCommune(c.commune)].filter(Boolean).join(" · ");

  function enterTablette(cfg) {
    state.mode = "tablette";
    state.demo = false;
    state.tabCfg = cfg || null;
    state.tabPremier = !cfg; // premier usage : la fenêtre de réglages s'ouvre après la recherche
    document.body.classList.add("mode-tablette");
    $("tablette").hidden = false;
    // Le mode tablette affiche toutes les collectes du type choisi, hors collectes professionnelles.
    $("pro").checked = false;
    $("rdv").checked = false;
    if (cfg) {
      state.tabLieu = cfg.lieu || "auto";
      state.tabLieuNom = cfg.lieuNom || "";
      $("cp").value = cfg.cp;
      state.insee = cfg.insee || null;
      $("rayon").value = cfg.r;
      $("rayon").dispatchEvent(new Event("input"));
      $("horizon").value = cfg.j;
      $("don").value = cfg.don;
    }
    state.cpLoaded = null;
    clearInterval(state.tabTimer);
    // Horloge et « dans N jours » tenus à jour ; les données, elles, sont relues toutes les heures.
    const tick = () => {
      $("tab-horloge").textContent = fTime.format(new Date());
      if (state.result && new Date().getMinutes() % 5 === 0) renderTablette();
    };
    tick();
    state.tabTimer = setInterval(tick, 60000);
    renderTablette();
    onSubmit();
  }

  function exitTablette() {
    state.mode = "normal";
    clearInterval(state.tabTimer);
    document.body.classList.remove("mode-tablette");
    $("tablette").hidden = true;
    syncUrl();
    if (state.result) renderAll();
    window.scrollTo(0, 0);
  }

  function renderTablette() {
    if (state.mode !== "tablette") return;
    const lieuChoisi = state.tabLieu !== "auto";
    $("tab-titre").textContent = `Don du sang · ${lieuChoisi && state.tabLieuNom ? state.tabLieuNom : state.center ? state.center.label : "…"}`;
    const reglages = () => h("button", { class: "btn primary", type: "button", onclick: openReglages }, "⚙ Ouvrir les réglages");

    if (!state.result) {
      mount("tab-main", state.error
        ? h("div", { class: "card empty tab-alerte" }, h("p", null, state.error.message || "Erreur inattendue."),
          h("button", { class: "btn secondary", type: "button", onclick: () => onSubmit() }, "Réessayer"))
        : h("div", { class: "skeleton tab-alerte" }));
      $("tab-pied").replaceChildren();
      return;
    }
    const list = visibles();
    const now = new Date();
    const auLieu = lieuChoisi ? list.find((x) => x.fin > now && cleLieu(x) === state.tabLieu) : null;
    const c = auLieu || C.nextCollecte(list, now);
    const alerte = lieuChoisi && !auLieu
      ? h("div", { class: "notice tab-alerte" }, h("p", null,
        `Aucune collecte prévue à ${state.tabLieuNom || "ce lieu"} dans les ${state.horizon} prochains jours`,
        c ? " : prochaine collecte du secteur affichée." : "."))
      : null;

    if (!c) {
      mount("tab-main", alerte, h("div", { class: "card empty tab-alerte" },
        h("p", null, communeSeule()
          ? `Aucune collecte à ${state.center.label} dans les ${state.horizon} prochains jours.`
          : `Aucune collecte dans les ${state.horizon} prochains jours à moins de ${state.radius} km.`),
        reglages()));
    } else {
      const ouvert = c.placesRestantes !== null;
      const rdv = boutonRdvTablette(c);
      const carte = h("article", { class: "card tab-carte", "aria-label": "Prochaine collecte" },
        h("div", { class: "row" },
          h("div", { class: "kicker" }, `${auLieu ? "Prochaine collecte ici" : "Prochaine collecte"} · ${relDay(daysUntil(c))}`),
          statusChip(c)),
        h("div", null, h("div", { class: "tab-date" }, cap(fDateLong.format(c.debut))), h("div", { class: "tab-heures" }, c.horaires)),
        h("div", { class: "tab-lieu" }, nomLieu(c), h("small", null, [c.adresse, km(c.distance)].filter(Boolean).join(" · "))),
        ouvert
          ? h("div", null,
            h("div", { class: "tab-places" }, h("span", { class: "n" }, c.placesRestantes),
              h("span", { class: "t" }, c.placesTotales ? `places restantes sur ${c.placesTotales}` : "places restantes")),
            c.taux !== null ? h("div", { class: "bar", style: { marginTop: "12px" }, role: "img", "aria-label": `${pct(c.taux)} des places réservées` },
              h("span", { style: { width: `${Math.min(100, c.taux)}%` } })) : null)
          : h("div", { class: "tab-heures" }, "Les rendez-vous ne sont pas encore ouverts."),
        h("div", { class: "btns" },
          rdv.bouton,
          h("a", { class: "btn secondary", href: directionsUrl(c), target: "_blank", rel: "noopener" }, "Itinéraire")),
        rdv.note);
      const suite = list.filter((x) => x !== c && x.fin > now).slice(0, 5);
      const suiteCarte = h("article", { class: "card tab-suite", "aria-label": "Collectes suivantes" },
        h("h3", null, auLieu ? "Autres collectes du secteur" : "Collectes suivantes"),
        suite.length
          ? h("ul", null, suite.map((x) => h("li", null,
            h("div", { class: "d" }, h("small", null, fWd.format(x.debut)), h("strong", null, fDay.format(x.debut)), h("small", null, fMon.format(x.debut))),
            h("div", { class: "who" }, h("b", null, titreCommune(x.commune || x.lieu)), h("span", null, `${x.lieu} · ${x.horaires}`)),
            h("div", { class: "pl" }, x.placesRestantes === null ? "—" : x.placesTotales ? `${x.placesRestantes}/${x.placesTotales}` : x.placesRestantes),
            h("button", { class: "btn secondary resa", type: "button", onclick: () => ouvrirRdv(x),
              "aria-label": `Réserver : ${titreCommune(x.commune || x.lieu)}, ${fDateLong.format(x.debut)}` }, "Réserver"))))
          : h("p", { class: "muted" }, "Aucune autre collecte dans la période."));
      const info = state.rdvInfo ? h("div", { class: "notice tab-info", role: "status" }, h("p", null, state.rdvInfo)) : null;
      mount("tab-main", info, alerte, carte, suiteCarte);
    }
    mount("tab-pied",
      h("span", null, [
        state.error ? "API indisponible : dernières données conservées" : `Mis à jour à ${fTime.format(state.fetchedAt)}`,
        `${state.center.label}${state.center.cp ? ` (${state.center.cp})` : ""}`,
        perimetre(), `${state.horizon} jours`, C.DON_FIELDS[state.don].label,
      ].join(" · ")),
      h("span", null, Tab.read() ? "Réglages enregistrés sur cet appareil" : "Réglages non enregistrés : ⚙ Réglages → Enregistrer"));
    if (state.tabPremier) {
      state.tabPremier = false;
      openReglages();
    }
  }

  // ------------------------------------------------- rendez-vous depuis la tablette
  // Le donneur est en face de la tablette : la réservation s'ouvre dans une fenêtre séparée
  // (nouvel onglet sur téléphone ou tablette), la tablette affiche « Prise de rendez-vous en
  // cours » et reprend la main à la fermeture de cette fenêtre, en actualisant les places.
  const rdv = { win: null, timer: null, collecte: null };

  function boutonRdvTablette(c) {
    const r = rendezVous(c);
    return {
      bouton: h("button", { class: "btn primary block", type: "button", onclick: () => ouvrirRdv(c),
        title: "Ouvre le site de l’EFS dans une fenêtre séparée ; la fermer ramène à la tablette" }, "Prendre rendez-vous"),
      note: r.note ? h("p", { class: "rdv-note" }, r.note) : null,
    };
  }

  function ouvrirRdv(c) {
    const { url } = rendezVous(c);
    rdv.collecte = c;
    // Fenêtre déjà ouverte : on la réutilise pour la nouvelle collecte.
    if (rdv.win && !rdv.win.closed) {
      try { rdv.win.location.href = url; rdv.win.focus(); } catch { /* fenêtre d'un autre site : laissée telle quelle */ }
      afficherRdvEnCours();
      return;
    }
    const W = Math.min(1100, screen.availWidth || 1100), H = screen.availHeight || 900;
    // La fenêtre garde son lien avec la tablette (pas de « noopener ») : c'est ce qui permet de
    // savoir quand elle est fermée et de la fermer depuis la tablette. Elle ne charge que le
    // site officiel de l'EFS (dondesang.efs.sante.fr ou ses liens courts efs.link).
    const w = window.open(url, "efs-rendez-vous", `popup=yes,width=${W},height=${H},left=0,top=0`);
    if (!w) {
      // Fenêtres bloquées (navigateur kiosque, bloqueur) : ouverture dans un onglet classique.
      window.open(url, "_blank", "noopener");
      state.rdvInfo = "Le navigateur a bloqué la fenêtre de rendez-vous : elle s’est ouverte dans un nouvel onglet. Fermez-le une fois le rendez-vous pris.";
      renderTablette();
      return;
    }
    rdv.win = w;
    afficherRdvEnCours();
    clearInterval(rdv.timer);
    rdv.timer = setInterval(surveillerRdv, 1000);
  }

  function afficherRdvEnCours() {
    const c = rdv.collecte;
    $("rdv-collecte").textContent = c
      ? `Collecte : ${cap(fDateLong.format(c.debut))}, ${c.horaires}, ${nomLieu(c)}.`
      : "";
    if (!$("rdv-encours").open) $("rdv-encours").showModal();
  }

  function surveillerRdv() {
    if (rdv.win && !rdv.win.closed) return;
    finRdv();
  }

  function finRdv() {
    clearInterval(rdv.timer);
    rdv.timer = null;
    rdv.win = null;
    if ($("rdv-encours").open) $("rdv-encours").close();
    // Les places ont pu changer : relecture immédiate (le relais garde 5 min en cache au plus).
    state.rdvInfo = "Fenêtre de rendez-vous fermée : les places affichées sont actualisées.";
    if (!state.demo && state.center) loadCollectes({ silent: true });
    else renderTablette();
    setTimeout(() => { state.rdvInfo = null; renderTablette(); }, 15000);
  }

  function initRdv() {
    $("rdv-retour").addEventListener("click", () => {
      if (rdv.win && !rdv.win.closed) rdv.win.focus();
      else finRdv();
    });
    $("rdv-fermer").addEventListener("click", () => {
      try { if (rdv.win && !rdv.win.closed) rdv.win.close(); } catch { /* ignoré */ }
      finRdv();
    });
    // Échap ferme seulement l'encart : la surveillance continue tant que la fenêtre existe.
    $("rdv-encours").addEventListener("cancel", (ev) => { if (rdv.win && !rdv.win.closed) ev.preventDefault(); });
    // Retour sur la tablette (onglet réactivé) : vérification immédiate.
    document.addEventListener("visibilitychange", () => { if (!document.hidden && rdv.timer) surveillerRdv(); });
    window.addEventListener("focus", () => { if (rdv.timer) surveillerRdv(); });
  }

  // ---------------------------------------------------------- fenêtre de réglages
  // Aperçu : la liste des lieux est recalculée à chaque changement de réglage, sans toucher à l'affichage.
  const reg = { communes: [], cpLoaded: null, raw: null, rawKey: null, result: null, timer: null, seq: 0 };

  function regLire() {
    const cp = $("reg-cp").value.trim();
    const r = entierBorne($("reg-rayon").value, BORNES.rayon);
    const j = entierBorne($("reg-jours").value, BORNES.jours);
    $("reg-rayon").setAttribute("aria-invalid", String(r === null));
    $("reg-jours").setAttribute("aria-invalid", String(j === null));
    $("reg-cp").setAttribute("aria-invalid", String(!/^\d{5}$/.test(cp)));
    const erreurs = [];
    if (!/^\d{5}$/.test(cp)) erreurs.push("Code postal : 5 chiffres.");
    if (r === null) erreurs.push("Rayon : un entier de 0 (commune seule) à 50 km.");
    if (j === null) erreurs.push("Nombre de jours : un entier de 1 à 180.");
    $("reg-err").textContent = erreurs.join(" ");
    return erreurs.length ? null : { cp, r, j, don: $("reg-don").value, insee: $("reg-commune").value || null };
  }

  function regCommunes() {
    const sel = $("reg-commune");
    sel.replaceChildren(...reg.communes.map((c) => h("option", { value: c.code }, c.nom)));
    $("reg-commune-field").hidden = reg.communes.length < 2;
  }

  function regLieux(selected) {
    const groupes = new Map();
    for (const c of reg.result ? reg.result.collectes : []) {
      const k = cleLieu(c);
      if (!groupes.has(k)) groupes.set(k, { nom: nomLieu(c), dates: [] });
      groupes.get(k).dates.push(fShort.format(c.debut));
    }
    const opts = [h("option", { value: "auto" }, "Prochaine collecte du secteur (tous les lieux)")];
    for (const [k, g] of groupes) {
      opts.push(h("option", { value: k, "data-nom": g.nom }, `${g.nom} — ${g.dates.slice(0, 3).join(", ")}${g.dates.length > 3 ? "…" : ""}`));
    }
    if (selected !== "auto" && !groupes.has(selected) && state.tabLieuNom) {
      opts.push(h("option", { value: selected, "data-nom": state.tabLieuNom }, `${state.tabLieuNom} — aucune collecte dans la période`));
    }
    $("reg-lieu").replaceChildren(...opts);
    $("reg-lieu").value = [...$("reg-lieu").options].some((o) => o.value === selected) ? selected : "auto";
    $("reg-lieu-aide").textContent = reg.result
      ? `${reg.result.collectes.length} collecte${reg.result.collectes.length > 1 ? "s" : ""} trouvée${reg.result.collectes.length > 1 ? "s" : ""} avec ces réglages.`
      : "";
  }

  /** Recalcule l'aperçu (communes du code postal, puis collectes) pour proposer les lieux. */
  async function regApercu() {
    const v = regLire();
    if (!v) return;
    const seq = ++reg.seq;
    const garde = $("reg-lieu").value || state.tabLieu;
    $("reg-lieu-aide").textContent = "Recherche des lieux…";
    try {
      if (reg.cpLoaded !== v.cp) {
        reg.communes = await searchCommunes(v.cp);
        if (seq !== reg.seq) return;
        reg.cpLoaded = v.cp;
        regCommunes();
        if (!reg.communes.length) { $("reg-cp-err").textContent = "Aucune commune ne correspond à ce code postal."; return; }
        $("reg-cp-err").textContent = "";
      }
      const commune = reg.communes.find((c) => c.code === $("reg-commune").value) || reg.communes[0];
      const rq = v.r === 0 ? C.COMMUNE_SEARCH_RADIUS : v.r;
      const key = `${commune.code}|${rq}`;
      if (reg.rawKey !== key) {
        reg.raw = await fetchJson("efs", C.efsQuery(commune.lat, commune.lon, rq, 100));
        if (seq !== reg.seq) return;
        reg.rawKey = key;
      }
      const res = C.parseCollections(reg.raw, {
        centerLat: commune.lat, centerLon: commune.lon, radiusKm: rq,
        donType: v.don, includePro: false, horizonDays: v.j, now: new Date(),
      });
      reg.result = v.r === 0 ? C.filterCommune(res, commune.nom) : res;
      regLieux(garde);
    } catch (err) {
      if (seq === reg.seq) $("reg-lieu-aide").textContent = `Liste des lieux indisponible : ${err.message}`;
    }
  }

  function openReglages() {
    if ($("reglages").open) return;
    const t = Tab.read();
    $("reg-cp").value = (state.center && state.center.cp) || $("cp").value;
    $("reg-rayon").value = state.radius;
    $("reg-jours").value = state.horizon;
    $("reg-don").value = state.don;
    $("reg-auto").checked = t ? t.auto !== false : true;
    $("reg-cp-err").textContent = "";
    // L'aperçu repart de la recherche affichée.
    reg.communes = state.communes;
    reg.cpLoaded = state.cpLoaded;
    regCommunes();
    if (state.insee) $("reg-commune").value = state.insee;
    reg.raw = state.raw;
    reg.rawKey = state.center && state.insee ? `${state.insee}|${rayonRecherche()}` : null;
    reg.result = state.result;
    regLieux(state.tabLieu);
    regLire();
    $("reglages").showModal();
  }

  async function saveReglages(ev) {
    ev.preventDefault();
    const v = regLire();
    if (!v) return;
    if (reg.cpLoaded !== v.cp) { await regApercu(); if (reg.cpLoaded !== v.cp) return; }
    const commune = reg.communes.find((c) => c.code === $("reg-commune").value) || reg.communes[0];
    if (!commune) return;
    const opt = $("reg-lieu").selectedOptions[0];
    const cfg = {
      v: 1, cp: v.cp, insee: commune.code, nom: commune.nom, lat: +commune.lat.toFixed(5), lon: +commune.lon.toFixed(5),
      r: v.r, j: v.j, don: v.don,
      lieu: opt ? opt.value : "auto", lieuNom: opt && opt.value !== "auto" ? opt.dataset.nom || "" : "",
      auto: $("reg-auto").checked,
    };
    $("reglages").close();
    const ok = Tab.write(cfg);
    enterTablette(cfg);
    if (!ok) {
      mount("tab-pied", h("span", null, "Le navigateur a refusé le cookie (page ouverte depuis un fichier local, ou cookies bloqués) : réglages gardés jusqu’à la fermeture de la page."));
    }
  }

  function forgetReglages() {
    Tab.clear();
    $("reglages").close();
    state.tabCfg = null;
    renderTablette();
  }

  function initTablette() {
    $("tablette-btn").addEventListener("click", () => enterTablette(Tab.read()));
    $("tab-quitter").addEventListener("click", exitTablette);
    $("tab-reglages").addEventListener("click", openReglages);
    initParametres();
    initRdv();
    $("reg-form").addEventListener("submit", saveReglages);
    $("reg-annuler").addEventListener("click", () => $("reglages").close());
    $("reg-oublier").addEventListener("click", forgetReglages);
    $("reg-cp").addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 5);
      if (e.target.value.length === 5) { clearTimeout(reg.timer); reg.timer = setTimeout(regApercu, 300); }
    });
    for (const id of ["reg-commune", "reg-rayon", "reg-jours", "reg-don"]) {
      $(id).addEventListener("change", () => { clearTimeout(reg.timer); reg.timer = setTimeout(regApercu, 300); });
    }
  }

  // ------------------------------------------------- paramètres (sous-vue de la page)
  // Le formulaire de recherche n'est affiché que sur demande (« ⚙ Réglages ») : la page
  // présente d'abord les trois vues. Il se referme après une recherche réussie.
  function afficherParametres(ouvrir, { focus = true } = {}) {
    const p = $("parametres");
    p.hidden = !ouvrir;
    $("top-reglages").setAttribute("aria-expanded", String(ouvrir));
    if (ouvrir && focus) {
      p.scrollIntoView({ block: "start", behavior: "smooth" });
      $("cp").focus({ preventScroll: true });
    }
  }

  /** Recherche lancée depuis le panneau : refermé si elle aboutit, ouvert sinon. */
  async function rechercherDepuisPanneau(action) {
    const ok = await action();
    const erreurSaisie = $("cp-err").textContent || $("horizon-err").textContent;
    if (ok !== false && !erreurSaisie && !state.error && state.result) {
      afficherParametres(false);
      $("top-reglages").focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function initParametres() {
    $("top-reglages").addEventListener("click", () => afficherParametres($("parametres").hidden));
    $("param-fermer").addEventListener("click", () => { afficherParametres(false); $("top-reglages").focus(); });
    $("parametres").addEventListener("keydown", (e) => {
      if (e.key === "Escape") { afficherParametres(false); $("top-reglages").focus(); }
    });
  }

  // ---------------------------------------------------------------- actions
  function startDemo() {
    state.demo = true;
    state.cpLoaded = null;
    state.insee = null;
    $("cp").value = window.EFS_DEMO.postalCode;
    $("notice").replaceChildren(h("div", { class: "notice" },
      h("p", null, "Mode démonstration : réponses enregistrées pour le code postal 14760, dates recalées sur aujourd’hui. Lancez une recherche avec un autre code postal pour revenir aux données réelles.")));
    state.error = null;
    return onSubmit();
  }

  /** Résout à vrai quand la position a servi à une recherche, à faux sinon (panneau laissé ouvert). */
  function useGeolocation() {
    if (!window.isSecureContext || !navigator.geolocation) {
      $("notice").replaceChildren(h("div", { class: "notice" },
        h("p", null, "La géolocalisation du navigateur exige une page servie en HTTPS (ou depuis localhost). Saisissez un code postal à la place.")));
      return Promise.resolve(false);
    }
    setBusy(true);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        readForm();
        state.demo = false;
        state.center = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Ma position", cp: null };
        await loadCollectes();
        setBusy(false);
        resolve(true);
      }, (err) => {
        setBusy(false);
        $("notice").replaceChildren(h("div", { class: "notice" }, h("p", null, `Position indisponible : ${err.message}`)));
        resolve(false);
      }, { timeout: 15000, maximumAge: 600000 });
    });
  }

  function init() {
    const p = new URLSearchParams(location.search);
    state.base = Base.read();
    const viaUrl = p.has("cp") || p.has("lat") || p.get("demo") === "1";
    const b = !viaUrl ? state.base : null;
    $("cp").value = p.get("cp") || (b && b.t === "cp" ? b.cp : "14760");
    const rUrl = entierBorne(p.get("r"), BORNES.rayon);
    $("rayon").value = rUrl === null ? 10 : rUrl;
    if (["sang", "plasma", "plaquettes"].includes(p.get("don"))) $("don").value = p.get("don");
    const jUrl = entierBorne(p.get("h"), BORNES.jours);
    $("horizon").value = jUrl === null ? JOURS_DEFAUT : jUrl;
    $("pro").checked = p.get("pro") === "1";
    $("rdv").checked = p.get("rdv") === "1";
    state.communeVue = p.get("vc") ? cle(p.get("vc")) : "auto";
    state.insee = p.get("insee") || (b && b.t === "cp" ? b.insee : null);
    const rayonTexte = () => { $("rayon-out").textContent = +$("rayon").value === 0 ? "commune" : `${$("rayon").value} km`; };
    rayonTexte();

    $("search").addEventListener("submit", (ev) => { ev.preventDefault(); rechercherDepuisPanneau(() => onSubmit(ev)); });
    $("rayon").addEventListener("input", rayonTexte);
    // Le rayon change le rectangle interrogé : nouvel appel. Les autres réglages filtrent la réponse déjà reçue.
    $("rayon").addEventListener("change", () => { readForm(); if (state.center && !state.busy) loadCollectes(); });
    for (const id of ["don", "horizon", "pro", "rdv"]) {
      $(id).addEventListener("change", () => { if (readForm()) { reparse(); syncUrl(); } });
    }
    initTablette();
    $("commune").addEventListener("change", (e) => {
      state.insee = e.target.value; selectCommune(); readForm(); loadCollectes();
    });
    $("cp").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 5); });
    $("demo").addEventListener("click", () => rechercherDepuisPanneau(startDemo));
    $("vue-commune").addEventListener("change", (e) => { state.communeVue = e.target.value; if (state.result) renderV1(); syncUrl(); });
    $("geoloc").addEventListener("click", () => rechercherDepuisPanneau(useGeolocation));

    const lat = parseFloat(p.get("lat")), lon = parseFloat(p.get("lon"));
    renderBase();
    // Mode tablette : demandé dans l'adresse, ou enregistré sur cet appareil (cookie) sans autre paramètre.
    const tab = Tab.read();
    if (p.get("mode") === "tablette" || (!viaUrl && tab && tab.auto)) { enterTablette(tab); return; }
    if (p.get("demo") === "1") startDemo();
    else if (b && b.t === "geo") {
      readForm();
      state.center = { lat: b.lat, lon: b.lon, label: "Ma position", cp: null };
      loadCollectes();
    }
    else if (Number.isFinite(lat) && Number.isFinite(lon)) {
      readForm();
      state.center = { lat, lon, label: "Ma position", cp: null };
      loadCollectes();
    } else onSubmit();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
