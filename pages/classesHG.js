import { getEleves, getClasses } from "./importExport.js";

/* =======================================================
   PAGE : Classes HG
   RÔLE MÉTIER :
     - Cockpit de classe HG : navigation par onglets (1 onglet = 1 classe importée)
     - Paramétrage élève : genre / groupe / adaptation (unique) / place
     - Plan de salle (1..30) : attribution des places (source pour la page Salle)
     - Profil élève (modale) :
         * Assiduité (lecture seule : saisie uniquement en Salle)  [1](https://onedrive.live.com/personal/53edf03465ddcc82/_layouts/15/doc.aspx?resid=e18a3ade-29ce-4e93-a236-9607e02cb018&cid=53edf03465ddcc82)
         * Comportement (lecture seule : événements Salle)
         * Compétences HG (I/F/S/TS) éditables par trimestre  [1](https://onedrive.live.com/personal/53edf03465ddcc82/_layouts/15/doc.aspx?resid=e18a3ade-29ce-4e93-a236-9607e02cb018&cid=53edf03465ddcc82)
         * Participation (compétence calculée : moyenne des fins de séance)
   LIT :
     - Import : getEleves(), getClasses()
     - Events (optionnel) : window.AG_EVENTS (assiduité/participation/comportement)
   ÉCRIT :
     - Modifie les objets élèves en mémoire : genre, groupe, adaptations[0], place
     - Stocke les évaluations HG en mémoire : window.AG_COMP_HG
   HORS-PÉRIMÈTRE :
     - Saisie assiduité / participation (Salle)
     - Génération des bulletins (Bulletins HG)
   ======================================================= */


/* -------------------------------------------------------
   BLOC 1 — RÉFÉRENTIEL COMPÉTENCES HG (figé par tes décisions)
   But : liste unique utilisée dans la modale profil élève.
   Règle : "Participation" est calculée (non éditable).
------------------------------------------------------- */

const COMPETENCES_HG = [
  "Lecture document / consignes",
  "Rédaction / Présentation",
  "Lecture image",
  "Analyse",
  "Culture générale",
  "Apprentissage connaissances",
  "Langage cartographique",
  "Usages numériques",
];

const COMPETENCE_PARTICIPATION = "Participation";

/* Trimestres (sélecteur en haut de modale : choix A validé) */
const TRIMESTRES = ["T1", "T2", "T3"];

/* Adaptations (unique par élève : stockée dans eleve.adaptations[0]) */
const ADAPTATIONS = ["", "PPS", "PAP", "PPRE", "Adaptations", "Adaptations partielles"];

/* Groupes (structure app : classe entière + gr 1 + gr 2) */
const GROUPES = ["classe entière", "gr 1", "gr 2"];


/* -------------------------------------------------------
   BLOC 2 — ÉTAT LOCAL DE PAGE
------------------------------------------------------- */

let classeActive = null;
let elevesClasse = [];


/* -------------------------------------------------------
   BLOC 3 — STORES (lecture/écriture) — sans inventer
   - AG_EVENTS : alimenté par Salle (plus tard)
   - AG_COMP_HG : évaluations HG (stock local en attendant persistance Supabase)
------------------------------------------------------- */

/**
 * Store événements (lecture seule ici)
 * Format attendu si présent :
 * window.AG_EVENTS = {
 *   assiduite: [ { eleveId, date, creneau, type, trimestre? } ... ],
 *   comportement: [ { eleveId, date, creneau, texte, trimestre? } ... ],
 *   participation: [ { eleveId, date, creneau, valeur, trimestre? } ... ]
 * }
 *
 * Si pas présent : on affiche "Aucune donnée enregistrée".
 */
function getEventsStore() {
  return window.AG_EVENTS || { assiduite: [], comportement: [], participation: [] };
}

/**
 * Store évaluations compétences HG
 * Structure :
 * window.AG_COMP_HG[eleveId][trimestre][competence] = "I"|"F"|"S"|"TS"
 */
