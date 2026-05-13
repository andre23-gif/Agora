import { getEleves, getClasses } from "./importExport.js";

/* =======================================================
   PAGE : Classes HG
   RÔLE MÉTIER :
     - Cockpit de classe HG : navigation par onglets (1 onglet = 1 classe importée)
     - Paramétrage élève (ligne) : adaptation (unique) + place (facultative)
     - Profil élève (modale) :
         * Assiduité (lecture seule : saisie uniquement en Salle)
         * Comportement (lecture seule : événements Salle)
         * Compétences HG (I/F/S/TS) éditables par trimestre
         * Participation (compétence calculée : moyenne des fins de séance)
   LIT :
     - Import : getEleves(), getClasses()
     - Events (optionnel) : window.AG_EVENTS (assiduité/participation/comportement)
   ÉCRIT :
     - Modifie les objets élèves en mémoire : adaptations[0], place
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

/* Places (facultatives) : Table 1..30 */
const PLACES = Array.from({ length: 30 }, (_, i) => i + 1);


/* -------------------------------------------------------
   BLOC 2 — ÉTAT LOCAL DE PAGE
------------------------------------------------------- */

let classeActive = null;
let elevesClasse = [];


/* -------------------------------------------------------
   BLOC 3 — STORES (lecture/écriture) — sans inventer
   - AG_EVENTS : alimenté par Salle (plus tard)
   - AG_COMP_HG : évaluations HG (stock local en attendant persistance)
------------------------------------------------------- */

function getEventsStore() {
  return window.AG_EVENTS || { assiduite: [], comportement: [], participation: [] };
}

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
     (2) Liste élèves + 2 menus (Adaptation / Place)
     (3) Modale profil
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
          // === AG_SORT_NOM_PRENOM_V1 ===
          .sort((a, b) => {
            const n = (a.nom || "").localeCompare(b.nom || "", "fr");
            if (n !== 0) return n;
            return (a.prenom || "").localeCompare(b.prenom || "", "fr");
          })
          .map(renderEleveRow)
          .join("")}
      </div>

      <!-- (4) Modale -->
      <div id="modal"></div>

    </div>
  `;
}


/* -------------------------------------------------------
   BLOC 6 — RENDU ÉLÈVE (ligne cockpit)
   But :
     - Afficher élève (NOM Prénom)
     - 2 menus : Adaptation / Place
     - Clic nom => ouvre profil élève
   Note :
     - Pas de drag & drop (supprimé)
------------------------------------------------------- */

function renderEleveRow(eleve) {
  const adaptActuelle = (eleve.adaptations && eleve.adaptations.length) ? eleve.adaptations[0] : "";
  const placeActuelle = (typeof eleve.place === "number") ? eleve.place : "";

  return `
    <div class="eleve-row" data-id="${eleve.id}">
      <div class="eleve-ident">
        <button class="eleve-open" data-open="${eleve.id}">
          ${eleve.nom} ${eleve.prenom}
        </button>
      </div>

      <div class="eleve-options">

        <label class="opt">
          Adaptation
          <select class="opt-adapt" data-adapt="${eleve.id}">
            ${ADAPTATIONS.map(a => {
              const lab = a === "" ? "—" : a;
              return `<option value="${a}" ${adaptActuelle === a ? "selected" : ""}>${lab}</option>`;
            }).join("")}
          </select>
        </label>

        <label class="opt">
          Place
          <select class="opt-place" data-place="${eleve.id}">
            <option value="">—</option>
            ${renderPlaceOptions(placeActuelle)}
          </select>
        </label>

      </div>
    </div>
  `;
}


/* -------------------------------------------------------
   BLOC 7 — OPTIONS PLACES (Table 1..30)
   But : construire la liste des options "Table n"
------------------------------------------------------- */

function renderPlaceOptions(current) {
  const currentNum = current === "" ? null : Number(current);
  return PLACES.map(p => {
    const sel = (currentNum === p) ? "selected" : "";
    return `<option value="${p}" ${sel}>Table ${p}</option>`;
  }).join("");
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
      const id = btn.dataset.open;
      const eleve = elevesClasse.find(e => String(e.id) === String(id));
      if (eleve) ouvrirProfilEleve(eleve);
    });
  });

  // Adaptation (unique)
  document.querySelectorAll(".opt-adapt").forEach(sel => {
    sel.addEventListener("change", () => {
      const id = sel.dataset.adapt;
      const eleve = elevesClasse.find(e => String(e.id) === String(id));
      if (!eleve) return;

      eleve.adaptations = sel.value ? [sel.value] : [];
      rerender();
    });
  });

  // Place (facultative) — règle collision : remplacement automatique
  document.querySelectorAll(".opt-place").forEach(sel => {
    sel.addEventListener("change", () => {
      const id = sel.dataset.place;
      const eleve = elevesClasse.find(e => String(e.id) === String(id));
      if (!eleve) return;

      const place = sel.value ? Number(sel.value) : null;

      if (place !== null) {
        // Unicité : libérer l’occupant éventuel (règle A = remplacement auto)
        elevesClasse.forEach(e => {
          if (e.place === place) e.place = null;
        });
      }

      eleve.place = place;
      rerender();
    });
  });
}


/* -------------------------------------------------------
   BLOC 9 — MODALE PROFIL ÉLÈVE
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

      <!-- Sélecteur trimestre -->
      <div class="trimestres" id="triTabs">
        ${TRIMESTRES.map(t => `
          <button class="tri ${t === trimestreDefaut ? "active" : ""}" data-tri="${t}">${t}</button>
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

  const filterTri = (arr) =>
    arr.filter(e => e.eleveId === eleve.id).filter(e => !e.trimestre || e.trimestre === tri);

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
      <div class="hint small">Saisie uniquement en Salle.</div>
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
      <div class="hint small">Saisie en fin d’heure dans Salle.</div>
    </div>

    <div class="bloc">
      <h3>Compétences HG (I / F / S / TS)</h3>
      <div class="competences">
        ${COMPETENCES_HG.map(label => renderCompetenceRow(eleve.id, tri, label, evals[label] ?? "I")).join("")}
      </div>
      <div class="hint small">Profil HG par trimestre.</div>
    </div>
  `;

  // Bind boutons compétences
  document.querySelectorAll(".btn-comp").forEach(btn => {
    btn.addEventListener("click", () => {
      const eleveId = btn.dataset.eleveid;
      const tri = btn.dataset.tri;
      const label = btn.dataset.label;
      const val = btn.dataset.val;

      const store = getCompStore();
      if (!store[eleveId]) store[eleveId] = {};
      if (!store[eleveId][tri]) store[eleveId][tri] = {};
      store[eleveId][tri][label] = val;

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
          <button class="btn-comp ${v === current ? "active" : ""}"
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
  return s;
}


/* -------------------------------------------------------
   BLOC 14 — ACCÈS MÉTIER (lecture)
------------------------------------------------------- */

export function getElevesClasseHG() {
  return elevesClasse;
}
``
