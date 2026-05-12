import { getEleves } from "./importExport.js";
import { getEDT, CRENEAUX } from "./emploiDuTemps.js";

/* =======================================================
   PAGE : Salle
   RÔLE MÉTIER :
     - Saisie terrain en situation de classe (assiduité + comportement + participation fin de séance)
     - Affichage spatial de la classe (vue du dessus) : 3 colonnes, 5 rangées, 2 tables collées/rangée
     - Choix du contenu de séance (code) : proposé par défaut (dernier utilisé) + saisie libre
   LIT :
     - Import/Export : getEleves() (nom/prénom, genre, groupe, adaptation, place)
     - EDT : getEDT() + CRENEAUX (contexte séance : classe/groupe/créneau du moment)
     - LocalStorage : dernier contenu par classe/groupe, événements locaux
     - Supabase (optionnel) : window.sb (si configuré) pour persister les événements
   ÉCRIT :
     - Événements de séance : assiduité, comportement, participation, contenu_code
       (1) d’abord en local (window.AG_EVENTS + localStorage)
       (2) puis tentative d’insert Supabase (si disponible)
   HORS-PÉRIMÈTRE :
     - Gestion des places (fait dans ClassesHG)
     - Évaluation des compétences (fait dans le profil élève ClassesHG)
     - Génération bulletins
   ======================================================= */


/* -------------------------------------------------------
   BLOC 1 — RÉFÉRENTIEL CONTENU (codes)
   But : proposer une base codée H/G/EMC/AP + permettre saisie libre
   Règles :
     - H1..H10, G1..G10 : Intro, 1.1..1.3, 2.1..2.3, 3.1..3.3, Conclusion, DST, Correction
     - EMC1..EMC5 : même logique
     - AP1..AP25 : simple (AP1..AP25)
------------------------------------------------------- */

function buildContenusCatalogue() {
  const out = [];

  const addChapitre = (prefix, n) => {
    const base = `${prefix}${n}`;
    out.push(base);
    out.push(`${base} Intro`);
    // 1.1..1.3
    for (let i = 1; i <= 3; i++) out.push(`${base} 1.${i}`);
    // 2.1..2.3
    for (let i = 1; i <= 3; i++) out.push(`${base} 2.${i}`);
    // 3.1..3.3
    for (let i = 1; i <= 3; i++) out.push(`${base} 3.${i}`);

    out.push(`${base} Conclusion`);
    out.push(`${base} DST`);
    out.push(`${base} Correction`);
  };

  for (let n = 1; n <= 10; n++) addChapitre("H", n);
  for (let n = 1; n <= 10; n++) addChapitre("G", n);
  for (let n = 1; n <= 5; n++) addChapitre("EMC", n);

  for (let n = 1; n <= 25; n++) out.push(`AP${n}`);

  return out;
}

const CONTENUS_CATALOGUE = buildContenusCatalogue();


/* -------------------------------------------------------
   BLOC 2 — PLAN SALLE (structure spatiale)
   Règle : 3 colonnes, 5 rangées, paires collées
   Places globales :
     - gauche : 1..10
     - centre : 11..20
     - droite : 21..30
------------------------------------------------------- */

const PLAN_SALLE = {
  gauche: [1,2,3,4,5,6,7,8,9,10],
  centre: [11,12,13,14,15,16,17,18,19,20],
  droite: [21,22,23,24,25,26,27,28,29,30],
};

/**
 * Couleur de table (classe CSS), selon colonne + numéro local (1..10) :
 * gauche : 1..5 vert, 6..10 violet
 * centre : 1..5 jaune, 6..10 bleu
 * droite : 1..5 rouge, 6..10 noir
 */
function couleurTable(place) {
  if (place >= 1 && place <= 10) return (place <= 5) ? "vert" : "violet";
  if (place >= 11 && place <= 20) return (place <= 15) ? "jaune" : "bleu";
  if (place >= 21 && place <= 30) return (place <= 25) ? "rouge" : "noir";
  return "";
}

/**
 * Couleur adaptation (classe CSS), 1 adaptation unique par élève :
 * PPS rouge, PAP jaune, PPRE bleu, Adaptations vert-fonce, Adaptations partielles vert-clair
 */
function classeAdaptation(adapt) {
  switch (adapt) {
    case "PPS": return "adapt-pps";                 // rouge
    case "PAP": return "adapt-pap";                 // jaune
    case "PPRE": return "adapt-ppre";               // bleu
    case "Adaptations": return "adapt-vert-fonce";  // vert foncé
    case "Adaptations partielles": return "adapt-vert-clair"; // vert clair
    default: return "";
  }
}


