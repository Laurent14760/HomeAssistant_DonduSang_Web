// Tests de la logique métier (node --test) sur la réponse enregistrée 14760 / 10 km.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const core = require("../site/js/efs-core.js");
const payload = require(path.join(__dirname, "fixtures", "searchnearpoint_14760.json"));

const NOW = core.parisDate({ y: 2026, mo: 10, d: 14 }, { h: 14, m: 0 });
const base = { centerLat: 49.1665, centerLon: -0.4185, radiusKm: 10, donType: "sang",
  includePro: false, horizonDays: 90, now: NOW };
const parse = (o = {}) => core.parseCollections(payload, { ...base, ...o });
const city = (r, c, d) => r.collectes.filter((x) => x.commune === c && (!d || x.jourIso === d));

test("géométrie", () => {
  const [dLat, dLon] = core.radiusToDiameters(10, 49.166);
  assert.ok(Math.abs(dLat - 0.18018) < 1e-4 && Math.abs(dLon - 0.2755) < 1e-3);
  assert.ok(Math.abs(core.haversineKm(49.1665, -0.4185, 49.183, -0.37) - 3.95) < 0.2);
  assert.equal(core.postcodeIsCoherent("06560", 49.17, -0.41), false);
  assert.equal(core.postcodeIsCoherent("14760", 49.1665, -0.4185), true);
});

test("recette : communes attendues, triées, sans aberration", () => {
  const r = parse();
  assert.deepEqual(r.collectes.map((c) => [c.jourIso, c.commune]), [
    ["2026-10-21", "Caen"], ["2026-10-28", "Fontaine-Étoupefour"],
    ["2026-11-05", "Bretteville-l'Orgueilleuse"], ["2026-11-16", "Bretteville-sur-Odon"],
    ["2026-12-14", "Bretteville-sur-Odon"], ["2026-12-24", "Soliers"]]);
  assert.ok(r.collectes.every((c) => c.distance <= 10));
  const motifs = Object.fromEntries(r.rejets.map((x) => [x.lieu, x.motif]));
  assert.match(motifs["Salle municipale"], /hors rayon/);
  assert.match(motifs["Sophia Antipolis – Site Amadeus"], /incohérent/);
});

test("horizon 60 j, collectes pro, doublons", () => {
  const jours = parse({ horizonDays: 60 }).collectes.map((c) => c.jourIso);
  assert.ok(jours.includes("2026-11-16") && !jours.includes("2026-12-14"));
  assert.equal(parse({ includePro: true }).collectes.filter((c) => c.lieu === "Lycée Jean Rostand").length, 1);
  assert.equal(city(parse(), "Caen", "2026-10-21").length, 1);
});

test("créneaux et fuseau Europe/Paris", () => {
  const [f] = city(parse(), "Fontaine-Étoupefour");
  assert.equal(f.creneaux.length, 2);
  assert.equal(f.horaires, "08h30 – 12h00 · 15h00 – 19h00");
  assert.equal(f.debut.toISOString(), "2026-10-28T07:30:00.000Z"); // UTC+1 (heure d'hiver)
  const [b] = city(parse(), "Bretteville-sur-Odon", "2026-11-16");
  assert.deepEqual(b.creneaux.map((s) => s.libelle), ["Après-midi"]);
  const [o] = city(parse(), "Bretteville-l'Orgueilleuse");
  assert.equal(o.horaires, "16h00 – 19h30");
});

test("places : ouvert, non ouvert, complet, bascule de type de don", () => {
  const [f] = city(parse(), "Fontaine-Étoupefour");
  assert.deepEqual([f.placesTotales, f.placesRestantes, f.placesReservees, f.taux], [54, 39, 15, 27.8]);
  assert.equal(f.textePlaces, "39 places restantes sur 54");
  const [s] = city(parse(), "Soliers");
  assert.equal(s.placesRestantes, null);
  assert.equal(s.statut, core.STATUT.NON_OUVERT);
  const [c] = city(parse(), "Caen");
  assert.equal(c.statut, core.STATUT.COMPLET);
  const [p] = city(parse({ donType: "plasma" }), "Fontaine-Étoupefour");
  assert.deepEqual([p.placesTotales, p.placesRestantes], [12, 5]);
  assert.match(p.lienRdv, /plasma$/);
});

test("prochaine collecte et Maisons du don", () => {
  const r = parse();
  assert.equal(core.nextCollecte(r.collectes, NOW).commune, "Caen");
  const after = core.parisDate({ y: 2026, mo: 10, d: 21 }, { h: 13, m: 5 });
  assert.equal(core.nextCollecte(r.collectes, after).commune, "Fontaine-Étoupefour");
  assert.deepEqual(r.maisons.map((m) => m.nom), ["Maison du don de Caen"]);
});

test("réponses vides ou invalides", () => {
  for (const p of [null, {}, [], { samplingLocationCollections: null }]) {
    assert.deepEqual(core.parseCollections(p, base).collectes, []);
  }
});

test("liens de rendez-vous sans schéma", () => {
  assert.equal(core.normalizeUrl("efs.link/fGWaH"), "https://efs.link/fGWaH");
  assert.equal(core.normalizeUrl("https://efs.link/x"), "https://efs.link/x");
  assert.equal(core.normalizeUrl("javascript:alert(1)"), null);
  assert.equal(core.normalizeUrl(""), null);
});

test("rayon 0 : uniquement la commune de départ", () => {
  const r = parse({ radiusKm: core.COMMUNE_SEARCH_RADIUS });
  const seule = core.filterCommune(r, "Bretteville-sur-Odon");
  assert.ok(seule.collectes.length > 0 && seule.collectes.length < r.collectes.length);
  assert.ok(seule.collectes.every((c) => c.commune === "Bretteville-sur-Odon"));
  assert.ok(core.memeCommune("BRETTEVILLE SUR ODON", "Bretteville-sur-Odon"));
  assert.ok(core.memeCommune("14000 Caen", "Caen"));
  assert.equal(core.memeCommune("Bretteville-l'Orgueilleuse", "Bretteville-sur-Odon"), false);
  assert.equal(core.memeCommune(null, "Caen"), false);
});
