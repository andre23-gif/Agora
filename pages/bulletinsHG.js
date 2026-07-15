// =======================================================
// PAGE BULLETINS HG — AGORAMOSAÏQUE
// Flux : Classe/Trimestre → Liste → Paramètres → Génération → Relecture → Export
// Sources : Supabase (élèves, compétences, participations) + phrasesBulletinsHG.js (local)
// =======================================================

import { ADAPTATIONS, NIVEAU_GLOBAL, BILAN, CONSEILS } from "./phrasesBulletins.js";

/* -------------------------------------------------------
   ÉTAT LOCAL
------------------------------------------------------- */

let classeActive    = null;   // nom affiché
let classeActiveId  = null;   // uuid Supabase
let periodeActive   = "T1";
let anneeActiveId   = null;

let classesMeta     = [];     // [{ id, nom }]
let elevesClasse    = [];     // [{ id, prenom, nom, genre, adaptations }]

let parametres      = {};     // eleveId → objet params calculés
let parametresValid = {};     // eleveId → boolean
let bulletins       = {};     // eleveId → { texte, statut: 'genere'|'valide' }

let eleveActifIndex = null;

const ANNEE_COURANTE = window.appAnneeCourante || "2024-2025";

/* -------------------------------------------------------
   CONSTANTES MÉTIER
------------------------------------------------------- */

const IFST_SCORE = { I: 1, F: 2, S: 3, TS: 4 };

const COMP_COL = {
  "Lecture document":            "lecture_document",
  "Lecture consignes":           "lecture_consignes",
  "Rédaction de texte":          "redaction_de_texte",
  "Présentation de document":    "presentation_de_document",
  "Lecture image":               "lecture_image",
  "Analyse":                     "analyse_competence",
  "Culture générale":            "culture_generale",
  "Apprentissage connaissances": "apprentissage_connaissances",
  "Langage cartographique":      "langage_cartographique",
  "Usages numériques":           "usages_numeriques",
};

const GROUPE_LECON         = ["culture_generale", "apprentissage_connaissances"];
const GROUPE_METHODES      = ["redaction_de_texte", "presentation_de_document",
                              "analyse_competence", "lecture_image",
                              "langage_cartographique", "usages_numeriques"];
const GROUPE_COMPREHENSION = ["lecture_document", "lecture_consignes"];

// Mapping valeurs stockées → clés de phrases
const ETUDES_KEY = {
  "regularite_rigueur":      "régularité rigueur",
  "regularite_sans_rigueur": "régularité sans rigueur",
  "irregulier_rigueur":      "irrégulier rigueur",
  "irregulier_sans_rigueur": "irrégulier sans rigueur",
  "negligees_rigueur":       "négligées rigueur",
  "negligees_sans_rigueur":  "négligées sans rigueur",
};

// Posture participations → investissement Feuil2 (3 valeurs)
const INVEST_FEUIL2 = {
  moteur:       "moteur",
  participe:    "passif",   // Impliqué → approximation
  passif:       "passif",
  perturbateur: "perturbateur",
};

// Scores participation
const PART_SCORES = {
  Perturbateur: 0, Passif: 1, Impliqué: 2, Moteur: 3,
  perturbateur: 0, passif: 1, participe: 2, moteur: 3,
};

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

async function getClassesFromSupabase() {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return [];
  const { data, error } = await sbAgoram()
    .from("classes").select("id, nom").eq("annee_id", anneeId).order("nom");
  if (error) throw new Error(`Lecture classes impossible. ${error.message}`);
  return data || [];
}

async function getElevesFromSupabase(classeId) {
  const { data, error } = await sbAgoram()
    .from("eleves")
    .select("id, prenom, nom, genre, adaptations")
    .eq("classe_id", classeId)
    .order("nom");
  if (error) throw new Error(`Lecture élèves impossible. ${error.message}`);
  return (data || []).map(e => ({
    ...e,
    adaptations: Array.isArray(e.adaptations) ? e.adaptations : [],
  }));
}

