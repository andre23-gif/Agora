import { getClassesAvecGroupes } from "./importExport.js";

/* ======================================================
   CONSTANTES MÉTIER
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
   ÉTATS
   ====================================================== */

// EDT modèle en cours d’édition (grille centrale)
let edtModele = [];

// EDT appliqué aux semaines
let edtParSemaine = {}; 
// clé = lundi ISO (YYYY-MM-DD) → tableau d’entrées EDT

// Semaines générées automatiquement
let semaines = [];

// Semaines cochées (colonne gauche)
let semainesCibles = new Set();

// Contexte du bandeau
let contexte = {
  semaineRefIndex: 0,
  type: "A",        // A / B / V
  trimestre: "T1", // T1 / T2 / T3
  semestre: "S1",  // S1 / S2
};

/* ======================================================
   OUTILS DATES
   ====================================================== */

function mondayOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay() || 7;
  if (day !== 1) date.setDate(date.getDate() - day + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function formatFR(d) {
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
}

/* ======================================================
   GÉNÉRATION DES SEMAINES
   ====================================================== */

function genererSemaines() {
  const debutAnnee = new Date(`${window.appAnneeCourante.split("-")[0]}-09-01`);
  let lundi = mondayOfWeek(debutAnnee);
  const fin = new Date(lundi);
  fin.setDate(fin.getDate() + 7 * 52);

  const out = [];
  let numero = 1;

  while (lundi <= fin) {
    out.push({
      numero,
      lundi: new Date(lundi),
    });
    lundi.setDate(lundi.getDate() + 7);
    numero++;
  }

  return out;
}

/* ======================================================
   RENDU PRINCIPAL
   ====================================================== */

export function renderEmploiDuTemps() {
  if (semaines.length === 0) semaines = genererSemaines();

  const semRef = semaines[contexte.semaineRefIndex];

  return `
    <section>

      <!-- BANDEAU -->
      <div class="edt-bandeau">
        <button id="prevWeek">◀</button>

        <strong>
          S${semRef.numero} — lundi ${formatFR(semRef.lundi)}
        </strong>

        <button id="nextWeek">▶</button>

        <span class="spacer"></span>

        ${renderChoix("type", ["A","B","V"], contexte.type)}
        ${renderChoix("trimestre", ["T1","T2","T3"], contexte.trimestre)}
        ${renderChoix("semestre", ["S1","S2"], contexte.semestre)}

        <button id="validerEDT">Valider</button>
      </div>

      <div class="edt-layout">

        <!-- COLONNE SEMAINES -->
        <aside class="edt-semaines">
          ${semaines.map(renderSemaine).join("")}
        </aside>

        <!-- GRILLE -->
        <div class="edt-grille">
          <table>
            <tr>
              <th></th>
              ${JOURS.map(j => `<th>${j}</th>`).join("")}
            </tr>
            ${CRENEAUX.map(renderLigne).join("")}
          </table>
        </div>

      </div>

      <div id="modal"></div>

    </section>
  `;
}

/* ======================================================
   RENDU BANDEAU
   ====================================================== */

function renderChoix(cle, valeurs, actif) {
  return `
    <span class="choix">
      ${valeurs.map(v =>
        `<button data-cle="${cle}" data-val="${v}" class="${v===actif?"on":""}">${v}</button>`
      ).join("")}
    </span>
  `;
}

/* ======================================================
   COLONNE SEMAINES
   ====================================================== */

function renderSemaine(s, idx) {
  const iso = toISO(s.lundi);
  return `
    <label class="semaine">
      <input type="checkbox" data-iso="${iso}">
      S${s.numero} — ${formatFR(s.lundi)}
    </label>
  `;
}

/* ======================================================
   GRILLE
   ====================================================== */

function renderLigne(cr) {
  return `
    <tr>
      <th>${cr.code}<br><small>${cr.debut}-${cr.fin}</small></th>
      ${JOURS.map(j => renderCell(j, cr.code)).join("")}
    </tr>
  `;
}

function renderCell(jour, creneau) {
  if (creneau === "PM") return `<td class="off">—</td>`;

  const ligne = edtModele.find(
    l => l.jour === jour && l.creneau === creneau
  );

  const txt = ligne
    ? (ligne.groupe ? `${ligne.classe} ${ligne.groupe}` : ligne.classe)
    : "";

  return `
    <td class="cell" data-jour="${jour}" data-creneau="${creneau}">
      ${txt}
    </td>
  `;
}

/* ======================================================
   EVENTS
   ====================================================== */

export function bindEmploiDuTempsEvents() {

  document.getElementById("prevWeek").onclick = () => {
    contexte.semaineRefIndex = Math.max(0, contexte.semaineRefIndex - 1);
    rerender();
  };

  document.getElementById("nextWeek").onclick = () => {
    contexte.semaineRefIndex = Math.min(semaines.length - 1, contexte.semaineRefIndex + 1);
    rerender();
  };

  document.querySelectorAll(".choix button").forEach(btn => {
    btn.onclick = () => {
      contexte[btn.dataset.cle] = btn.dataset.val;
      rerender();
    };
  });

  document.querySelectorAll(".cell").forEach(cell => {
    cell.onclick = () => ouvrirModal(cell.dataset.jour, cell.dataset.creneau);
  });

  document.querySelectorAll(".semaine input").forEach(cb => {
    cb.onchange = () => {
      cb.checked
        ? semainesCibles.add(cb.dataset.iso)
        : semainesCibles.delete(cb.dataset.iso);
    };
  });

  document.getElementById("validerEDT").onclick = appliquerEDT;
}

/* ======================================================
   MODALE
   ====================================================== */

function ouvrirModal(jour, creneau) {
  const classes = getClassesAvecGroupes();

  document.getElementById("modal").innerHTML = `
    <div class="modal">
      <h2>${jour} — ${creneau}</h2>
      <select id="choixClasse">
        ${classes.map(c =>
          `<option value="${c.classe}|${c.groupe ?? ""}">${c.label}</option>`
        ).join("")}
      </select>
      <button id="save">OK</button>
      <button id="cancel">Annuler</button>
    </div>
  `;

  document.getElementById("save").onclick = () => {
    const [classe, groupe] = document.getElementById("choixClasse").value.split("|");

    const idx = edtModele.findIndex(
      l => l.jour === jour && l.creneau === creneau
    );

    const ligne = { jour, creneau, classe, groupe: groupe || null };

    if (idx === -1) edtModele.push(ligne);
    else edtModele[idx] = ligne;

    fermerModal();
    rerender();
  };

  document.getElementById("cancel").onclick = fermerModal;
}

function fermerModal() {
  document.getElementById("modal").innerHTML = "";
}

/* ======================================================
   APPLICATION
   ====================================================== */

function appliquerEDT() {
  semainesCibles.forEach(iso => {
    edtParSemaine[iso] = edtModele.map(l => ({
      ...l,
      type: contexte.type,
      trimestre: contexte.trimestre,
      semestre: contexte.semestre,
    }));
  });

  semainesCibles.clear();
  rerender();
}

/* ======================================================
   RERENDER
   ====================================================== */

function rerender() {
  document.getElementById("app").innerHTML = renderEmploiDuTemps();
  bindEmploiDuTempsEvents();
}

/* ======================================================
   ACCÈS MÉTIER POUR SALLE
   ====================================================== */

export function getEDT() {
  return edtParSemaine;
}