function getCompStore() {
  if (!window.AG_COMP_HG) window.AG_COMP_HG = {};
  return window.AG_COMP_HG;
}


/* -------------------------------------------------------
   BLOC 4 — INITIALISATION / SÉLECTION CLASSE
   But : rendre la page autonome (onglets issus de l'import)
------------------------------------------------------- */

export function initClassesHG(nomClasse) {
  classeActive = nomClasse;
  elevesClasse = getEleves().filter(e => e.classe === nomClasse);
}

function ensureClasseActive() {
  const classes = getClasses();
  if (!classeActive && classes.length) {
    initClassesHG(classes[0]);
  }
}


/* -------------------------------------------------------
   BLOC 5 — RENDU PRINCIPAL
   Contenu :
     (1) Onglets de classes
     (2) Liste élèves + options modifiables
     (3) Plan de salle 1..30
     (4) Modale profil
------------------------------------------------------- */

export function renderClassesHG() {
  const classes = getClasses();
  ensureClasseActive();

  if (!classes.length) {
    return `
      <div class="page page-classeshg">
        <h1>Classes HG</h1>
        <p>Aucune classe disponible. Importe d’abord des élèves dans Import/Export.</p>
      </div>
    `;
  }

  if (!classeActive) {
    return `
      <div class="page page-classeshg">
        <h1>Classes HG</h1>
        <p>Aucune classe sélectionnée.</p>
      </div>
    `;
  }

  // Rafraîchir à partir de l’import (source centrale)
  elevesClasse = getEleves().filter(e => e.classe === classeActive);

  return `
    <div class="page page-classeshg">

      <!-- (1) Onglets classes -->
      <div class="classes-tabs" id="classesTabs">
        ${classes.map(c => `
          <button class="tab ${c === classeActive ? "active" : ""}" data-classe="${c}">
            ${c}
          </button>
        `).join("")}
      </div>

      <!-- (2) Classe active -->
      <h1>Classe ${classeActive}</h1>

      <!-- (3) Liste élèves + options -->
      <div class="liste-eleves">
        ${elevesClasse
          .slice()
          .sort((a, b) => (a.place ?? 999) - (b.place ?? 999))
          .map(renderEleveRow)
          .join("")}
      </div>

      <!-- (4) Plan de salle : attribution des places -->
      <h2>Plan de salle – attribution des places</h2>
      <div class="plan-salle">
        ${Array.from({ length: 30 }, (_, i) => renderPlace(i + 1)).join("")}
      </div>

      <!-- (5) Modale -->
      <div id="modal"></div>

    </div>
  `;
}


/* -------------------------------------------------------
   BLOC 6 — RENDU ÉLÈVE (ligne cockpit)
   But :
     - Afficher élève
     - Modifier groupe / adaptation / genre (cochables/choix rapides)
     - Clic nom => ouvre profil élève
     - Drag => permet attribution place sur plan
------------------------------------------------------- */

function renderEleveRow(eleve) {
  const groupeActuel = eleve.groupe ?? "classe entière";
  const adaptActuelle = (eleve.adaptations && eleve.adaptations.length) ? eleve.adaptations[0] : "";
  const placeTxt = eleve.place ?? "—";

  return `
    <div class="eleve-row" data-id="${eleve.id}" draggable="true">
      <div class="eleve-ident">
        <button class="eleve-open" data-open="${eleve.id}">
          ${eleve.prenom} ${eleve.nom}
        </button>
        <span class="eleve-place">#${placeTxt}</span>
      </div>

      <div class="eleve-options">

        <label class="opt">
          Genre
          <select class="opt-genre" data-genre="${eleve.id}">
            ${["F","M","Autre"].map(g => `<option value="${g}" ${eleve.genre===g?"selected":""}>${g}</option>`).join("")}
          </select>
        </label>

        <label class="opt">
          Groupe
          <select class="opt-groupe" data-groupe="${eleve.id}">
            ${GROUPES.map(g => `<option value="${g}" ${groupeActuel===g?"selected":""}>${g}</option>`).join("")}
          </select>
        </label>

        <label class="opt">
          Adaptation
          <select class="opt-adapt" data-adapt="${eleve.id}">
            ${ADAPTATIONS.map(a => {
              const lab = a === "" ? "—" : a;
              return `<option value="${a}" ${adaptActuelle===a?"selected":""}>${lab}</option>`;
            }).join("")}
          </select>
        </label>

      </div>
    </div>
  `;
}


