/* === AG_EDT_PAGE_REWRITE_V2_SIMPLIFIED =====================================
   Page : Emploi du Temps (EDT) — GESTION SIMPLIFIÉE
   Métier : 
     - Navigation via table 'semaines' (lecture directe)
     - Suppression des calculs ISO complexes
   =============================================================== */

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
const TYPES = ["A", "B", "V"];
const TRIMESTRES = ["T1", "T2", "T3"];
const SEMESTRES = ["S1", "S2"];

let semaines = [];              // [{ id, libelle, date_lundi, annee_scolaire }]
let semaineRefIndex = 0;
let semainesCibles = new Set();
let semaineActive = { iso_lundi: null, meta: {}, grid: new Map(), status: "idle" };
let bufferEdition = { meta: {}, grid: new Map() };
let syncState = "unknown";

function sbAgoram() { return window.sb.schema("agoram"); }

/* ======================================================
   BLOC : CHARGEMENT LISTE SEMAINES (La base)
   ====================================================== */

async function ensureCalendar() {
  const { data, error } = await sbAgoram()
    .from("semaines")
    .select("*")
    .order("date_lundi");
  
  if (error) throw error;
  semaines = data;
}

/* ======================================================
   BLOC : LOGIQUE MÉTIER SIMPLE
   ====================================================== */

async function loadWeek(isoLundi) {
  semaineActive.status = "loading";
  const { data: cells } = await sbAgoram()
    .from("edt_cells")
    .select("*")
    .eq("iso_lundi", isoLundi);

  // Initialisation grille vide
  const grid = new Map();
  JOURS.forEach(j => CRENEAUX.forEach(cr => {
    if (cr.code !== "PM") grid.set(`${j}|${cr.code}`, { classe_id: null, classe_nom: null, groupe: null });
  }));

  (cells || []).forEach(c => {
    grid.set(`${c.jour}|${c.creneau}`, { 
      classe_id: c.classe_id, 
      classe_nom: c.classe_nom, 
      groupe: c.groupe 
    });
  });

  semaineActive = { iso_lundi: isoLundi, grid, status: "loaded" };
  bufferEdition.grid = new Map(grid);
}

async function saveWeek(isoLundi) {
  const payload = [];
  for (const [key, v] of bufferEdition.grid.entries()) {
    const [jour, creneau] = key.split("|");
    payload.push({ iso_lundi: isoLundi, jour, creneau, classe_id: v.classe_id, groupe: v.groupe });
  }
  await sbAgoram().from("edt_cells").upsert(payload, { onConflict: "iso_lundi,jour,creneau" });
  await loadWeek(isoLundi);
}

/* ======================================================
   BLOC : RENDU UI (Simplifié)
   ====================================================== */

export async function renderEmploiDuTemps() {
  await ensureCalendar();
  const sem = semaines[semaineRefIndex];
  if (!semaineActive.iso_lundi) await loadWeek(sem.date_lundi);

  return `
    <div class="page">
      <div class="topbar">
        <strong>${sem.libelle}</strong>
        <button id="valider">Valider</button>
      </div>
      <div class="edt-body">
        <div class="edt-leftpanel">
          ${semaines.map((s, i) => `
            <div class="edt-weekrow ${i === semaineRefIndex ? "active" : ""}" data-index="${i}">
              ${s.libelle}
            </div>
          `).join("")}
        </div>
        <div class="edt-rightpanel">
          <table class="edt-grid">
            ${JOURS.map(j => `<th>${j}</th>`).join("")}
            ${CRENEAUX.map(cr => `<tr><td>${cr.code}</td>
              ${JOURS.map(j => `<td class="edt-cell" data-j="${j}" data-c="${cr.code}">${bufferEdition.grid.get(j+"|"+cr.code)?.classe_nom || ""}</td>`).join("")}
            </tr>`).join("")}
          </table>
        </div>
      </div>
      <div id="modal"></div>
    </div>
  `;
}

export function bindEmploiDuTempsEvents() {
  document.querySelectorAll(".edt-weekrow").forEach(el => {
    el.onclick = async () => {
      semaineRefIndex = Number(el.dataset.index);
      await refresh();
    };
  });
  
  document.querySelectorAll(".edt-cell").forEach(el => {
    el.onclick = async () => { /* Logique modale ici */ };
  });

  document.getElementById("valider").onclick = async () => {
    await saveWeek(semaines[semaineRefIndex].date_lundi);
    alert("Enregistré");
  };
}

async function refresh() {
  document.getElementById("app").innerHTML = await renderEmploiDuTemps();
  bindEmploiDuTempsEvents();
}
