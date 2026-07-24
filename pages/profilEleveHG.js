// =======================================================
// PAGE PROFIL ÉLÈVE — AGORAMOSAÏQUE
// Agrège tout ce qui est enregistré sur un élève (année active)
// =======================================================

const TRIMESTRES = ["T1", "T2", "T3"];

const COMP_LABELS = {
  lecture_document:            "Lecture document",
  lecture_consignes:           "Lecture consignes",
  redaction_de_texte:          "Rédaction de texte",
  presentation_de_document:    "Présentation de document",
  lecture_image:               "Lecture image",
  analyse_competence:          "Analyse",
  culture_generale:            "Culture générale",
  apprentissage_connaissances: "Apprentissage connaissances",
  langage_cartographique:      "Langage cartographique",
  usages_numeriques:           "Usages numériques",
};

const PART_SCORES = { Perturbateur: 0, Passif: 1, "Impliqué": 2, Moteur: 3 };

/* -------------------------------------------------------
   ÉTAT
------------------------------------------------------- */

let anneeActiveId = null;
let tousEleves    = [];      // [{ id, prenom, nom, classe_nom, classe_id, ... }]
let recherche     = "";
let classeFiltre  = "";
let eleveActif    = null;
let profil        = null;    // données agrégées

/* -------------------------------------------------------
   SUPABASE
------------------------------------------------------- */

function sbAgoram() {
  if (!window.sb) throw new Error("Supabase non initialisé.");
  return window.sb.schema("agoram");
}

async function getActiveAnneeId() {
  if (anneeActiveId) return anneeActiveId;
  const { data, error } = await sbAgoram()
    .from("annees").select("id").eq("active", true).maybeSingle();
  if (error) throw new Error(`Lecture annees impossible. ${error.message}`);
  anneeActiveId = data?.id || null;
  return anneeActiveId;
}

async function chargerTousEleves() {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return [];

  const { data: classes, error: errC } = await sbAgoram()
    .from("classes").select("id, nom, is_pp").eq("annee_id", anneeId).order("nom");
  if (errC) throw new Error(`Lecture classes impossible. ${errC.message}`);

  const ids = (classes || []).map(c => c.id);
  if (!ids.length) return [];

  const { data: eleves, error: errE } = await sbAgoram()
    .from("eleves")
    .select("id, prenom, nom, genre, groupe, adaptations, place, classe_id")
    .in("classe_id", ids)
    .order("nom");
  if (errE) throw new Error(`Lecture élèves impossible. ${errE.message}`);

  const mapClasse = new Map((classes || []).map(c => [c.id, c]));

  return (eleves || []).map(e => ({
    ...e,
    adaptations: Array.isArray(e.adaptations) ? e.adaptations : [],
    classe_nom: mapClasse.get(e.classe_id)?.nom || "—",
    classe_pp:  !!mapClasse.get(e.classe_id)?.is_pp,
  }));
}

/* -------------------------------------------------------
   AGRÉGATION DU PROFIL
------------------------------------------------------- */

async function chargerProfil(eleve) {
  const anneeId = await getActiveAnneeId();
  const sb = sbAgoram();

  // Compétences des 3 trimestres
  const { data: comps } = await sb
    .from("competences_hg").select("*")
    .eq("eleve_id", eleve.id).eq("annee_id", anneeId);

  const competences = {};
  (comps || []).forEach(r => { competences[r.periode] = r; });

  // Séances de la classe (pour rattacher events et participations)
  const { data: seances } = await sb
    .from("seances").select("id, date_seance, code_cours")
    .eq("classe_id", eleve.classe_id).eq("annee_id", anneeId);

  const seanceIds = (seances || []).map(s => s.id);

  // Assiduité et comportement
  let events = { absences: 0, retards: 0, devoirs: 0, oublis: 0, absentControle: 0, textes: [] };
  if (seanceIds.length) {
    const { data: evs } = await sb
      .from("eleves_events").select("type, valeur, code")
      .eq("eleve_id", eleve.id).in("seance_id", seanceIds);

    (evs || []).forEach(ev => {
      if (ev.type === "absence"         && ev.valeur === "true") events.absences++;
      if (ev.type === "retard"          && ev.valeur === "true") events.retards++;
      if (ev.type === "devoir"          && ev.valeur === "true") events.devoirs++;
      if (ev.type === "oubli_materiel"  && ev.valeur === "true") events.oublis++;
      if (ev.type === "absent_controle" && ev.valeur === "true") events.absentControle++;
      if (ev.type === "comportement"    && ev.valeur?.trim()) events.textes.push(ev.valeur);
    });
  }

  // Participation
  let participation = { moyenne: null, nb: 0, detail: {} };
  if (seanceIds.length) {
    const { data: parts } = await sb
      .from("participations_hg").select("valeur")
      .eq("eleve_id", eleve.id).in("seance_id", seanceIds);

    if (parts?.length) {
      const scores = parts.map(p => PART_SCORES[p.valeur] ?? 1);
      participation.moyenne = scores.reduce((a, b) => a + b, 0) / scores.length;
      participation.nb = parts.length;
      parts.forEach(p => {
        participation.detail[p.valeur] = (participation.detail[p.valeur] || 0) + 1;
      });
    }
  }

  // Bulletins
  const { data: bulls } = await sb
    .from("bulletins_hg").select("periode, texte, statut, updated_at")
    .eq("eleve_id", eleve.id).eq("annee_id", anneeId);

  const bulletins = {};
  (bulls || []).forEach(b => { bulletins[b.periode] = b; });

  // Suivi PP
  let pp = null;
  if (eleve.classe_pp) {
    const { data: suivi } = await sb
      .from("pp_suivi").select("*")
      .eq("eleve_id", eleve.id).eq("annee_id", anneeId).maybeSingle();

    const { data: tris } = await sb
      .from("pp_suivi_trimestre").select("*")
      .eq("eleve_id", eleve.id).eq("annee_id", anneeId);

    const { data: reuns } = await sb
      .from("pp_reunions").select("reunion, present")
      .eq("eleve_id", eleve.id).eq("annee_id", anneeId);

    const parTri = {};
    (tris || []).forEach(t => { parTri[t.trimestre] = t; });

    const parReunion = {};
    (reuns || []).forEach(r => { parReunion[r.reunion] = r.present; });

    pp = { suivi: suivi || {}, trimestres: parTri, reunions: parReunion };
  }

  return { competences, events, participation, bulletins, pp, nbSeances: seanceIds.length };
}