/* -------------------------------------------------------
   BLOC 7 — RENDU PLACE (plan 1..30)
   But : afficher la table + prénom si occupée
------------------------------------------------------- */

function renderPlace(numero) {
  const eleve = elevesClasse.find(e => e.place === numero);

  return `
    <div class="place" data-place="${numero}">
      <strong>Table ${numero}</strong>
      ${eleve ? `<div class="place-prenom">${eleve.prenom}</div>` : ""}
    </div>
  `;
}


/* -------------------------------------------------------
   BLOC 8 — BIND EVENTS (interaction page)
------------------------------------------------------- */

export function bindClassesHGEvents() {
  // Onglets classes
  document.querySelectorAll("#classesTabs .tab").forEach(btn => {
    btn.addEventListener("click", () => {
      initClassesHG(btn.dataset.classe);
      rerender();
    });
  });

  // Ouvrir profil élève
  document.querySelectorAll(".eleve-open").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.open);
      const eleve = elevesClasse.find(e => e.id === id);
      if (eleve) ouvrirProfilEleve(eleve);
    });
  });

  // Drag start depuis la ligne élève (déjà draggable=true)
  document.querySelectorAll(".eleve-row").forEach(row => {
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("eleveId", row.dataset.id);
    });
  });

  // Drop sur une place
  document.querySelectorAll(".place").forEach(placeEl => {
    placeEl.addEventListener("dragover", (event) => event.preventDefault());
    placeEl.addEventListener("drop", (event) => {
      event.preventDefault();

      const eleveId = Number(event.dataTransfer.getData("eleveId"));
      const place = Number(placeEl.dataset.place);

      const eleve = elevesClasse.find(e => e.id === eleveId);
      if (!eleve) return;

      // Unicité : libérer l’occupant éventuel
      elevesClasse.forEach(e => { if (e.place === place) e.place = null; });

      eleve.place = place;
      rerender();
    });
  });

  // Modifs rapides (genre/groupe/adaptation)
  document.querySelectorAll(".opt-genre").forEach(sel => {
    sel.addEventListener("change", () => {
      const id = Number(sel.dataset.genre);
      const eleve = elevesClasse.find(e => e.id === id);
      if (!eleve) return;
      eleve.genre = sel.value;
    });
  });

  document.querySelectorAll(".opt-groupe").forEach(sel => {
    sel.addEventListener("change", () => {
      const id = Number(sel.dataset.groupe);
      const eleve = elevesClasse.find(e => e.id === id);
      if (!eleve) return;
      eleve.groupe = (sel.value === "classe entière") ? null : sel.value;
    });
  });

  document.querySelectorAll(".opt-adapt").forEach(sel => {
    sel.addEventListener("change", () => {
      const id = Number(sel.dataset.adapt);
      const eleve = elevesClasse.find(e => e.id === id);
      if (!eleve) return;
      // Adaptation unique stockée dans adaptations[0]
      eleve.adaptations = sel.value ? [sel.value] : [];
    });
  });
}


/* -------------------------------------------------------
   BLOC 9 — MODALE PROFIL ÉLÈVE
   Contenu :
     - Sélecteur trimestre en haut (A)
     - Assiduité (lecture)
     - Comportement (lecture)
     - Compétences HG (édition I/F/S/TS) + Participation (calculée)
------------------------------------------------------- */

