/* =========================================================
   EMPLOI DU TEMPS — AGORAMOSAÏQUE (v1.0)
   Semaine (A/B/V) + Trimestre (T1/T2/T3) + Semestre (S1/S2)
   Édition par grille + modale par créneau
   ========================================================= */

import { getEleves } from "./importExport.js";

/* ============================
   CRÉNEAUX OFFICIELS COLLÈGE
   ============================ */

export const CRENEAUX = [
  { code: "M1", debut: "08:30", fin: "09:25" },
  { code: "M2", debut: "09:25", fin: "10:20" },
  { code: "M3", debut: "10:35", fin: "11:30" },
  { code: "M4", debut: "11:30", fin: "12:30" },
  { code: "PM", debut: "12:30", fin: "13:55" },
  { code: "S1", debut: "13:55", fin: "14:55" },
  { code: "S2", debut: "14:55", fin: "15:50" },
  { code: "S3", debut: "16:05", fin: "17:05" },
  { code: "S4", debut: "17:05", fin: "18:00" },
];

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];

/* ============================
   ÉTATS MÉTIER
   ============================ */

// Année scolaire courante (ex: "2024-2025")
let anneeScolaire = (window.appAnneeCourante || "2024-2025");

// Semaines générées automatiquement (lundi + numéro + A/B/V + T + S)
let semaines = [];

// Semaine sélectionnée (index)
let semaineIndex = 0;

// Brouillon d’édition semaine (A/B/V + T + S) → appliqué seulement à validation
let draftSemaine = null;

// EDT : lignes d’affectation
// { semaine: "A"|"B"|"toutes", jour:"lundi"... , creneau:"M1"... , classe:"6°1", groupe:null|"gr 1"|"gr 2" }
let edt = [];

/* ============================
   OUTILS DATES
   ============================ */