/* -------------------------------------------------------
   BLOC 3 — STOCK LOCAL ÉVÉNEMENTS (anti-perte)
   But : ne pas perdre la saisie terrain même avant Supabase
   Store : window.AG_EVENTS + localStorage("AG_EVENTS_V1")
------------------------------------------------------- */

const LS_EVENTS_KEY = "AG_EVENTS_V1";

function loadEvents() {
  try {
    const raw = localStorage.getItem(LS_EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return { assiduite: [], comportement: [], participation: [], contenu: [] };
}

function saveEvents(store) {
  try { localStorage.setItem(LS_EVENTS_KEY, JSON.stringify(store)); } catch {}
}

function getEventsStore() {
  if (!window.AG_EVENTS) window.AG_EVENTS = loadEvents();
  return window.AG_EVENTS;
}


/* -------------------------------------------------------
   BLOC 4 — CONTEXTE SÉANCE (depuis EDT)
   But : trouver automatiquement la classe/groupe/créneau du moment
------------------------------------------------------- */

function todayKeyISO() {
  const d = new Date();
  // YYYY-MM-DD local
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function mondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - day + 1);
  d.setHours(0,0,0,0);
  return d;
}

function toISODate(d) {
  return d.toISOString().slice(0,10);
}

function getJourFR(date) {
  const js = date.getDay(); // 0..6
  return ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"][js];
}

/**
 * Détermine le créneau courant en comparant l'heure locale à CRENEAUX.
 * Retourne le code (M1..S4) ou null si hors créneaux.
 */
function getCreneauCourant() {
  const now = new Date();
  const hhmm = (d) => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  const t = hhmm(now);

  for (const cr of CRENEAUX) {
    if (cr.code === "PM") continue; // pause
    if (t >= cr.debut && t < cr.fin) return cr.code;
  }
  return null;
}

/**
 * Contexte séance courant :
 * - date (YYYY-MM-DD)
 * - isoLundi (clé semaine)
 * - jour (lundi..vendredi)
 * - creneau (M1..S4)
 * - classe + groupe (depuis EDT enregistré)
 */
function getContexteSeanceCourante() {
  const now = new Date();
  const isoLundi = toISODate(mondayOfWeek(now));
  const dateISO = todayKeyISO();
  const jour = getJourFR(now);
  const creneau = getCreneauCourant();

  const edt = getEDT() || {};
  const lignes = edt[isoLundi] || [];

  // On cherche une ligne correspondant au jour + créneau
  const match = lignes.find(x => x.jour === jour && x.creneau === creneau);

  // Si rien trouvé : on renvoie un contexte partiel (Salle peut afficher un warning)
  return {
    dateISO,
    isoLundi,
    jour,
    creneau,
    classe: match ? match.classe : null,
    groupe: match ? (match.groupe || null) : null,
    type: match ? (match.type || null) : null,
    trimestre: match ? (match.trimestre || null) : null,
    semestre: match ? (match.semestre || null) : null,
  };
}


/* -------------------------------------------------------
   BLOC 5 — ÉTAT SALLE
   But : élèves filtrés par classe/groupe + contenu_code courant
------------------------------------------------------- */

let contexte = null;
let elevesSalle = [];
let contenuCode = "";     // valeur active (catalogue ou libre)
let contenuLibre = "";    // champ libre
let lastContentKey = "";  // clé classe|groupe pour mémoriser


/* -------------------------------------------------------
   BLOC 6 — DERNIER CONTENU (auto-proposition)
   But : proposer le dernier contenu utilisé pour la classe/groupe
------------------------------------------------------- */

function getLastContentStorageKey(classe, groupe) {
  const g = groupe || "classe entière";
  return `AG_LAST_CONTENU::${classe}::${g}`;
}

function loadLastContent(classe, groupe) {
  try {
    const k = getLastContentStorageKey(classe, groupe);
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
}

function saveLastContent(classe, groupe, code) {
  try {
    const k = getLastContentStorageKey(classe, groupe);
    localStorage.setItem(k, code || "");
  } catch {}
}


/* -------------------------------------------------------
   BLOC 7 — INITIALISATION SALLE
   But : construire la salle à partir du contexte EDT + élèves importés
------------------------------------------------------- */

export function initSalle() {
  contexte = getContexteSeanceCourante();

  // Filtrer élèves par classe (et groupe si EDT indique un groupe)
  const all = getEleves();

  if (contexte.classe) {
    const filtered = all.filter(e => e.classe === contexte.classe);

    // Si groupe défini (gr 1 / gr 2), on ne garde que ceux du groupe
    if (contexte.groupe) {
      elevesSalle = filtered.filter(e => (e.groupe || null) === contexte.groupe);
    } else {
      elevesSalle = filtered;
    }
  } else {
    // Pas de classe trouvée : salle vide (mais on garde une UI)
    elevesSalle = [];
  }

  // Normaliser champs attendus
  elevesSalle = elevesSalle.map((e, idx) => ({
    ...e,
    place: e.place ?? null,
    // suivi local si absent dans les données
    suivi: e.suivi ?? {
      absence: false,
      retard: false,
      devoir: false,
      absentControle: false,
      observation: ""
    },
    // adaptation unique attendue (on garde tableau mais on utilise [0])
    adaptations: e.adaptations ?? [],
    // participation (par défaut passif, mais la vraie participation est un event)
    participation: e.participation ?? "passif",
    _fallbackIndex: idx
  }));

  // Si aucune place n'est attribuée dans cette classe, fallback : places séquentielles
  const anyPlaced = elevesSalle.some(e => Number.isInteger(e.place));
  if (!anyPlaced) {
    elevesSalle.forEach((e, i) => { e.place = i + 1; });
  }

  // contenu_code : dernier utilisé par classe/groupe (si classe connue)
  if (contexte.classe) {
    const last = loadLastContent(contexte.classe, contexte.groupe);
    contenuCode = last || "";
    contenuLibre = "";
    lastContentKey = getLastContentStorageKey(contexte.classe, contexte.groupe);
  } else {
    contenuCode = "";
    contenuLibre = "";
    lastContentKey = "";
  }
}


/* -------------------------------------------------------
   BLOC 8 — RENDU (HTML)
   Structure :
     - bandeau interne : contexte + contenu_code (catalogue + libre)
     - salle : 3 colonnes + allées + rangées/paires
     - modal container
------------------------------------------------------- */

export function renderSalle() {
  if (!contexte) initSalle();

  const titreClasse = contexte.classe
    ? `${contexte.classe}${contexte.groupe ? " " + contexte.groupe : ""}`
    : "Aucune classe (EDT non renseigné pour ce créneau)";

  const titreSeance = (contexte.jour && contexte.creneau)
    ? `${capitalize(contexte.jour)} — ${contexte.creneau} — ${contexte.dateISO}`
    : `${capitalize(contexte.jour || "—")} — (hors créneau) — ${contexte.dateISO}`;

  return `
    <div class="page page-salle">

      <!-- (1) Bandeau interne Salle : contexte + contenu -->
      <div class="salle-topbar">

        <div class="salle-contexte">
          <div class="salle-classe"><strong>${escapeHtml(titreClasse)}</strong></div>
          <div class="salle-seance">${escapeHtml(titreSeance)}</div>
        </div>

        <div class="salle-contenu">
          <label>Contenu</label>
          <select id="contenuSelect">
            <option value="">—</option>
            ${CONTENUS_CATALOGUE.map(c => `
              <option value="${escapeAttr(c)}" ${c === contenuCode ? "selected" : ""}>${escapeHtml(c)}</option>
            `).join("")}
          </select>

          <input id="contenuLibre" type="text" placeholder="Saisie libre (optionnel)" value="${escapeAttr(contenuLibre)}">
          <button id="contenuSave">OK</button>
        </div>

        <div class="salle-actions">
          <button id="openParticipation" title="Participation fin de séance">Participation</button>
        </div>

      </div>

      <!-- (2) Salle (vue du dessus) -->
      <div class="salle-plein-ecran">

        ${renderColonne("gauche")}
        <div class="allee"></div>
        ${renderColonne("centre")}
        <div class="allee"></div>
        ${renderColonne("droite")}

      </div>

      <!-- (3) Modale globale -->
      <div id="modal"></div>
    </div>
  `;
}

function renderColonne(nom) {
  const places = PLAN_SALLE[nom];
  const rangees = [];
  for (let i = 0; i < places.length; i += 2) rangees.push([places[i], places[i+1]]);

  // Orientation : bas = prof → en CSS on utilisera column-reverse si besoin.
  return `
    <div class="colonne ${nom}">
      ${rangees.map(([p1,p2]) => `
        <div class="rangee">
          ${renderTable(p1)}
          ${renderTable(p2)}
        </div>
      `).join("")}
    </div>
  `;
}

function renderTable(place) {
  const eleve = elevesSalle.find(e => e.place === place);
  const couleur = couleurTable(place);

  const adapt = eleve && eleve.adaptations && eleve.adaptations.length ? eleve.adaptations[0] : "";
  const adaptClass = classeAdaptation(adapt);

  return `
    <div class="table ${couleur}" data-place="${place}">
      <span class="numero">${place}</span>

      ${eleve ? `
        <div class="nom">${escapeHtml(eleve.prenom)} ${escapeHtml(eleve.nom || "")}</div>
        ${adaptClass ? `<span class="adaptation-dot ${adaptClass}" title="${escapeAttr(adapt)}"></span>` : ""}
      ` : `<div class="nom vide">—</div>`}
    </div>
  `;
}


/* -------------------------------------------------------
   BLOC 9 — EVENTS UI
   - contenu : select + champ libre + mémorisation dernier
   - clic table : ouvrir fiche élève (assiduité + comportement)
   - participation : modale fin de séance
------------------------------------------------------- */

export function bindSalleEvents() {
  // contenu : sélection
  const sel = document.getElementById("contenuSelect");
  const libre = document.getElementById("contenuLibre");
  const btnOK = document.getElementById("contenuSave");

  if (sel) sel.onchange = () => {
    contenuCode = sel.value || "";
    // si on choisit un code catalogue, on efface le libre (mais sans forcer)
  };

  if (libre) libre.oninput = () => {
    contenuLibre = libre.value;
  };

  if (btnOK) btnOK.onclick = () => {
    // règle : si libre non vide -> prioritaire
    const codeFinal = (contenuLibre && contenuLibre.trim()) ? contenuLibre.trim() : contenuCode;

    if (contexte && contexte.classe) {
      saveLastContent(contexte.classe, contexte.groupe, codeFinal);
    }

    // enregistrer un “événement contenu” (optionnel mais utile pour bilan)
    recordEvent("contenu", {
      contenu_code: codeFinal
    });
  };

  // clic table -> fiche élève
  document.querySelectorAll(".table").forEach(el => {
    el.addEventListener("click", () => {
      const place = Number(el.dataset.place);
      const eleve = elevesSalle.find(e => e.place === place);
      if (eleve) ouvrirFicheEleve(eleve);
    });
  });

  // participation fin de séance
  const btnPart = document.getElementById("openParticipation");
  if (btnPart) btnPart.onclick = () => ouvrirParticipation();
}


/* -------------------------------------------------------
   BLOC 10 — MODALE FICHE ÉLÈVE (saisie terrain)
   Contenu :
     - assiduité (4 flags)
     - observation comportement (texte court)
   Règle : on enregistre des événements datés + contexte séance
------------------------------------------------------- */

function ouvrirFicheEleve(eleve) {
  document.getElementById("modal").innerHTML = `
    <div class="fiche-eleve">
      <div class="fiche-head">
        <h2>${escapeHtml(eleve.prenom)} ${escapeHtml(eleve.nom || "")}</h2>
        <button id="closeFiche">✕</button>
      </div>

      <div class="fiche-bloc">
        <label><input id="chkAbs" type="checkbox" ${eleve.suivi.absence ? "checked" : ""}> Absence</label>
        <label><input id="chkRet" type="checkbox" ${eleve.suivi.retard ? "checked" : ""}> Retard</label>
        <label><input id="chkDev" type="checkbox" ${eleve.suivi.devoir ? "checked" : ""}> Devoir non fait</label>
        <label><input id="chkCtrl" type="checkbox" ${eleve.suivi.absentControle ? "checked" : ""}> Absent au contrôle</label>
      </div>

      <div class="fiche-bloc">
        <label>Observation (comportement)</label>
        <textarea id="obs" rows="3">${escapeHtml(eleve.suivi.observation || "")}</textarea>
      </div>

      <div class="fiche-actions">
        <button id="saveFiche">Enregistrer</button>
      </div>
    </div>
  `;

  document.getElementById("closeFiche").onclick = () => {
    document.getElementById("modal").innerHTML = "";
  };

  document.getElementById("saveFiche").onclick = () => {
    eleve.suivi.absence = document.getElementById("chkAbs").checked;
    eleve.suivi.retard = document.getElementById("chkRet").checked;
    eleve.suivi.devoir = document.getElementById("chkDev").checked;
    eleve.suivi.absentControle = document.getElementById("chkCtrl").checked;
    eleve.suivi.observation = document.getElementById("obs").value || "";

    // enregistrer événements
    recordEvent("assiduite", { eleveId: eleve.id, type: "absence", state: eleve.suivi.absence });
    recordEvent("assiduite", { eleveId: eleve.id, type: "retard", state: eleve.suivi.retard });
    recordEvent("assiduite", { eleveId: eleve.id, type: "devoir", state: eleve.suivi.devoir });
    recordEvent("assiduite", { eleveId: eleve.id, type: "absentControle", state: eleve.suivi.absentControle });

    if (eleve.suivi.observation && eleve.suivi.observation.trim()) {
      recordEvent("comportement", { eleveId: eleve.id, texte: eleve.suivi.observation.trim() });
    }

    document.getElementById("modal").innerHTML = "";
  };
}


/* -------------------------------------------------------
   BLOC 11 — MODALE PARTICIPATION (fin de séance)
   Règle : liste par place, 4 états
------------------------------------------------------- */

function ouvrirParticipation() {
  const list = elevesSalle
    .slice()
    .filter(e => Number.isInteger(e.place))
    .sort((a,b) => a.place - b.place);

  document.getElementById("modal").innerHTML = `
    <div class="participation">
      <div class="fiche-head">
        <h2>Participation — ${escapeHtml(contexte?.classe || "—")}</h2>
        <button id="closePart">✕</button>
      </div>

      <div class="hint">Ordre par place · défaut = passif</div>

      <div class="part-list">
        ${list.map(e => `
          <div class="part-row">
            <span class="part-place">#${e.place}</span>
            <span class="part-nom">${escapeHtml(e.prenom)} ${escapeHtml(e.nom || "")}</span>
            <div class="part-btns">
              ${renderPartBtn(e.id, "passif")}
              ${renderPartBtn(e.id, "perturbateur")}
              ${renderPartBtn(e.id, "participe")}
              ${renderPartBtn(e.id, "moteur")}
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  document.getElementById("closePart").onclick = () => {
    document.getElementById("modal").innerHTML = "";
  };

  document.querySelectorAll(".btn-part").forEach(btn => {
    btn.addEventListener("click", () => {
      const eleveId = Number(btn.dataset.id);
      const val = btn.dataset.val;

      recordEvent("participation", { eleveId, valeur: val });

      // feedback visuel local (sans CSS complexe)
      const row = btn.closest(".part-row");
      if (row) {
        row.querySelectorAll(".btn-part").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      }
    });
  });
}

function renderPartBtn(id, val) {
  const label = (val === "passif") ? "P"
              : (val === "perturbateur") ? "Pe"
              : (val === "participe") ? "S"
              : "M";
  return `<button class="btn-part" data-id="${id}" data-val="${val}">${label}</button>`;
}


/* -------------------------------------------------------
   BLOC 12 — ENREGISTREMENT ÉVÉNEMENTS (local + Supabase)
   But :
     - Toujours écrire local (AG_EVENTS + localStorage)
     - Puis tenter Supabase si window.sb existe
   IMPORTANT :
     - Les noms de tables Supabase peuvent différer : à adapter quand tu crées le schéma.
------------------------------------------------------- */

async function recordEvent(kind, payload) {
  const store = getEventsStore();

  const codeFinal = (contenuLibre && contenuLibre.trim()) ? contenuLibre.trim() : contenuCode;
  const meta = {
    kind,
    date: contexte?.dateISO || todayKeyISO(),
    isoLundi: contexte?.isoLundi || toISODate(mondayOfWeek(new Date())),
    jour: contexte?.jour || getJourFR(new Date()),
    creneau: contexte?.creneau || getCreneauCourant(),
    classe: contexte?.classe || null,
    groupe: contexte?.groupe || null,
    type: contexte?.type || null,
    trimestre: contexte?.trimestre || null,
    semestre: contexte?.semestre || null,
    contenu_code: codeFinal || null,
    ...payload
  };

  // 1) Local
  if (kind === "assiduite") store.assiduite.push(meta);
  else if (kind === "comportement") store.comportement.push(meta);
  else if (kind === "participation") store.participation.push(meta);
  else if (kind === "contenu") store.contenu.push(meta);

  saveEvents(store);

  // 2) Supabase (optionnel)
  // IMPORTANT : table à créer/adapter dans ton schéma Supabase.
  // Proposition : table "salle_events" avec colonnes correspondant à meta.
  try {
    if (window.sb) {
      const { error } = await window.sb
        .from("salle_events")
        .insert([meta]);

      // Si table inexistante/policy, on ne casse pas l'app : juste log.
      if (error) {
        console.warn("Supabase insert salle_events (non bloquant):", error.message);
      }
    }
  } catch (e) {
    console.warn("Supabase insert exception (non bloquant):", e?.message || e);
  }
}


/* -------------------------------------------------------
   BLOC 13 — UTILITAIRES
------------------------------------------------------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[m]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