function ouvrirProfilEleve(eleve) {
  const events = getEventsStore();
  const compStore = getCompStore();

  // Init store élève
  if (!compStore[eleve.id]) compStore[eleve.id] = {};
  TRIMESTRES.forEach(t => {
    if (!compStore[eleve.id][t]) compStore[eleve.id][t] = {};
  });

  const trimestreDefaut = "T1";

  document.getElementById("modal").innerHTML = `
    <div class="modal profil-eleve" role="dialog" aria-modal="true">

      <!-- En-tête : élève + fermeture -->
      <div class="modal-head">
        <h2>${eleve.prenom} ${eleve.nom}</h2>
        <button class="btn-close" id="closeProfil">✕</button>
      </div>

      <!-- Sélecteur trimestre (en haut : choix A validé) -->
      <div class="trimestres" id="triTabs">
        ${TRIMESTRES.map(t => `
          <button class="tri ${t===trimestreDefaut?"active":""}" data-tri="${t}">${t}</button>
        `).join("")}
      </div>

      <!-- Contenu dynamique par trimestre -->
      <div id="profilBody"></div>

    </div>
  `;

  document.getElementById("closeProfil").onclick = () => {
    document.getElementById("modal").innerHTML = "";
  };

  // Rendu initial
  renderProfilBody(eleve, trimestreDefaut);

  // Tabs trimestre
  document.querySelectorAll("#triTabs .tri").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#triTabs .tri").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderProfilBody(eleve, btn.dataset.tri);
    });
  });
}


function renderProfilBody(eleve, tri) {
  const events = getEventsStore();
  const compStore = getCompStore();

  // Filtre par trimestre SI l’event porte un champ "trimestre"
  // (sinon on affiche tout en lecture, sans inventer une règle de calendrier)
  const filterTri = (arr) => arr.filter(e => e.eleveId === eleve.id).filter(e => !e.trimestre || e.trimestre === tri);

  const ass = filterTri(events.assiduite);
  const comp = filterTri(events.comportement);
  const part = filterTri(events.participation);

  const participationIFST = syntheseParticipationIFST(part);

  // Compétences éditables (8)
  const evals = compStore[eleve.id][tri];

  document.getElementById("profilBody").innerHTML = `
    <div class="bloc">
      <h3>Assiduité (lecture)</h3>
      ${ass.length ? `
        <div class="liste-mini">
          ${ass
            .slice()
            .sort((a,b) => (a.date||"").localeCompare(b.date||""))
            .map(x => `<div class="mini-ligne">${x.date ?? "—"} · ${x.creneau ?? "—"} · ${x.type ?? "—"}</div>`)
            .join("")}
        </div>
      ` : `<div class="hint">Aucune donnée enregistrée.</div>`}
      <div class="hint small">Saisie uniquement en Salle. [1](https://onedrive.live.com/personal/53edf03465ddcc82/_layouts/15/doc.aspx?resid=e18a3ade-29ce-4e93-a236-9607e02cb018&cid=53edf03465ddcc82)</div>
    </div>

    <div class="bloc">
      <h3>Comportement (lecture)</h3>
      ${comp.length ? `
        <div class="liste-mini">
          ${comp
            .slice()
            .sort((a,b) => (a.date||"").localeCompare(b.date||""))
            .map(x => `<div class="mini-ligne">${x.date ?? "—"} · ${x.creneau ?? "—"} · ${escapeHtml(x.texte ?? "")}</div>`)
            .join("")}
        </div>
      ` : `<div class="hint">Aucune donnée enregistrée.</div>`}
    </div>

    <div class="bloc">
      <h3>Participation (calculée)</h3>
      <div class="hint">Niveau : <b>${participationIFST}</b></div>
      ${part.length ? `
        <div class="liste-mini">
          ${part
            .slice()
            .sort((a,b) => (a.date||"").localeCompare(b.date||""))
            .map(x => `<div class="mini-ligne">${x.date ?? "—"} · ${x.creneau ?? "—"} · ${x.valeur ?? "—"}</div>`)
            .join("")}
        </div>
      ` : `<div class="hint">Aucune donnée enregistrée.</div>`}
      <div class="hint small">Saisie en fin d’heure dans Salle. [1](https://onedrive.live.com/personal/53edf03465ddcc82/_layouts/15/doc.aspx?resid=e18a3ade-29ce-4e93-a236-9607e02cb018&cid=53edf03465ddcc82)</div>
    </div>

    <div class="bloc">
      <h3>Compétences HG (I / F / S / TS)</h3>
      <div class="competences">
        ${COMPETENCES_HG.map(label => renderCompetenceRow(eleve.id, tri, label, evals[label] ?? "I")).join("")}
      </div>
      <div class="hint small">Profil HG par trimestre. [1](https://onedrive.live.com/personal/53edf03465ddcc82/_layouts/15/doc.aspx?resid=e18a3ade-29ce-4e93-a236-9607e02cb018&cid=53edf03465ddcc82)</div>
    </div>
  `;

  // Bind boutons compétences
  document.querySelectorAll(".btn-comp").forEach(btn => {
    btn.addEventListener("click", () => {
      const eleveId = Number(btn.dataset.eleveid);
      const tri = btn.dataset.tri;
      const label = btn.dataset.label;
      const val = btn.dataset.val;

      const store = getCompStore();
      if (!store[eleveId]) store[eleveId] = {};
      if (!store[eleveId][tri]) store[eleveId][tri] = {};
      store[eleveId][tri][label] = val;

      // Mise à jour visuelle locale (ligne concernée)
      document.querySelectorAll(`.comp-row[data-label="${cssAttr(label)}"] .btn-comp`).forEach(b => {
        b.classList.toggle("active", b.dataset.val === val);
      });
    });
  });
}