function parseAnneeDebut(anneeStr) {
  // "2024-2025" -> 2024
  const m = String(anneeStr).match(/^(\d{4})/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function mondayOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=dimanche ... 1=lundi
  const diff = (day === 0 ? -6 : 1) - day; // ramène au lundi
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function formatFR(d) {
  // dd/mm
  const da = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${da}/${mo}`;
}

/* ============================
   GÉNÉRATION DES SEMAINES
   ============================ */

function genererSemaines(anneeStr) {
  const debut = parseAnneeDebut(anneeStr);

  // Règle : l’année commence à la première semaine qui inclut le 1er septembre
  const sept1 = new Date(debut, 8, 1); // mois 8 = septembre
  const startMonday = mondayOfWeek(sept1);

  // fin : on génère jusqu’à fin août de l’année suivante (couverture large)
  const endDate = new Date(debut + 1, 7, 31); // 31 août
  endDate.setHours(0, 0, 0, 0);

  const out = [];
  let i = 0;
  let cur = new Date(startMonday);

  while (cur <= endDate) {
    out.push({
      lundi: new Date(cur),
      numero: i + 1,         // numérotation établissement : 1,2,3…
      type: "A",             // par défaut
      trimestre: "T1",       // par défaut
      semestre: "S1",        // par défaut
    });
    cur = addDays(cur, 7);
    i++;
  }

  return out;
}

/* ============================
   CLASSES PROPOSÉES (IMPORT)
   ============================ */

function getClassesProposees() {
  const eleves = getEleves();
  const classes = [...new Set(eleves.map(e => e.classe).filter(Boolean))].sort();

  // Pour chaque classe X, proposer X / X gr 1 / X gr 2
  const propositions = [];
  classes.forEach(c => {
    propositions.push({ label: c, classe: c, groupe: null });
    propositions.push({ label: `${c} gr 1`, classe: c, groupe: "gr 1" });
    propositions.push({ label: `${c} gr 2`, classe: c, groupe: "gr 2" });
  });

  return propositions;
}

/* ============================
   MÉTIER : SEMAINE COURANTE
   ============================ */

export function getSemaineCourante(date = new Date()) {
  const lundi = mondayOfWeek(date);
  const iso = toISODate(lundi);

  const idx = semaines.findIndex(s => toISODate(s.lundi) === iso);
  if (idx === -1) return null;

  return { ...semaines[idx], index: idx };
}

/* ============================
   MÉTIER : CONTEXTE COURANT
   ============================ */

export function getContexteCourant(date = new Date()) {
  const sem = getSemaineCourante(date);
  if (!sem) return null;

  // Vacances => pas de contexte
  if (sem.type === "V") return null;

  const jour = JOURS[new Date(date).getDay() - 1]; // lundi=1 => index 0
  if (!jour) return null;

  const heure = date.toTimeString().slice(0, 5);

  const creneau = CRENEAUX.find(c => c.debut <= heure && heure < c.fin)?.code;
  if (!creneau || creneau === "PM") return null;

  const ligne = edt.find(l =>
    l.jour === jour &&
    l.creneau === creneau &&
    (l.semaine === sem.type || l.semaine === "toutes")
  );

  if (!ligne) return null;

  return {
    ...ligne,
    semaine: sem.type,
    trimestre: sem.trimestre,
    semestre: sem.semestre,
    lundi: sem.lundi,
    numeroSemaine: sem.numero
  };
}

/* ============================
   ACCÈS / MODIFICATION EDT
   ============================ */

export function getEDT() {
  return edt;
}

export function setEDT(nouvelEDT) {
  edt = Array.isArray(nouvelEDT) ? nouvelEDT : [];
}

/* ============================
   INITIALISATION PAGE
   ============================ */

export function initEmploiDuTemps() {
  semaines = genererSemaines(anneeScolaire);
  semaineIndex = 0;
  draftSemaine = null;
}

/* ============================
   UI : RENDU PRINCIPAL
   ============================ */

export function renderEmploiDuTemps() {
  if (!semaines.length) initEmploiDuTemps();

  const sem = semaines[semaineIndex];
  const semFR = formatFR(sem.lundi);

  return `
    <section>
      <h1>Emploi du temps</h1>

      <div class="edt-top">
        <div>
          <strong>Année scolaire :</strong>
          <select id="edtAnnee">
            ${renderOptionsAnnees(anneeScolaire)}
          </select>
        </div>

        <div>
          <strong>Semaine sélectionnée :</strong>
          S${sem.numero} (lundi ${semFR})
        </div>
      </div>

      <div class="edt-layout">

        <aside class="edt-semaines">
          <h2>Semaines</h2>
          <div class="edt-semaines-list">
            ${semaines.map((s, idx) => renderSemaineRow(s, idx)).join("")}
          </div>

          <div class="edt-semaine-editor">
            <h3>Édition semaine</h3>
            ${renderEditorSemaine(sem)}
          </div>
        </aside>

        <main class="edt-grille">
          <h2>Grille hebdomadaire</h2>
          ${renderGrille(sem)}
        </main>

      </div>

      <div id="edtModal"></div>
    </section>
  `;
}

function renderOptionsAnnees(selected) {
  // propose quelques années autour
  const base = parseAnneeDebut(selected);
  const years = [base - 1, base, base + 1].map(y => `${y}-${y + 1}`);
  return years.map(y => `<option value="${y}" ${y === selected ? "selected" : ""}>${y}</option>`).join("");
}

function renderSemaineRow(s, idx) {
  const active = idx === semaineIndex ? " edt-semaine-active" : "";
  return `
    <div class="edt-semaine-row${active}" data-week-index="${idx}">
      <div class="edt-semaine-left">
        <strong>S${s.numero}</strong> — ${formatFR(s.lundi)}
      </div>
      <div class="edt-semaine-right">
        <span class="tag">${s.type}</span>
        <span class="tag">${s.trimestre}</span>
        <span class="tag">${s.semestre}</span>
      </div>
    </div>
  `;
}

function renderEditorSemaine(s) {
  // draft = copie éditable. si null, on la crée à partir de la semaine actuelle
  const d = draftSemaine ?? { ...s };

  return `
    <div class="edt-editor-line">
      <label>Type :</label>
      <div class="edt-choices">
        ${renderChoice("type", "A", d.type)}
        ${renderChoice("type", "B", d.type)}
        ${renderChoice("type", "V", d.type)}
      </div>
    </div>

    <div class="edt-editor-line">
      <label>Trimestre :</label>
      <div class="edt-choices">
        ${renderChoice("trimestre", "T1", d.trimestre)}
        ${renderChoice("trimestre", "T2", d.trimestre)}
        ${renderChoice("trimestre", "T3", d.trimestre)}
      </div>
    </div>

    <div class="edt-editor-line">
      <label>Semestre :</label>
      <div class="edt-choices">
        ${renderChoice("semestre", "S1", d.semestre)}
        ${renderChoice("semestre", "S2", d.semestre)}
      </div>
    </div>

    <button id="edtValiderSemaine">Valider la semaine</button>
  `;
}

function renderChoice(field, value, current) {
  const on = value === current ? " choice-on" : "";
  return `<button class="choice${on}" data-field="${field}" data-value="${value}">${value}</button>`;
}

function renderGrille(sem) {
  if (sem.type === "V") {
    return `<p><strong>Vacances :</strong> aucun cours sur cette semaine.</p>`;
  }

  const header = `
    <div class="edt-row edt-header">
      <div class="edt-cell edt-c0"></div>
      ${JOURS.map(j => `<div class="edt-cell edt-head">${capitalize(j)}</div>`).join("")}
    </div>
  `;

  const rows = CRENEAUX.map(c => renderGrilleRow(c, sem)).join("");

  return `<div class="edt-table">${header}${rows}</div>`;
}

function renderGrilleRow(cr, sem) {
  // PM reste affiché (c’est un créneau), mais non éditable (pas de cours)
  const nonCours = (cr.code === "PM");
  return `
    <div class="edt-row">
      <div class="edt-cell edt-c0">
        <strong>${cr.code}</strong><br>
        <span class="edt-time">${cr.debut}–${cr.fin}</span>
      </div>

      ${JOURS.map(j => renderCell(j, cr.code, sem, nonCours)).join("")}
    </div>
  `;
}

function renderCell(jour, creneau, sem, nonCours) {
  if (nonCours) {
    return `<div class="edt-cell edt-off">—</div>`;
  }

  const type = sem.type; // A ou B
  const ligne = edt.find(l =>
    l.jour === jour && l.creneau === creneau && l.semaine === type
  );

  const label = ligne
    ? (ligne.groupe ? `${ligne.classe} ${ligne.groupe}` : `${ligne.classe}`)
    : "";

  const filled = label ? " edt-filled" : "";
  return `
    <div class="edt-cell edt-slot${filled}"
         data-jour="${jour}"
         data-creneau="${creneau}">
      ${label || ""}
    </div>
  `;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ============================
   UI : MODALE CRÉNEAU
   ============================ */

function openCreneauModal(jour, creneau) {
  const sem = semaines[semaineIndex];
  if (sem.type === "V" || creneau === "PM") return;

  const propositions = getClassesProposees();
  const haveProps = propositions.length > 0;

  const current = edt.find(l =>
    l.jour === jour &&
    l.creneau === creneau &&
    l.semaine === sem.type
  );

  const currentLabel = current
    ? (current.groupe ? `${current.classe} ${current.groupe}` : `${current.classe}`)
    : "—";

  const options = haveProps
    ? propositions.map(p => {
        const val = `${p.classe}|${p.groupe ?? ""}`;
        const selected =
          current && current.classe === p.classe && (current.groupe ?? "") === (p.groupe ?? "")
            ? "selected"
            : "";
        return `<option value="${val}" ${selected}>${p.label}</option>`;
      }).join("")
    : `<option value="">(Aucune classe importée — importer d’abord des élèves)</option>`;

  document.getElementById("edtModal").innerHTML = `
    <div class="modal">
      <h2>${capitalize(jour)} — ${creneau}</h2>
      <p><strong>Semaine :</strong> S${sem.numero} (${sem.type}) — lundi ${formatFR(sem.lundi)}</p>
      <p><strong>Actuel :</strong> ${currentLabel}</p>

      <label>Affectation :</label>
      <select id="edtSelectAffectation" ${haveProps ? "" : "disabled"}>
        ${options}
      </select>

      <div style="margin-top:1em;">
        <button id="edtSaveAffectation" ${haveProps ? "" : "disabled"}>Enregistrer</button>
        <button id="edtClearAffectation">Vider</button>
        <button id="edtCloseModal">Fermer</button>
      </div>
    </div>
  `;

  document.body.classList.add("modal-open");

  document.getElementById("edtCloseModal").onclick = closeModal;

  document.getElementById("edtClearAffectation").onclick = () => {
    // supprimer la ligne EDT correspondante
    edt = edt.filter(l =>
      !(l.jour === jour && l.creneau === creneau && l.semaine === sem.type)
    );
    closeModal();
    rerenderEDT();
  };

  document.getElementById("edtSaveAffectation").onclick = () => {
    const sel = document.getElementById("edtSelectAffectation").value;
    if (!sel) return;

    const [classe, groupeRaw] = sel.split("|");
    const groupe = groupeRaw ? groupeRaw : null;

    // remplacer ou créer
    const idx = edt.findIndex(l =>
      l.jour === jour && l.creneau === creneau && l.semaine === sem.type
    );

    const ligne = { semaine: sem.type, jour, creneau, classe, groupe };

    if (idx === -1) edt.push(ligne);
    else edt[idx] = ligne;

    closeModal();
    rerenderEDT();
  };
}

function closeModal() {
  document.getElementById("edtModal").innerHTML = "";
  document.body.classList.remove("modal-open");
}

/* ============================
   UI : RERENDER
   ============================ */

function rerenderEDT() {
  // on rerend la page EDT complète
  const app = document.getElementById("app");
  app.innerHTML = renderEmploiDuTemps();
  bindEmploiDuTempsEvents();
}

/* ============================
   EVENTS
   ============================ */

export function bindEmploiDuTempsEvents() {
  // Changement année scolaire -> regen semaines
  const anSel = document.getElementById("edtAnnee");
  if (anSel) {
    anSel.onchange = () => {
      anneeScolaire = anSel.value;
      window.appAnneeCourante = anneeScolaire;
      semaines = genererSemaines(anneeScolaire);
      semaineIndex = 0;
      draftSemaine = null;
      rerenderEDT();
    };
  }

  // Sélection semaine
  document.querySelectorAll(".edt-semaine-row").forEach(row => {
    row.onclick = () => {
      semaineIndex = Number(row.dataset.weekIndex);
      draftSemaine = null;
      rerenderEDT();
    };
  });

  // Choix draft (type / trimestre / semestre) -> modifie draft, mais pas la semaine tant que pas validé
  document.querySelectorAll(".choice").forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      const sem = semaines[semaineIndex];
      const field = btn.dataset.field;
      const value = btn.dataset.value;

      draftSemaine = draftSemaine ?? { ...sem };
      draftSemaine[field] = value;

      // re-render editor seulement (simple : on rerend la page)
      rerenderEDT();
    };
  });

  // Valider semaine
  const valBtn = document.getElementById("edtValiderSemaine");
  if (valBtn) {
    valBtn.onclick = () => {
      if (!draftSemaine) return;

      // Appliquer au modèle
      semaines[semaineIndex] = {
        ...semaines[semaineIndex],
        type: draftSemaine.type,
        trimestre: draftSemaine.trimestre,
        semestre: draftSemaine.semestre
      };

      draftSemaine = null;
      rerenderEDT();
    };
  }

  // Clic cellule EDT -> modale
  document.querySelectorAll(".edt-slot").forEach(cell => {
    cell.onclick = () => {
      const sem = semaines[semaineIndex];
      if (sem.type === "V") return;

      const jour = cell.dataset.jour;
      const creneau = cell.dataset.creneau;
      openCreneauModal(jour, creneau);
    };
  });
}

/* ============================
   STYLES MINIMUM (classes utilisées)
   (Le style final reste dans style.css)
   ============================ */
/*
Classes HTML utilisées :
- .edt-top, .edt-layout, .edt-semaines, .edt-semaines-list, .edt-semaine-row, .edt-semaine-active
- .edt-editor-line, .edt-choices, .choice, .choice-on
- .edt-grille, .edt-table, .edt-row, .edt-cell, .edt-c0, .edt-head, .edt-time
- .edt-slot, .edt-filled, .edt-off
- #edtModal (conteneur modale), .modal (carte modale)
*/
