import { getClassesAvecGroupes } from "./importExport.js";

/* ============================
   CRÉNEAUX OFFICIELS
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
   ÉTAT EDT
   ============================ */

let edt = [];

/* ============================
   SEMAINE ACTUELLE (temporaire)
   ============================ */

function getCurrentWeekType() {
  return "A"; // sera branché plus tard sur ton module semaines
}

/* ============================
   RENDU PRINCIPAL
   ============================ */

export function renderEmploiDuTemps() {
  return `
    <section>

      <h1>Emploi du temps</h1>

      <div class="gridwrap">
        <table class="edt-table">

          <tr>
            <th></th>
            ${JOURS.map(j => `<th>${capitalize(j)}</th>`).join("")}
          </tr>

          ${CRENEAUX.map(renderRow).join("")}

        </table>
      </div>

      <div id="modal"></div>

    </section>
  `;
}

/* ============================
   LIGNE
   ============================ */

function renderRow(cr) {
  return `
    <tr>

      <th>
        ${cr.code}<br>
        <small>${cr.debut} - ${cr.fin}</small>
      </th>

      ${JOURS.map(j => renderCell(j, cr.code)).join("")}

    </tr>
  `;
}

/* ============================
   CELLULE
   ============================ */

function renderCell(jour, creneauCode) {

  if (creneauCode === "PM") {
    return `<td class="cell off">—</td>`;
  }

  const ligne = edt.find(l =>
    l.jour === jour &&
    l.creneau === creneauCode &&
    l.semaine === getCurrentWeekType()
  );

  const label = ligne
    ? (ligne.groupe ? `${ligne.classe} ${ligne.groupe}` : ligne.classe)
    : "";

  return `
    <td class="cell"
        data-jour="${jour}"
        data-creneau="${creneauCode}">
      ${label}
    </td>
  `;
}

/* ============================
   EVENTS
   ============================ */

export function bindEmploiDuTempsEvents() {

  document.querySelectorAll(".cell").forEach(cell => {
    cell.addEventListener("click", () => {

      const jour = cell.dataset.jour;
      const creneau = cell.dataset.creneau;

      if (!jour || !creneau) return;

      ouvrirModal(jour, creneau);
    });
  });

}

/* ============================
   MODALE
   ============================ */

function ouvrirModal(jour, creneau) {

  const classes = getClassesAvecGroupes();

  document.getElementById("modal").innerHTML = `
    <div class="modal">

      <h2>${capitalize(jour)} — ${creneau}</h2>

      <select id="choixClasse">
        ${classes.map(c =>
          `<option value="${c.classe}|${c.groupe ?? ""}">
            ${c.label}
          </option>`
        ).join("")}
      </select>

      <div style="margin-top:1em;">
        <button id="save">Enregistrer</button>
        <button id="close">Fermer</button>
      </div>

    </div>
  `;

  document.getElementById("save").onclick = () => {

    const val = document.getElementById("choixClasse").value;
    const [classe, groupe] = val.split("|");

    const index = edt.findIndex(l =>
      l.jour === jour &&
      l.creneau === creneau &&
      l.semaine === getCurrentWeekType()
    );

    const nouvelle = {
      jour,
      creneau,
      classe,
      groupe: groupe || null,
      semaine: getCurrentWeekType()
    };

    if (index === -1) {
      edt.push(nouvelle);
    } else {
      edt[index] = nouvelle;
    }

    refresh();
  };

  document.getElementById("close").onclick = closeModal;
}

function closeModal() {
  document.getElementById("modal").innerHTML = "";
}

/* ============================
   REFRESH PROPRE
   ============================ */

function refresh() {
  document.getElementById("app").innerHTML = renderEmploiDuTemps();
  bindEmploiDuTempsEvents();
}

/* ============================
   UTILITAIRE
   ============================ */

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ============================
   ACCÈS MÉTIER
   ============================ */

export function getEDT() {
  return edt;
}

export function setEDT(nouveau) {
  edt = nouveau;
}
