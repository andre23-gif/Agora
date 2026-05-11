import { getClassesAvecGroupes } from "./importExport.js";

/* ======================================================
   CRÉNEAUX OFFICIELS
   ====================================================== */

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

/* ======================================================
   ÉTATS MÉTIER
   ====================================================== */

/**
 * Modèle EDT (grille centrale) :
 * [{ jour, creneau, classe, groupe }]
 */
let edtModele = [];

/**
 * EDT appliqué par semaine (clé = lundi ISO YYYY-MM-DD) :
 * { [isoLundi]: [{ jour, creneau, classe, groupe }] }
 */
let edtParSemaine = {};

/**
 * Meta par semaine :
 * { [isoLundi]: { type, trimestre, semestre } }
 */
let metaParSemaine = {};

/**
 * Liste des semaines générées automatiquement :
 * [{ numero, lundi: Date }]
 */
let semaines = [];

/**
 * Semaine de référence (bandeau) : index dans semaines
 */
let semaineRefIndex = 0;

/**
 * Semaines cibles (colonne gauche) : Set<isoLundi>
 */
let semainesCibles = new Set();

/**
 * Contexte bandeau (appliqué au moment du Valider)
 */
let contexte = {
  type: "A",        // A / B / V
  trimestre: "T1",  // T1 / T2 / T3
  semestre: "S1",   // S1 / S2
};

/* ======================================================
   OUTILS DATES
   ====================================================== */

function mondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7; // dimanche => 7
  if (day !== 1) d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function formatFR(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function anneeDebut() {
  const s = String(window.appAnneeCourante || "2024-2025");
  const m = s.match(/^(\d{4})/);
  return m ? Number(m[1]) : new Date().getFullYear();
}

/* ======================================================
   GÉNÉRATION DES SEMAINES
   Règle : première semaine qui inclut le 1er septembre
   Numérotation établissement : 1..52
   ====================================================== */

function genererSemaines() {
  const y = anneeDebut();
  const sept1 = new Date(y, 8, 1); // 1er septembre
  let lundi = mondayOfWeek(sept1);

  const out = [];
  for (let i = 0; i < 52; i++) {
    out.push({
      numero: i + 1,
      lundi: new Date(lundi),
    });
    lundi.setDate(lundi.getDate() + 7);
  }
  return out;
}

/* ======================================================
   INIT
   ====================================================== */

export function initEmploiDuTemps() {
  semaines = genererSemaines();
  semaineRefIndex = 0;
  semainesCibles = new Set();
}

/* ======================================================
   RENDU PRINCIPAL (3 PARTIES)
   ====================================================== */

export function renderEmploiDuTemps() {
  if (semaines.length === 0) initEmploiDuTemps();

  const semRef = semaines[semaineRefIndex];
  const isoRef = toISO(semRef.lundi);

  // Si cette semaine a déjà des meta enregistrées, on les affiche à droite du label (lecture)
  const metaRef = metaParSemaine[isoRef];
  const metaRefTxt = metaRef ? `${metaRef.type} ${metaRef.trimestre} ${metaRef.semestre}` : "";

  return `
    <section class="edt-page">

      <!-- =========================
           BANDEAU HAUT (options)
           ========================= -->
      <div class="edt-topbar">

        <button id="edtPrevWeek">◀</button>

        <div class="edt-weeklabel">
          <strong>S${semRef.numero}</strong> — lundi ${formatFR(semRef.lundi)}
          <span class="edt-meta-ref">${metaRefTxt}</span>
        </div>

        <button id="edtNextWeek">▶</button>

        <select id="edtWeekSelect">
          ${semaines.map((s, idx) => `
            <option value="${idx}" ${idx === semaineRefIndex ? "selected" : ""}>
              S${s.numero} — ${formatFR(s.lundi)}
            </option>
          `).join("")}
        </select>

        <div class="edt-spacer"></div>

        <div class="edt-options">
          <span class="edt-label">Type</span>
          ${renderChoix("type", ["A", "B", "V"], contexte.type)}

          <span class="edt-label">Trimestre</span>
          ${renderChoix("trimestre", ["T1", "T2", "T3"], contexte.trimestre)}

          <span class="edt-label">Semestre</span>
          ${renderChoix("semestre", ["S1", "S2"], contexte.semestre)}
        </div>

        <button id="edtValider">Valider</button>

      </div>

      <!-- =========================
           CORPS : gauche + droite
           ========================= -->
      <div class="edt-body">

        <!-- Encadré gauche : semaines cibles -->
        <div class="edt-leftpanel">
          <div class="edt-panel-title">Semaines cibles</div>

          <div class="edt-weeklist">
            ${semaines.map(renderSemaineCheckbox).join("")}
          </div>
        </div>

        <!-- Encadré droit : semainier -->
        <div class="edt-rightpanel">
          <div class="edt-panel-title">Semainier (modèle)</div>

          <div class="edt-gridwrap">
            ${renderGrille()}
          </div>
        </div>

      </div>

      <!-- Modale -->
      <div id="edtModal"></div>

    </section>
  `;
}

/* ======================================================
   BANDEAU : rendu des groupes de choix
   ====================================================== */

function renderChoix(cle, valeurs, actif) {
  return `
    <span class="edt-choicegroup">
      ${valeurs.map(v => `
        <button class="edt-choice ${v === actif ? "on" : ""}"
                data-cle="${cle}" data-val="${v}">
          ${v}
        </button>
      `).join("")}
    </span>
  `;
}

/* ======================================================
   Colonne gauche : lignes semaine + checkbox
   ====================================================== */

function renderSemaineCheckbox(s) {
  const iso = toISO(s.lundi);
  const checked = semainesCibles.has(iso) ? "checked" : "";
  const meta = metaParSemaine[iso];
  const tag = meta ? `${meta.type} ${meta.trimestre} ${meta.semestre}` : "";

  return `
    <label class="edt-weekrow">
      <input type="checkbox" data-iso="${iso}" ${checked}>
      <span class="edt-weektxt">S${s.numero} — ${formatFR(s.lundi)}</span>
      <span class="edt-weektag">${tag}</span>
    </label>
  `;
}

/* ======================================================
   Grille : jours × créneaux (code + horaires)
   ====================================================== */

function renderGrille() {
  return `
    <table class="edt-grid">
      <tr>
        <th class="edt-c0"></th>
        ${JOURS.map(j => `<th class="edt-head">${capitalize(j)}</th>`).join("")}
      </tr>

      ${CRENEAUX.map(renderLigne).join("")}
    </table>
  `;
}

function renderLigne(cr) {
  return `
    <tr>
      <th class="edt-creneau">
        ${cr.code}<br><small>${cr.debut}–${cr.fin}</small>
      </th>

      ${JOURS.map(j => renderCell(j, cr.code)).join("")}
    </tr>
  `;
}

function renderCell(jour, creneau) {
  if (creneau === "PM") {
    return `<td class="edt-cell off">—</td>`;
  }

  const ligne = edtModele.find(l => l.jour === jour && l.creneau === creneau);
  const txt = ligne
    ? (ligne.groupe ? `${ligne.classe} ${ligne.groupe}` : ligne.classe)
    : "&nbsp;";

  return `
    <td class="edt-cell"
        data-jour="${jour}"
        data-creneau="${creneau}">
      ${txt}
    </td>
  `;
}

/* ======================================================
   EVENTS
   ====================================================== */

export function bindEmploiDuTempsEvents() {
  // Navigation semaine ref
  document.getElementById("edtPrevWeek").onclick = () => {
    semaineRefIndex = Math.max(0, semaineRefIndex - 1);
    rerender();
  };

  document.getElementById("edtNextWeek").onclick = () => {
    semaineRefIndex = Math.min(semaines.length - 1, semaineRefIndex + 1);
    rerender();
  };

  document.getElementById("edtWeekSelect").onchange = (e) => {
    semaineRefIndex = Number(e.target.value);
    rerender();
  };

  // Options du bandeau
  document.querySelectorAll(".edt-choice").forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      contexte[btn.dataset.cle] = btn.dataset.val;
      rerender();
    };
  });

  // Checkbox semaines cibles
  document.querySelectorAll(".edt-weekrow input[type='checkbox']").forEach(cb => {
    cb.onchange = () => {
      const iso = cb.dataset.iso;
      if (cb.checked) semainesCibles.add(iso);
      else semainesCibles.delete(iso);
    };
  });

  // Clic cellule
  document.querySelectorAll(".edt-cell").forEach(cell => {
    cell.onclick = () => {
      if (cell.classList.contains("off")) return;
      const jour = cell.dataset.jour;
      const creneau = cell.dataset.creneau;
      ouvrirModal(jour, creneau);
    };
  });

  // Valider
  document.getElementById("edtValider").onclick = appliquer;
}

