/*
 * Logique métier EFS (sans dépendance, sans DOM) : géométrie, parsing, filtrage.
 * Portage fidèle du module parser.py de l'intégration Home Assistant.
 * Utilisable dans le navigateur (window.EfsCore) et sous Node (tests).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EfsCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TZ = "Europe/Paris";
  const EARTH_RADIUS_KM = 6371;
  const KM_PER_DEGREE = 111;
  const MAX_DEPT_DISTANCE_KM = 200;

  const DON_FIELDS = {
    sang: { suffix: "ST", url: "urlBlood", label: "Sang total" },
    plasma: { suffix: "PLA", url: "urlPlasma", label: "Plasma" },
    plaquettes: { suffix: "CPA", url: "urlPlatelet", label: "Plaquettes" },
  };

  const PRO_KEYWORDS = ["profession", "entreprise", "lycee", "college", "ecole", "universit",
    "scolaire", "administration", "militaire", "caserne"];

  const STATUT = { OUVERT: "Planning ouvert", NON_OUVERT: "Planning non ouvert", COMPLET: "Complet" };

  // Préfectures (approximation du centre de chaque département ; Corse sous "20").
  const DEPT_CENTERS = {
    "01": [46.21, 5.23], "02": [49.56, 3.62], "03": [46.57, 3.33], "04": [44.09, 6.24], "05": [44.56, 6.08],
    "06": [43.70, 7.27], "07": [44.74, 4.60], "08": [49.77, 4.72], "09": [42.97, 1.61], "10": [48.30, 4.08],
    "11": [43.21, 2.35], "12": [44.35, 2.57], "13": [43.30, 5.37], "14": [49.18, -0.37], "15": [44.93, 2.44],
    "16": [45.65, 0.16], "17": [46.16, -1.15], "18": [47.08, 2.40], "19": [45.27, 1.77], "20": [42.15, 9.10],
    "21": [47.32, 5.04], "22": [48.51, -2.76], "23": [46.17, 1.87], "24": [45.18, 0.72], "25": [47.24, 6.02],
    "26": [44.93, 4.89], "27": [49.03, 1.15], "28": [48.44, 1.49], "29": [48.00, -4.10], "30": [43.84, 4.36],
    "31": [43.60, 1.44], "32": [43.65, 0.59], "33": [44.84, -0.58], "34": [43.61, 3.88], "35": [48.11, -1.68],
    "36": [46.81, 1.69], "37": [47.39, 0.69], "38": [45.19, 5.72], "39": [46.67, 5.55], "40": [43.89, -0.50],
    "41": [47.59, 1.33], "42": [45.44, 4.39], "43": [45.04, 3.88], "44": [47.22, -1.55], "45": [47.90, 1.90],
    "46": [44.45, 1.44], "47": [44.20, 0.62], "48": [44.52, 3.50], "49": [47.47, -0.55], "50": [49.12, -1.09],
    "51": [48.96, 4.36], "52": [48.11, 5.14], "53": [48.07, -0.77], "54": [48.69, 6.18], "55": [48.77, 5.16],
    "56": [47.66, -2.76], "57": [49.12, 6.18], "58": [46.99, 3.16], "59": [50.63, 3.06], "60": [49.43, 2.08],
    "61": [48.43, 0.09], "62": [50.29, 2.78], "63": [45.78, 3.08], "64": [43.30, -0.37], "65": [43.23, 0.08],
    "66": [42.70, 2.90], "67": [48.57, 7.75], "68": [48.08, 7.36], "69": [45.76, 4.84], "70": [47.62, 6.15],
    "71": [46.31, 4.83], "72": [48.00, 0.20], "73": [45.57, 5.92], "74": [45.90, 6.13], "75": [48.86, 2.35],
    "76": [49.44, 1.10], "77": [48.54, 2.66], "78": [48.80, 2.13], "79": [46.32, -0.46], "80": [49.89, 2.30],
    "81": [43.93, 2.15], "82": [44.02, 1.35], "83": [43.12, 5.93], "84": [43.95, 4.81], "85": [46.67, -1.43],
    "86": [46.58, 0.34], "87": [45.83, 1.26], "88": [48.17, 6.45], "89": [47.80, 3.57], "90": [47.64, 6.86],
    "91": [48.63, 2.44], "92": [48.89, 2.21], "93": [48.91, 2.44], "94": [48.79, 2.46], "95": [49.04, 2.08],
  };

  // ------------------------------------------------------------------ géométrie
  function radiusToDiameters(radiusKm, latitude) {
    const dLat = (2 * radiusKm) / KM_PER_DEGREE;
    const cos = Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
    const dLon = (2 * radiusKm) / (KM_PER_DEGREE * cos);
    return [round(dLat, 5), round(dLon, 5)];
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const dphi = (lat2 - lat1) * r;
    const dl = (lon2 - lon1) * r;
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
  }

  function postcodeIsCoherent(postCode, lat, lon) {
    if (!postCode) return true;
    let code = String(postCode).trim();
    if (code.length === 4) code = "0" + code;
    const center = DEPT_CENTERS[code.slice(0, 2)];
    if (!center) return true; // outre-mer ou inconnu : non contrôlé
    return haversineKm(lat, lon, center[0], center[1]) <= MAX_DEPT_DISTANCE_KM;
  }

  // --------------------------------------------------------------- conversions
  function round(v, n) {
    const f = 10 ** n;
    return Math.round(v * f) / f;
  }

  function parseTime(value) {
    if (value === null || value === undefined || value === "") return null;
    let text = String(value);
    if (text.includes("T")) text = text.split("T")[1];
    const m = text.match(/(\d{1,2})[:hH](\d{2})/);
    if (!m) return null;
    const h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return { h, m: mi };
  }

  function parseDate(value) {
    if (!value) return null;
    const text = String(value);
    let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
    m = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return { y: +m[3], mo: +m[2], d: +m[1] };
    return null;
  }

  function toInt(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  function toFloat(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function normalize(text) {
    return text ? String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase() : "";
  }

  // L'API renvoie des liens courts sans schéma (« efs.link/abc ») : on ajoute https://.
  function normalizeUrl(value) {
    if (!value || typeof value !== "string") return null;
    const url = value.trim();
    if (!url) return null;
    if (url.startsWith("//")) return "https:" + url;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return /^https?:\/\//i.test(url) ? url : null;
    return "https://" + url;
  }

  function isProfessional(nature) {
    const n = normalize(nature);
    return PRO_KEYWORDS.some((k) => n.includes(k));
  }

  // Décalage (ms) du fuseau Europe/Paris à un instant donné.
  const _fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  function tzOffset(ms) {
    const p = Object.fromEntries(_fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }
  /** Date absolue correspondant à une heure murale à Paris. */
  function parisDate(d, t) {
    const guess = Date.UTC(d.y, d.mo - 1, d.d, t.h, t.m);
    let ms = guess - tzOffset(guess);
    ms = guess - tzOffset(ms); // second passage : changements d'heure
    return new Date(ms);
  }
  function isoDay(d) {
    return `${d.y}-${String(d.mo).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  function parisToday(now) {
    const p = Object.fromEntries(_fmt.formatToParts(now).map((x) => [x.type, x.value]));
    return { y: +p.year, mo: +p.month, d: +p.day };
  }
  function addDays(d, n) {
    const x = new Date(Date.UTC(d.y, d.mo - 1, d.d + n));
    return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate() };
  }

  function buildSlot(label, day, startRaw, endRaw) {
    const s = parseTime(startRaw);
    if (!s) return null;
    const e = parseTime(endRaw);
    const debut = parisDate(day, s);
    let fin = e ? parisDate(day, e) : new Date(debut.getTime() + 3 * 3600e3);
    if (fin <= debut) fin = new Date(debut.getTime() + 3 * 3600e3);
    return { libelle: label, debut, fin, hDebut: s, hFin: e || null };
  }

  const fmtH = (t) => `${String(t.h).padStart(2, "0")}h${String(t.m).padStart(2, "0")}`;

  function decorate(c) {
    c.debut = c.creneaux[0].debut;
    c.fin = c.creneaux[c.creneaux.length - 1].fin;
    c.statut = c.placesRestantes === null ? STATUT.NON_OUVERT
      : c.placesRestantes <= 0 ? STATUT.COMPLET : STATUT.OUVERT;
    if (c.placesTotales && c.placesRestantes !== null) {
      c.taux = round((100 * (c.placesTotales - c.placesRestantes)) / c.placesTotales, 1);
    } else if (c.tauxEfs !== null && c.placesTotales !== null) {
      c.taux = round(c.tauxEfs > 0 && c.tauxEfs <= 1 ? c.tauxEfs * 100 : c.tauxEfs, 1);
    } else {
      c.taux = null;
    }
    c.horaires = c.creneaux
      .map((s) => `${fmtH(s.hDebut)} – ${s.hFin ? fmtH(s.hFin) : "?"}`)
      .join(" · ");
    c.textePlaces = c.placesRestantes === null ? STATUT.NON_OUVERT
      : c.placesTotales ? `${c.placesRestantes} places restantes sur ${c.placesTotales}`
      : `${c.placesRestantes} places restantes`;
    return c;
  }

  function checkLocation(loc, cLat, cLon, radiusKm) {
    const lat = toFloat(loc.latitude), lon = toFloat(loc.longitude);
    if (lat === null || lon === null) return { motif: "coordonnées absentes" };
    const d = haversineKm(cLat, cLon, lat, lon);
    if (d > radiusKm) return { motif: `hors rayon (${d.toFixed(1)} km)` };
    if (!postcodeIsCoherent(loc.postCode, lat, lon)) {
      return { motif: `code postal ${loc.postCode} incohérent avec la position` };
    }
    return { distance: round(d, 1), lat, lon };
  }

  /**
   * Transforme la réponse brute de l'API Carto v3 en collectes filtrées et triées.
   * options : { centerLat, centerLon, radiusKm, donType, includePro, horizonDays, now }
   */
  function parseCollections(payload, o) {
    const result = { collectes: [], maisons: [], rejets: [], lieuxBruts: 0 };
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return result;
    const don = DON_FIELDS[o.donType] || DON_FIELDS.sang;
    const now = o.now || new Date();
    const limite = isoDay(addDays(parisToday(now), o.horizonDays));
    const vus = new Set();
    const lieux = payload.samplingLocationCollections || [];
    result.lieuxBruts = lieux.length;

    for (const loc of lieux) {
      const name = String(loc.name || loc.city || "Lieu inconnu").trim();
      const cols = loc.collections || [];
      if (!cols.length) continue;
      const chk = checkLocation(loc, o.centerLat, o.centerLon, o.radiusKm);
      if (chk.motif) {
        result.rejets.push({ lieu: name, codePostal: loc.postCode || null, motif: chk.motif });
        continue;
      }
      for (const col of cols) {
        const day = parseDate(col.date);
        if (!day || isoDay(day) > limite) continue;
        const nature = col.nature || loc.nature || null;
        if (!o.includePro && isProfessional(nature)) continue;
        const creneaux = [
          buildSlot("Matin", day, col.morningStartTime, col.morningEndTime),
          buildSlot("Après-midi", day, col.afternoonStartTime, col.afternoonEndTime),
        ].filter(Boolean);
        if (!creneaux.length || creneaux[creneaux.length - 1].fin <= now) continue;
        const key = normalize(name) + "|" + isoDay(day);
        if (vus.has(key)) continue;
        vus.add(key);
        result.collectes.push(decorate({
          lieu: name,
          adresse: loc.fullAddress || null,
          commune: loc.city || null,
          codePostal: loc.postCode || null,
          latitude: chk.lat,
          longitude: chk.lon,
          distance: chk.distance,
          jour: day,
          jourIso: isoDay(day),
          creneaux,
          nature,
          libelleCourt: col.convocationLabelSMS || null,
          placesTotales: toInt(col["nbPlacesTotales" + don.suffix]),
          placesRestantes: toInt(col["nbPlacesRestantes" + don.suffix]),
          placesReservees: toInt(col["nbPlacesReservees" + don.suffix]),
          tauxEfs: toFloat(col.tauxRemplissage),
          lienRdv: normalizeUrl(col[don.url]),
        }));
      }
    }
    result.collectes.sort((a, b) => a.debut - b.debut || a.distance - b.distance);

    for (const ent of payload.samplingLocationEntities_SF || []) {
      const chk = checkLocation(ent, o.centerLat, o.centerLon, o.radiusKm);
      if (chk.motif) continue;
      result.maisons.push({
        nom: String(ent.name || "Maison du don").trim(),
        adresse: ent.fullAddress || null,
        commune: ent.city || null,
        latitude: chk.lat, longitude: chk.lon, distance: chk.distance,
      });
    }
    result.maisons.sort((a, b) => a.distance - b.distance);
    return result;
  }

  // Rayon 0 = « uniquement la commune de départ » (même règle que l'intégration 1.4.1) :
  // l'API est interrogée dans ce rayon, puis seules les collectes de la commune sont gardées.
  // Un rayon géométrique nul ne trouverait rien : les lieux ne sont jamais au centre exact.
  const COMMUNE_SEARCH_RADIUS = 10;

  /** Clé de comparaison d'un nom de commune (casse, accents, ponctuation ignorés). */
  function cleNom(text) {
    return normalize(text).replace(/[^a-z0-9]+/g, " ").trim();
  }

  /** « BRETTEVILLE SUR ODON » = « Bretteville-sur-Odon » ; « 14000 Caen » = « Caen ». */
  function memeCommune(nomLieu, nomCommune) {
    const lieu = cleNom(nomLieu), cible = cleNom(nomCommune);
    if (!lieu || !cible) return false;
    if (lieu === cible) return true;
    const mots = lieu.split(" ");
    return /^\d+$/.test(mots[0]) && mots.slice(1).join(" ") === cible;
  }

  /** Ne garde que les collectes (et maisons du don) de la commune de départ. */
  function filterCommune(result, nomCommune) {
    return {
      ...result,
      collectes: result.collectes.filter((c) => memeCommune(c.commune, nomCommune)),
      maisons: result.maisons.filter((m) => memeCommune(m.commune, nomCommune)),
    };
  }

  function nextCollecte(collectes, now) {
    return collectes.find((c) => c.fin > now) || null;
  }

  function efsQuery(lat, lon, radiusKm, limit) {
    const [dLat, dLon] = radiusToDiameters(radiusKm, lat);
    return new URLSearchParams({
      CenterLatitude: round(lat, 6), CenterLongitude: round(lon, 6),
      DiameterLatitude: dLat, DiameterLongitude: dLon,
      UserLatitude: round(lat, 6), UserLongitude: round(lon, 6),
      Limit: limit || 100,
    }).toString();
  }

  return {
    TZ, DON_FIELDS, STATUT, radiusToDiameters, haversineKm, postcodeIsCoherent,
    parseTime, parseDate, isProfessional, normalizeUrl, parisDate, parseCollections, nextCollecte, efsQuery,
    COMMUNE_SEARCH_RADIUS, cleNom, memeCommune, filterCommune,
  };
});