async function getCompetencesEleve(eleveId, anneeId, periode) {
  const { data, error } = await sbAgoram()
    .from("competences_hg")
    .select("*")
    .eq("eleve_id", eleveId)
    .eq("annee_id", anneeId)
    .eq("periode", periode)
    .maybeSingle();
  if (error) throw new Error(`Lecture compétences impossible. ${error.message}`);
  return data || null;
}

async function getSeancesPeriode(classeId, anneeId, periode) {
  const anneeStart = parseInt(ANNEE_COURANTE.split("-")[0]);
  const anneeEnd   = anneeStart + 1;
  const ranges = {
    T1: [`${anneeStart}-09-01`, `${anneeStart}-12-31`],
    T2: [`${anneeEnd}-01-01`,   `${anneeEnd}-03-31`],
    T3: [`${anneeEnd}-04-01`,   `${anneeEnd}-07-31`],
  };
  const [debut, fin] = ranges[periode] || ranges.T1;

  const { data, error } = await sbAgoram()
    .from("seances")
    .select("id")
    .eq("classe_id", classeId)
    .gte("date_seance", debut)
    .lte("date_seance", fin);
  if (error) throw new Error(`Lecture séances impossible. ${error.message}`);
  return (data || []).map(s => s.id);
}

async function getParticipationsMoyenne(eleveId, seanceIds) {
  if (!seanceIds.length) return null;
  const { data, error } = await sbAgoram()
    .from("participations_hg")
    .select("valeur, score")
    .eq("eleve_id", eleveId)
    .in("seance_id", seanceIds);
  if (error) throw new Error(`Lecture participations impossible. ${error.message}`);
  if (!data?.length) return null;
  const scores = data.map(p => p.score ?? PART_SCORES[p.valeur] ?? 1);
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/* -------------------------------------------------------
   CALCUL DES PARAMÈTRES
------------------------------------------------------- */

function scoreToNiveauGlobal(score) {
  if (score < 1.75) return "insuffisant";
  if (score < 2.5)  return "fragile";
  if (score < 3.25) return "satisfaisant";
  return "très satisfaisant";
}

function moyenneGroupe(row, cols) {
  const scores = cols.map(c => IFST_SCORE[row[c]] || null).filter(Boolean);
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function calculerAcquisition(row) {
  const lecon    = moyenneGroupe(row, GROUPE_LECON);
  const methodes = moyenneGroupe(row, GROUPE_METHODES);
  const l = lecon    !== null && lecon    >= 2.5;
  const m = methodes !== null && methodes >= 2.5;
  if (l && m) return "totale";
  if (l)      return "leçon";
  if (m)      return "méthodes";
  return "rien";
}

function calculerComprehension(row) {
  const doc  = IFST_SCORE[row.lecture_document]  || null;
  const cons = IFST_SCORE[row.lecture_consignes] || null;
  const d = doc  !== null && doc  >= 2.5;
  const c = cons !== null && cons >= 2.5;
  if (d && c) return "tout";
  if (d)      return "docs";
  if (c)      return "consignes";
  return "rien";
}

function scoreToPosture(score) {
  if (score === null) return null;
  if (score < 0.75) return "perturbateur";
  if (score < 1.5)  return "passif";
  if (score < 2.5)  return "participe";
  return "moteur";
}

function niveauClasseFromNom(nom) {
  const m = String(nom).match(/[3456]/);
  return m ? parseInt(m[0]) : null;
}

async function calculerParametresEleve(eleve) {
  const anneeId   = await getActiveAnneeId();
  const row       = await getCompetencesEleve(eleve.id, anneeId, periodeActive);
  const seanceIds = await getSeancesPeriode(classeActiveId, anneeId, periodeActive);
  const partScore = await getParticipationsMoyenne(eleve.id, seanceIds);

  // Niveau global = moyenne des 10 compétences
  let niveauGlobal = null;
  if (row) {
    const allCols = [...GROUPE_LECON, ...GROUPE_METHODES, ...GROUPE_COMPREHENSION];
    const scores  = allCols.map(c => IFST_SCORE[row[c]] || null).filter(Boolean);
    if (scores.length) {
      const moy = scores.reduce((a, b) => a + b, 0) / scores.length;
      niveauGlobal = scoreToNiveauGlobal(moy);
    }
  }

  return {
    prenom:              eleve.prenom,
    adaptations:         eleve.adaptations,
    niveauGlobal,
    trimestre:           periodeActive.replace("T", ""),
    niveauClasse:        niveauClasseFromNom(classeActive),
    sexe:                eleve.genre || "M",
    posture:             scoreToPosture(partScore),
    investissement:      row?.investissement_maison   || null,
    acquisition:         row ? calculerAcquisition(row)   : null,
    comprehension:       row ? calculerComprehension(row) : null,
    posture_classe:      row?.posture_classe           || null,
    etudes_personnelles: row?.etudes_personnelles      || null,
  };
}

/* -------------------------------------------------------
   ASSEMBLAGE DU BULLETIN
------------------------------------------------------- */

function assemblerBulletin(params) {
  const blocs = [];

  // Bloc 1 — Adaptations
  for (const adapt of params.adaptations) {
    const phrase = ADAPTATIONS[adapt];
    if (phrase) blocs.push(phrase);
  }

  // Bloc 2 — Niveau global
  if (params.niveauGlobal && params.trimestre && params.niveauClasse) {
    const cle = `${params.trimestre}${params.niveauClasse}${params.niveauGlobal}`;
    const phrase = NIVEAU_GLOBAL[cle];
    if (phrase) blocs.push(phrase);
  }

  // Bloc 3 — Bilan
  if (params.posture && params.investissement && params.acquisition && params.comprehension) {
    const cle = `${params.posture}${params.investissement}${params.acquisition}${params.comprehension}`;
    const phrase = BILAN[cle];
    if (phrase) blocs.push(phrase);
  }

  // Bloc 4 — Conseils
  const etudes = ETUDES_KEY[params.etudes_personnelles] || null;
  const invest = INVEST_FEUIL2[params.posture] || null;
  if (params.posture_classe && invest && etudes && params.trimestre && params.niveauClasse && params.sexe) {
    const cle = `${params.trimestre}${params.niveauClasse}${params.sexe}${params.posture_classe}${invest}${etudes}`;
    const phrase = CONSEILS[cle];
    if (phrase) {
      const sujet = params.prenom ? params.prenom + " " : (params.sexe === "F" ? "Elle " : "Il ");
      blocs.push(sujet + phrase);
    }
  }

  return blocs.join(" ").trim();
}

/* -------------------------------------------------------
   CHARGEMENT ÉLÈVES
------------------------------------------------------- */

async function chargerElevesClasse() {
  if (!classeActiveId) return;
  elevesClasse    = await getElevesFromSupabase(classeActiveId);
  parametres      = {};
  parametresValid = {};
  bulletins       = {};
  eleveActifIndex = null;
}

/* -------------------------------------------------------
   RENDU PRINCIPAL
------------------------------------------------------- */

export async function renderBulletinsHG() {
  classesMeta = await getClassesFromSupabase();

  if (!classesMeta.length) {
    return `<div class="page"><h1>Bulletins HG</h1><p>Aucune classe disponible. Importe d'abord des élèves.</p></div>`;
  }

  if (!classeActive) {
    classeActive   = classesMeta[0].nom;
    classeActiveId = classesMeta[0].id;
  }

  await chargerElevesClasse();

  return `
    <div class="page page-bulletins">

      <div class="bulletins-topbar">
        <h1>Bulletins HG</h1>
        <div class="bulletins-controls">

          <label>Classe :
            <select id="bulletinClasse">
              ${classesMeta.map(c => `
                <option value="${c.id}" data-nom="${c.nom}"
                  ${c.id === classeActiveId ? "selected" : ""}>
                  ${c.nom}
                </option>
              `).join("")}
            </select>
          </label>

          <label>Trimestre :
            <select id="bulletinTrimestre">
              ${["T1","T2","T3"].map(t => `
                <option value="${t}" ${t === periodeActive ? "selected" : ""}>${t}</option>
              `).join("")}
            </select>
          </label>

          <button id="genererTousBtn">⚡ Générer tous</button>
          <button id="exportCsvBtn">📄 Export CSV</button>

        </div>
      </div>

      <div class="bulletins-body">

        <div class="bulletins-liste" id="bulletinsListe">
          ${renderListeEleves()}
        </div>

        <div class="bulletins-panneau" id="bulletinsPanneau" style="display:none;"></div>

      </div>
    </div>
  `;
}

/* -------------------------------------------------------
   LISTE ÉLÈVES
------------------------------------------------------- */

function renderListeEleves() {
  if (!elevesClasse.length) return "<p>Aucun élève dans cette classe.</p>";

  return elevesClasse.map((e, i) => {
    const b       = bulletins[e.id];
    const valide  = parametresValid[e.id] || false;
    const statut  = !b ? "⚪" : b.statut === "valide" ? "✅" : "🟠";
    const apercu  = b?.texte ? b.texte.slice(0, 90) + "…" : "";
    const actif   = eleveActifIndex === i;

    return `
      <div class="bulletin-row ${actif ? "active" : ""}" data-index="${i}" role="button" tabindex="0" style="cursor:pointer;">
        <div class="bulletin-row-head">
          <span class="statut">${statut}</span>
          <span class="eleve-nom">${e.prenom} ${e.nom}</span>
          ${valide ? '<span class="badge-valide">✅</span>' : ""}
        </div>
        ${apercu ? `<div class="bulletin-apercu">${apercu}</div>` : ""}
      </div>
    `;
  }).join("");
}

/* -------------------------------------------------------
   PANNEAU PARAMÈTRES
------------------------------------------------------- */

function renderPanneauParametres(index) {
  const eleve = elevesClasse[index];
  const p     = parametres[eleve.id];
  const valid = parametresValid[eleve.id] || false;
  const b     = bulletins[eleve.id];

  const prev = index > 0;
  const next = index < elevesClasse.length - 1;

  function badge(val) {
    return val
      ? `<span class="badge ok">${val}</span>`
      : `<span class="badge manquant">—</span>`;
  }

  if (!p) {
    return `
      <div class="panneau-inner">
        <div class="panneau-nav">
          <button id="navPrev" ${prev ? "" : "disabled"}>◀</button>
          <strong>${eleve.prenom} ${eleve.nom}</strong>
          <button id="navNext" ${next ? "" : "disabled"}>▶</button>
        </div>
        <p>⏳ Chargement…</p>
      </div>
    `;
  }

  return `
    <div class="panneau-inner">

      <div class="panneau-nav">
        <button id="navPrev" ${prev ? "" : "disabled"}>◀</button>
        <strong>${eleve.prenom} ${eleve.nom}</strong>
        <button id="navNext" ${next ? "" : "disabled"}>▶</button>
      </div>

      <table class="params-table">
        <tr>
          <th>Adaptations</th>
          <td>${p.adaptations.length ? p.adaptations.join(", ") : "—"}</td>
        </tr>
        <tr><th>Niveau global</th>         <td>${badge(p.niveauGlobal)}</td></tr>
        <tr>
          <th>Posture (participation)</th>
          <td>
            ${p.posture ? badge(p.posture) : `
              <span class="badge manquant">Non disponible — saisir manuellement :</span>
              <div class="choix-groupe" style="margin-top:6px;">
                ${["moteur","participe","passif","perturbateur"].map(v => `
                  <button type="button"
                    class="btn-choix btn-posture-manuel ${p._postureManuelle === v ? "active" : ""}"
                    data-posture="${v}">${v}
                  </button>`).join("")}
              </div>
            `}
          </td>
        </tr>
        <tr><th>Investissement</th>         <td>${badge(p.investissement)}</td></tr>
        <tr><th>Acquisition</th>            <td>${badge(p.acquisition)}</td></tr>
        <tr><th>Compréhension</th>          <td>${badge(p.comprehension)}</td></tr>
        <tr><th>Posture classe</th>         <td>${badge(p.posture_classe)}</td></tr>
        <tr><th>Études personnelles</th>    <td>${badge(p.etudes_personnelles)}</td></tr>
      </table>

      <div class="panneau-actions">
        <button id="validerParamsBtn" class="${valid ? "btn-valid" : ""}">
          ${valid ? "✅ Paramètres validés" : "Valider les paramètres"}
        </button>
      </div>

      ${b ? `
        <div class="panneau-bulletin">
          <h4>Bulletin généré</h4>
          <p class="bulletin-texte-apercu">${b.texte}</p>
          <button id="corrigerBtn">✏️ Corriger</button>
        </div>
      ` : ""}

    </div>
  `;
}

/* -------------------------------------------------------
   MODULE D'ÉCRITURE (correction)
------------------------------------------------------- */

function renderModuleEcriture(eleveId) {
  const texte = bulletins[eleveId]?.texte || "";
  return `
    <div class="module-ecriture" id="moduleEcriture">
      <h4>Correction du bulletin</h4>
      <textarea id="bulletinTexteEdit" rows="10">${texte}</textarea>
      <div class="module-actions">
        <button id="validerCorrectionBtn">✅ Valider la correction</button>
        <button id="annulerCorrectionBtn">Annuler</button>
      </div>
    </div>
  `;
}

/* -------------------------------------------------------
   EVENTS PRINCIPAUX
------------------------------------------------------- */

export function bindBulletinsHGEvents() {

  document.getElementById("bulletinClasse")?.addEventListener("change", async e => {
    const opt      = e.target.selectedOptions[0];
    classeActiveId = opt.value;
    classeActive   = opt.dataset.nom;
    await chargerElevesClasse();
    refreshListe();
    document.getElementById("bulletinsPanneau").style.display = "none";
  });

  document.getElementById("bulletinTrimestre")?.addEventListener("change", e => {
    periodeActive   = e.target.value;
    parametres      = {};
    parametresValid = {};
    bulletins       = {};
    eleveActifIndex = null;
    refreshListe();
    document.getElementById("bulletinsPanneau").style.display = "none";
  });

  document.getElementById("genererTousBtn")?.addEventListener("click", genererTous);
  document.getElementById("exportCsvBtn")?.addEventListener("click", exporterCSV);

  bindBoutonsParams();
}

/* -------------------------------------------------------
   EVENTS PANNEAU
------------------------------------------------------- */

function bindBoutonsParams() {
  document.querySelectorAll(".bulletin-row[data-index]").forEach(row => {
    row.addEventListener("click", async () => {
      await ouvrirPanneau(parseInt(row.dataset.index));
    });
  });
}

async function ouvrirPanneau(index) {
  eleveActifIndex = index;
  const eleve     = elevesClasse[index];
  const panneau   = document.getElementById("bulletinsPanneau");

  panneau.style.display = "block";
  panneau.innerHTML = renderPanneauParametres(index);
  bindPanneauEvents(index);

  if (!parametres[eleve.id]) {
    try {
      parametres[eleve.id] = await calculerParametresEleve(eleve);
    } catch (err) {
      console.error(`Erreur paramètres ${eleve.nom} :`, err);
    }
    panneau.innerHTML = renderPanneauParametres(index);
    bindPanneauEvents(index);
  }

  refreshListe();
}

function bindPanneauEvents(index) {
  const eleve = elevesClasse[index];

  document.getElementById("navPrev")?.addEventListener("click", () => {
    if (index > 0) ouvrirPanneau(index - 1);
  });
  document.getElementById("navNext")?.addEventListener("click", () => {
    if (index < elevesClasse.length - 1) ouvrirPanneau(index + 1);
  });

  // Posture manuelle — mémorisée dans parametres, pas dans Supabase
  document.querySelectorAll(".btn-posture-manuel").forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.posture;
      if (parametres[eleve.id]) {
        parametres[eleve.id]._postureManuelle = val;
        parametres[eleve.id].posture = val; // utilisé pour la génération
      }
      document.querySelectorAll(".btn-posture-manuel").forEach(b => {
        b.classList.toggle("active", b.dataset.posture === val);
      });
    });
  });

  document.getElementById("validerParamsBtn")?.addEventListener("click", () => {
    parametresValid[eleve.id] = true;
    const panneau = document.getElementById("bulletinsPanneau");
    panneau.innerHTML = renderPanneauParametres(index);
    bindPanneauEvents(index);
    refreshListe();
  });

  document.getElementById("corrigerBtn")?.addEventListener("click", () => {
    const panneau = document.getElementById("bulletinsPanneau");
    panneau.insertAdjacentHTML("beforeend", renderModuleEcriture(eleve.id));
    bindModuleEcritureEvents(index);
  });
}

