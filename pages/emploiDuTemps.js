import { getClassesAvecGroupes } from "./importExport.js";

/* ======================================================
   CONSTANTES
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
   ÉTAT
   ====================================================== */

let edtModele = [];              // [{ jour, creneau, classe, groupe }]
let edtParSemaine = {};          // { isoLundi: [{...},{...}] }
let semaines = [];               // [{ numero, lundi: Date }]
let semaineRefIndex = 0;         // index semaine de référence dans semaines[]
let semainesCibles = new Set();  // Set<isoLundi>

let contexte = {
  type: "A",
  trimestre: "T1",
  semestre: "S1"
};

/* ======================================================
   OUTILS
   ====================================================== */

function mondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;      // dimanche -> 7
  if (day !== 1) d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function formatFR(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function anneeDebut() {
  return Number((window.appAnneeCourante || "2024-2025").split("-")[0]);
}

/* ======================================================
   SEMAINES
   ====================================================== */

function genererSemaines() {
  const y = anneeDebut();
  const sept1 = new Date(y, 8, 1); // 1er septembre
  let lundi = mondayOfWeek(sept1);

  const out = [];
  for (let i = 0; i < 52; i++) {
    out.push({
      numero: i + 1,
      lundi: new Date(lundi)
    });
    lundi.setDate(lundi.getDate() + 7);
  }
  return out;
}

function getIndexSemaineCourante() {
  // Trouve l’index de la semaine contenant la date du jour (via son lundi)
  const isoLundiCourant = toISO(mondayOfWeek(new Date()));
  const idx = semaines.findIndex(s => toISO(s.lundi) === isoLundiCourant);
  return idx >= 0 ? idx : 0;
}

export function initEmploiDuTemps() {
  semaines = genererSemaines();
  // ✅ Demande métier : la semaine de référence = semaine en cours
  semaineRefIndex = getIndexSemaineCourante();
}

/* ======================================================
   RENDU
   ====================================================== */

export function renderEmploiDuTemps() {
  if (semaines.length === 0) initEmploiDuTemps();

  const sem = semaines[semaineRefIndex];

  return `
    <section>

      <!-- BANDEAU -->
      <div class="topbar">
        <button id="prev">◀</button>
        <strong>S${sem.numero} — ${formatFR(sem.lundi)}</strong>
        <button id="next">▶</button>

        <select id="weekSelect">
          ${semaines.map((s, i) => `
            <option value="${i}" ${i === semaineRefIndex ? "selected" : ""}>
              S${s.numero}
            </option>
          `).join("")}
        </select>

        <span>Type</span>
        ${choix("type", ["A", "B", "V"], contexte.type)}

        <span>T</span>
        ${choix("trimestre", ["T1", "T2", "T3"], contexte.trimestre)}

        <span>S</span>
        ${choix("semestre", ["S1", "S2"], contexte.semestre)}

        <button id="valider">Valider</button>
      </div>

      <!-- LAYOUT -->
      <div class="edt-body">

        <div class="edt-leftpanel">
          <div class="edt-weeklist">
            ${semaines.map(s => {
              const iso = toISO(s.lundi);
              const checked = semainesCibles.has(iso) ? "checked" : "";
              return `
                <label class="edt-weekrow">
                  <input type="checkbox" data-iso="${iso}" ${checked}>
                  <span>S${s.numero} ${formatFR(s.lundi)}</span>
                </label>
              `;
            }).join("")}
          </div>
        </div>

        <div class="edt-rightpanel">
          <div class="edt-gridwrap">
            <table class="edt-grid" border="1" style="width:100%; text-align:center">
              <tr>
                <th></th>
                ${JOURS.map(j => `<th>${capitalize(j)}</th>`).join("")}
              </tr>

              ${CRENEAUX.map(cr => `
                <tr>
                  <th>${cr.code}<br><small>${cr.debut}-${cr.fin}</small></th>

                  ${JOURS.map(j => {
                    if (cr.code === "PM") return `<td class="edt-off">—</td>`;

                    const e = edtModele.find(l => l.jour === j && l.creneau === cr.code);
                    const txt = e ? (e.groupe ? `${e.classe} ${e.groupe}` : e.classe) : "&nbsp;";

                    return `<td class="edt-cell" data-j="${j}" data-c="${cr.code}">${txt}</td>`;
                  }).join("")}

                </tr>
              `).join("")}

            </table>
          </div>
        </div>

      </div>

      <div id="modal"></div>

    </section>
  `;
}

function choix(k, vals, act) {
  return vals.map(v => `
    <button data-k="${k}" data-v="${v}" ${v === act ? "style='background:#ccc'" : ""}>
      ${v}
    </button>
  `).join("");
}

/* ======================================================
   EVENTS
   ====================================================== */

export function bindEmploiDuTempsEvents() {

  document.getElementById("prev").onclick = () => {
    semaineRefIndex = Math.max(0, semaineRefIndex - 1);
    refresh();
  };

  document.getElementById("next").onclick = () => {
    semaineRefIndex = Math.min(semaines.length - 1, semaineRefIndex + 1);
    refresh();
  };

  document.getElementById("weekSelect").onchange = e => {
    semaineRefIndex = Number(e.target.value);
    refresh();
  };

  document.querySelectorAll("[data-k]").forEach(b => {
    b.onclick = () => {
      contexte[b.dataset.k] = b.dataset.v;
      refresh();
    };
  });

  document.querySelectorAll(".edt-cell").forEach(td => {
    td.onclick = () => {
      ouvrirModal(td.dataset.j, td.dataset.c);
    };
  });

  document.querySelectorAll("input[type=checkbox][data-iso]").forEach(cb => {
    cb.onchange = () => {
      cb.checked ? semainesCibles.add(cb.dataset.iso) : semainesCibles.delete(cb.dataset.iso);
    };
  });

  document.getElementById("valider").onclick = () => {
    semainesCibles.forEach(iso => {
      edtParSemaine[iso] = edtModele.map(x => ({ ...x, ...contexte }));
    });
    semainesCibles.clear();
    refresh();
  };
}

/* ======================================================
   MODALE
   ====================================================== */

function ouvrirModal(j, c) {
  const classes = getClassesAvecGroupes();

  document.getElementById("modal").innerHTML = `
    <div style="background:white; padding:10px; border:1px solid black">
      <div style="margin-bottom:8px;"><strong>${capitalize(j)} — ${c}</strong></div>

      <select id="sel">
        ${classes.map(x =>
          `<option value="${x.classe}|${x.groupe || ""}">${x.label}</option>`
        ).join("")}
      </select>

      <div style="margin-top:10px; display:flex; gap:10px;">
        <button id="ok">OK</button>
        <button id="cancel">Annuler</button>
      </div>
    </div>
  `;

  document.getElementById("cancel").onclick = () => {
    document.getElementById("modal").innerHTML = "";
  };

  document.getElementById("ok").onclick = () => {
    const [classe, g] = document.getElementById("sel").value.split("|");
    const i = edtModele.findIndex(x => x.jour === j && x.creneau === c);

    const obj = { jour: j, creneau: c, classe, groupe: g || null };

    if (i === -1) edtModele.push(obj);
    else edtModele[i] = obj;

    document.getElementById("modal").innerHTML = "";
    refresh();
  };
}

/* ======================================================
   REFRESH
   ====================================================== */

function refresh() {
  document.getElementById("app").innerHTML = renderEmploiDuTemps();
  bindEmploiDuTempsEvents();
}

/* ======================================================
   ACCÈS
   ====================================================== */

export function getEDT() {
  return edtParSemaine;
}

export function setEDT(e) {
  edtParSemaine = e || {};
}