/* -------------------------------------------------------
   BLOC 10 — Rendu d’une compétence (ligne + boutons)
------------------------------------------------------- */

function renderCompetenceRow(eleveId, tri, label, current) {
  const vals = ["I","F","S","TS"];
  return `
    <div class="comp-row" data-label="${escapeAttr(label)}">
      <div class="comp-label">${escapeHtml(label)}</div>
      <div class="comp-btns">
        ${vals.map(v => `
          <button class="btn-comp ${v===current ? "active" : ""}"
                  data-eleveid="${eleveId}"
                  data-tri="${tri}"
                  data-label="${escapeAttr(label)}"
                  data-val="${v}">
            ${v}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}


/* -------------------------------------------------------
   BLOC 11 — Synthèse Participation -> IFST (au plus bas)
------------------------------------------------------- */

function syntheseParticipationIFST(events) {
  if (!events || !events.length) return "—";

  const score = (v) => {
    switch (v) {
      case "perturbateur": return 0;
      case "passif": return 1;
      case "participe": return 2;
      case "moteur": return 3;
      default: return 1;
    }
  };

  const total = events.reduce((acc, e) => acc + score(e.valeur), 0);
  const avg = total / events.length;
  const flo = Math.floor(avg);

  if (flo === 0) return "I";
  if (flo === 1) return "F";
  if (flo === 2) return "S";
  return "TS";
}


/* -------------------------------------------------------
   BLOC 12 — RERENDER PAGE
------------------------------------------------------- */

function rerender() {
  document.getElementById("app").innerHTML = renderClassesHG();
  bindClassesHGEvents();
}


/* -------------------------------------------------------
   BLOC 13 — UTILITAIRES (échappement)
------------------------------------------------------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[m]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function cssAttr(s) {
  // Pour usage dans querySelector, on garde simple (les labels sont stables)
  return s;
}


/* -------------------------------------------------------
   BLOC 14 — ACCÈS MÉTIER (lecture)
------------------------------------------------------- */

export function getElevesClasseHG() {
  return elevesClasse;
}