/* ======================================================
   MODALE : choisir classe / groupe
   ====================================================== */

function ouvrirModal(jour, creneau) {
  const classes = getClassesAvecGroupes();

  const current = edtModele.find(l => l.jour === jour && l.creneau === creneau);
  const currentVal = current ? `${current.classe}|${current.groupe ?? ""}` : "";

  const options = classes.length
    ? classes.map(c => {
        const val = `${c.classe}|${c.groupe ?? ""}`;
        const sel = val === currentVal ? "selected" : "";
        return `<option value="${val}" ${sel}>${c.label}</option>`;
      }).join("")
    : `<option value="">(Importer d’abord des élèves pour obtenir les classes)</option>`;

  document.getElementById("edtModal").innerHTML = `
    <div class="modal">
      <h2>${capitalize(jour)} — ${creneau}</h2>

      <label>Affectation</label>
      <select id="edtSelect" ${classes.length ? "" : "disabled"}>
        ${options}
      </select>

      <div style="margin-top:1em;">
        <button id="edtOk" ${classes.length ? "" : "disabled"}>OK</button>
        <button id="edtClear">Vider</button>
        <button id="edtCancel">Annuler</button>
      </div>
    </div>
  `;

  document.getElementById("edtCancel").onclick = fermerModal;

  document.getElementById("edtClear").onclick = () => {
    edtModele = edtModele.filter(l => !(l.jour === jour && l.creneau === creneau));
    fermerModal();
    rerender();
  };

  document.getElementById("edtOk").onclick = () => {
    const value = document.getElementById("edtSelect").value;
    if (!value) return;

    const [classe, groupeRaw] = value.split("|");
    const groupe = groupeRaw ? groupeRaw : null;

    const idx = edtModele.findIndex(l => l.jour === jour && l.creneau === creneau);
    const ligne = { jour, creneau, classe, groupe };

    if (idx === -1) edtModele.push(ligne);
    else edtModele[idx] = ligne;

    fermerModal();
    rerender();
  };
}

function fermerModal() {
  document.getElementById("edtModal").innerHTML = "";
}

/* ======================================================
   APPLICATION : copie du modèle sur les semaines cochées
   ====================================================== */

function appliquer() {
  if (semainesCibles.size === 0) return;

  semainesCibles.forEach(iso => {
    metaParSemaine[iso] = {
      type: contexte.type,
      trimestre: contexte.trimestre,
      semestre: contexte.semestre
    };

    if (contexte.type === "V") {
      edtParSemaine[iso] = [];
    } else {
      edtParSemaine[iso] = edtModele.map(l => ({ ...l }));
    }
  });

  semainesCibles.clear();
  rerender();
}

/* ======================================================
   RERENDER
   ====================================================== */

function rerender() {
  const app = document.getElementById("app");
  app.innerHTML = renderEmploiDuTemps();
  bindEmploiDuTempsEvents();
}

/* ======================================================
   ACCÈS MÉTIER POUR SALLE
   ====================================================== */

export function getEDT() {
  return { edtParSemaine, metaParSemaine };
}

export function setEDT(state) {
  if (!state) return;
  if (state.edtParSemaine) edtParSemaine = state.edtParSemaine;
  if (state.metaParSemaine) metaParSemaine = state.metaParSemaine;
}