/* -------------------------------------------------------
   RENDU
------------------------------------------------------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[m]));
}

function elevesFiltres() {
  const q = recherche.trim().toLowerCase();
  return tousEleves.filter(e => {
    if (classeFiltre && e.classe_nom !== classeFiltre) return false;
    if (!q) return true;
    const cible = `${e.nom} ${e.prenom} ${e.classe_nom}`.toLowerCase();
    return cible.includes(q);
  });
}

function listeClasses() {
  return Array.from(new Set(tousEleves.map(e => e.classe_nom))).sort();
}

export async function renderProfilEleve() {
  if (!tousEleves.length) {
    try {
      tousEleves = await chargerTousEleves();
    } catch (e) {
      console.error(e);
      return `<div class="page"><h1>Profil élève</h1><p>Erreur de chargement.</p></div>`;
    }
  }

  if (!tousEleves.length) {
    return `<div class="page"><h1>Profil élève</h1><p>Aucun élève. Importe d'abord des données.</p></div>`;
  }

  const filtres = elevesFiltres();

  return `
    <div class="page page-profil">

      <div class="profil-topbar">
        <h1>Profil élève</h1>
        <input type="text" id="profilRecherche" placeholder="Rechercher un nom…"
               value="${escapeHtml(recherche)}" autocomplete="off">
        <select id="profilClasse">
          <option value="">Toutes les classes</option>
          ${listeClasses().map(c => `
            <option value="${escapeHtml(c)}" ${c === classeFiltre ? "selected" : ""}>${escapeHtml(c)}</option>
          `).join("")}
        </select>
      </div>

      <div class="profil-body">

        <div class="profil-liste" id="profilListe">
          ${renderListe(filtres)}
        </div>

        <div class="profil-detail" id="profilDetail">
          ${eleveActif ? renderDetail() : "<p class='profil-vide'>Sélectionne un élève.</p>"}
        </div>

      </div>
    </div>
  `;
}

function renderListe(filtres) {
  if (!filtres.length) return "<p>Aucun résultat.</p>";

  return filtres.map(e => `
    <div class="profil-row ${eleveActif?.id === e.id ? "active" : ""}"
         data-eleveid="${e.id}" role="button" tabindex="0">
      <span class="profil-nom">${escapeHtml(e.nom)} ${escapeHtml(e.prenom)}</span>
      <span class="profil-classe">${escapeHtml(e.classe_nom)}</span>
    </div>
  `).join("");
}

function renderDetail() {
  const e = eleveActif;

  if (!profil) {
    return `<div class="profil-inner"><h2>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</h2><p>⏳ Chargement…</p></div>`;
  }

  const val = v => v ? escapeHtml(v) : "—";

  return `
    <div class="profil-inner">

      <h2>${escapeHtml(e.prenom)} ${escapeHtml(e.nom)}</h2>

      <div class="profil-section">
        <h3>Identité</h3>
        <div class="profil-grid">
          <div><b>Classe</b> ${escapeHtml(e.classe_nom)}</div>
          <div><b>Groupe</b> ${val(e.groupe)}</div>
          <div><b>Genre</b> ${val(e.genre)}</div>
          <div><b>Place</b> ${e.place ?? "—"}</div>
          <div><b>Adaptations</b> ${e.adaptations.length ? escapeHtml(e.adaptations.join(", ")) : "Aucune"}</div>
        </div>
      </div>

      ${renderCompetences()}
      ${renderVieScolaire()}
      ${renderParticipation()}
      ${renderBulletins()}
      ${profil.pp ? renderPP() : ""}

    </div>
  `;
}

function renderCompetences() {
  const c = profil.competences;
  const presents = TRIMESTRES.filter(t => c[t]);

  if (!presents.length) {
    return `<div class="profil-section"><h3>Compétences HG</h3><p>Aucune évaluation saisie.</p></div>`;
  }

  const lignes = Object.entries(COMP_LABELS).map(([col, label]) => `
    <tr>
      <td>${label}</td>
      ${TRIMESTRES.map(t => `<td class="profil-ifst">${c[t]?.[col] || "—"}</td>`).join("")}
    </tr>
  `).join("");

  return `
    <div class="profil-section">
      <h3>Compétences HG</h3>
      <table class="profil-table">
        <thead><tr><th>Compétence</th>${TRIMESTRES.map(t => `<th>${t}</th>`).join("")}</tr></thead>
        <tbody>
          ${lignes}
          <tr class="profil-sep">
            <td>Investissement</td>
            ${TRIMESTRES.map(t => `<td>${c[t]?.investissement_maison || "—"}</td>`).join("")}
          </tr>
          <tr>
            <td>Posture en classe</td>
            ${TRIMESTRES.map(t => `<td>${c[t]?.posture_classe || "—"}</td>`).join("")}
          </tr>
          <tr>
            <td>Études personnelles</td>
            ${TRIMESTRES.map(t =>
