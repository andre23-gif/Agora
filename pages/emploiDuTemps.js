/* === AG_EDT_PAGE_REWRITE_V2 (bufferEdition) ================= */

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

const JOURS = ["lundi","mardi","mercredi","jeudi","vendredi"];
const TYPES = ["A","B","V"];
const TRIMESTRES = ["T1","T2","T3"];
const SEMESTRES = ["S1","S2"];

let semaines = [];
let semaineRefIndex = 0;
let semainesCibles = new Set();
let weekStatusIndex = new Map();

/* ✅ semaine réelle (BDD) */
let semaineActive = {
  iso_lundi: null,
  meta: { type:"A", trimestre:"T1", semestre:"S1" },
  grid: new Map()
};

/* ✅ BUFFER ÉDITION (NOUVEAU) */
let bufferEdition = {
  meta: { type:"A", trimestre:"T1", semestre:"S1" },
  grid: new Map()
};

let syncState = "unknown";
let lastSyncAt = null;

/* ===== Supabase ===== */

function sbAgoram() {
  return window.sb.schema("agoram");
}

async function getActiveAnneeId(){
  const {data} = await sbAgoram()
    .from("annees")
    .select("id")
    .eq("active",true)
    .single();
  return data.id;
}

/* ===== LOAD ===== */

async function loadWeek(iso){
  const anneeId = await getActiveAnneeId();

  const {data:w} = await sbAgoram()
    .from("edt_weeks")
    .select("*")
    .eq("annee_id",anneeId)
    .eq("iso_lundi",iso)
    .maybeSingle();

  const {data:cells} = await sbAgoram()
    .from("edt_cells")
    .select("*")
    .eq("annee_id",anneeId)
    .eq("iso_lundi",iso);

  const grid = new Map();

  (cells||[]).forEach(c=>{
    grid.set(`${c.jour}|${c.creneau}`,{
      classe_id:c.classe_id,
      groupe:c.groupe
    });
  });

  semaineActive = {
    iso_lundi:iso,
    meta:{
      type:w?.type||"A",
      trimestre:w?.trimestre||"T1",
      semestre:w?.semestre||"S1"
    },
    grid
  };

  /* ✅ copier vers buffer */
  bufferEdition.meta = {...semaineActive.meta};
  bufferEdition.grid = new Map(
    [...semaineActive.grid.entries()].map(([k,v])=>[k,{...v}])
  );
}

/* ===== RENDER ===== */

function cellText(k){
  const v = bufferEdition.grid.get(k);
  if(!v)return "";
  return v.groupe?`${v.classe_id} ${v.groupe}`:v.classe_id;
}

export async function renderEmploiDuTemps(){

  const sem = semaines[semaineRefIndex];

  if(!semaineActive.iso_lundi || semaineActive.iso_lundi!==sem.isoLundi){
    await loadWeek(sem.isoLundi);
  }

  return `
    <div class="grid">
      ${CRENEAUX.map(cr=>`
        <div class="row">
          ${JOURS.map(j=>{
            const k=`${j}|${cr.code}`;
            return `<div class="cell" data-k="${k}">${cellText(k)}</div>`;
          }).join("")}
        </div>
      `).join("")}
    </div>
  `;
}

/* ===== EVENTS ===== */

export function bindEmploiDuTempsEvents(){

  document.querySelectorAll(".cell").forEach(td=>{
    td.onclick=()=>{
      const key=td.dataset.k;

      /* ✅ MODIF buffer seulement */
      bufferEdition.grid.set(key,{
        classe_id:"TEST",
        groupe:null
      });

      syncState="dirty";
      refresh();
    };
  });

  document.getElementById("valider").onclick = async ()=>{

    const anneeId = await getActiveAnneeId();

    /* ✅ INJECTER buffer dans semaineActive */
    semaineActive.meta = {...bufferEdition.meta};
    semaineActive.grid = new Map(
      [...bufferEdition.grid.entries()].map(([k,v])=>[k,{...v}])
    );

    /* ✅ SAVE réel */
    await sbAgoram()
      .from("edt_weeks")
      .upsert([{
        annee_id:anneeId,
        iso_lundi:semaineActive.iso_lundi,
        ...semaineActive.meta
      }]);

    await sbAgoram()
      .from("edt_cells")
      .delete()
      .eq("iso_lundi",semaineActive.iso_lundi);

    const rows=[...semaineActive.grid.entries()].map(([k,v])=>{
      const [jour,cr]=k.split("|");
      return {
        annee_id:anneeId,
        iso_lundi:semaineActive.iso_lundi,
        jour,
        creneau:cr,
        ...v
      };
    });

    if(rows.length) await sbAgoram().from("edt_cells").insert(rows);

    syncState="ok";
    refresh();
  };
}

/* ===== REFRESH ===== */

async function refresh(){
  document.getElementById("app").innerHTML =
    await renderEmploiDuTemps();
  bindEmploiDuTempsEvents();
}