function bindModuleEcritureEvents(index) {
  const eleve = elevesClasse[index];

  document.getElementById("validerCorrectionBtn")?.addEventListener("click", () => {
    const texte = document.getElementById("bulletinTexteEdit")?.value.trim();
    if (!texte) return;
    bulletins[eleve.id] = { texte, statut: "valide" };
    document.getElementById("moduleEcriture")?.remove();
    const panneau = document.getElementById("bulletinsPanneau");
    panneau.innerHTML = renderPanneauParametres(index);
    bindPanneauEvents(index);
    refreshListe();
  });

  document.getElementById("annulerCorrectionBtn")?.addEventListener("click", () => {
    document.getElementById("moduleEcriture")?.remove();
  });
}

/* -------------------------------------------------------
   GÉNÉRER TOUS
------------------------------------------------------- */

async function genererTous() {
  const btn = document.getElementById("genererTousBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Génération…"; }

  for (const eleve of elevesClasse) {
    if (!parametres[eleve.id]) {
      try {
        parametres[eleve.id] = await calculerParametresEleve(eleve);
      } catch (err) {
        console.error(`Erreur paramètres ${eleve.nom} :`, err);
        continue;
      }
    }
    const texte = assemblerBulletin(parametres[eleve.id]);
    if (texte) bulletins[eleve.id] = { texte, statut: "genere" };
  }

  if (btn) { btn.disabled = false; btn.textContent = "⚡ Générer tous"; }
  refreshListe();
  if (eleveActifIndex !== null) await ouvrirPanneau(eleveActifIndex);
}

/* -------------------------------------------------------
   EXPORT CSV
------------------------------------------------------- */

function exporterCSV() {
  const avec = elevesClasse.filter(e => bulletins[e.id]?.texte);

  if (!avec.length) {
    alert("Aucun bulletin généré pour cette période.");
    return;
  }

  let csv = "annee;periode;classe;prenom;nom;bulletin_hg\n";
  avec.forEach(e => {
    const texte = `"${bulletins[e.id].texte.replace(/"/g, '""')}"`;
    csv += `${ANNEE_COURANTE};${periodeActive};${classeActive};${e.prenom};${e.nom};${texte}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `bulletins_HG_${ANNEE_COURANTE}_${periodeActive}_${classeActive}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------
   REFRESH LISTE
------------------------------------------------------- */

function refreshListe() {
  const liste = document.getElementById("bulletinsListe");
  if (liste) {
    liste.innerHTML = renderListeEleves();
    bindBoutonsParams();
  }
}
