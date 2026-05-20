/* === AG_EDT_PAGE_REWRITE_V1_BUFFER =====================================
   Page : Emploi du Temps (EDT) — SANS MODÈLE
   ==================================================================== */

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

let semaines = [];
let semaineRefIndex = 0;
let semainesCibles = new Set();
let weekStatusIndex = new Map();

let semaineActive = {
  iso_lundi: null,
  meta: { type: "A", trimestre: "T1", semestre: "S1" },
  grid: new Map(),
  status: "idle"
};

let bufferEdition = {
  meta: { type: "A", trimestre: "T1", semestre: "S1" },
  grid: new Map()
};

let syncState = "unknown";
let lastSyncAt = null;
let _calendarEnsuredOnce = false;

function requireSupabase() {
  if (!window.sb) throw new Error("Supabase non initialisé.");
  return window.sb;
}

function sbAgoram() {
  return requireSupabase().schema("agoram");
}

async function getActiveAnneeId() {
  const sb = sbAgoram();
  const { data } = await sb.from("annees").select("id").eq("active", true).maybeSingle();
  return data ? data.id : null;
}

async function inspectSupabaseState(isoLundi) {
  try {
    const anneeId = await getActiveAnneeId();
    const sb = sbAgoram();
    console.group(`🔍 DIAGNOSTIC SUPABASE — Semaine ${isoLundi}`);
    const { data: weekRow } = await sb.from("edt_weeks").select("*").eq("annee_id", anneeId).eq("iso_lundi", isoLundi).maybeSingle();
    console.log("État actuel de 'edt_weeks' :", weekRow);
    const { data: cellsRows } = await sb.from("edt_cells").select("jour, creneau, classe_id, groupe").eq("annee_id", anneeId).eq("iso_lundi", isoLundi);
    console.log(`Lignes trouvées dans 'edt_cells' (${cellsRows?.length || 0}) :`, cellsRows);
    console.groupEnd();
  } catch (err) { console.error("❌ Échec de l'inspection Supabase :", err); }
}

/* ======================================================
   BLOC 4 — OUTILS DATE (Interrogation Base)
   ====================================================== */

function formatFR(d) {
  const date = new Date(d);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function getNowDateISO() {
  return window.APP_SERVER_DATE_ISO || new Date().toISOString().slice(0, 10);
}

/* ======================================================
   BLOC 5 — INIT PAGE (Chargement depuis agoram.semaines)
   ====================================================== */

async function ensureCalendar() {
  if (_calendarEnsuredOnce) return;

  const sb = sbAgoram();
  const { data, error } = await sb
    .from("semaines")
    .select("libelle, date_lundi")
    .order("date_lundi");

  if (error) throw new Error(`Chargement semaines impossible: ${error.message}`);

  semaines = data.map(s => ({
    isoLundi: s.date_lundi,
    lundi: new Date(s.date_lundi),
    libelle: s.libelle
  }));

  const now = getNowDateISO();
  const idx = semaines.findIndex(s => s.isoLundi === now);
  semaineRefIndex = idx >= 0 ? idx : 0;

  _calendarEnsuredOnce = true;
}/* ======================================================

   BLOC 6 — DATA : classes sélectionnables (pour modale)

   ====================================================== */



let _classesOptionsCache = null;

let _classesOptionsCacheAnnee = null;



async function getClassesOptions() {

  const anneeId = await getActiveAnneeId();

  if (!anneeId) return [];



  if (_classesOptionsCache && _classesOptionsCacheAnnee === anneeId) {

    return _classesOptionsCache;

  }



  const sb = sbAgoram();

  const { data, error } = await sb

    .from("classes")

    .select("id, nom")

    .eq("annee_id", anneeId)

    .order("nom");



  if (error) throw new Error(`Impossible de lire 'classes'. ${error.message}`);



  const out = [];

  out.push({ classe_id: null, groupe: null, label: "— (vide)" });



  (data || []).forEach(c => {

    out.push({ classe_id: c.id, groupe: null, label: c.nom });

    out.push({ classe_id: c.id, groupe: "gr 1", label: `${c.nom} gr 1` });

    out.push({ classe_id: c.id, groupe: "gr 2", label: `${c.nom} gr 2` });

  });



  _classesOptionsCache = out;

  _classesOptionsCacheAnnee = anneeId;



  return out;

}



/* ======================================================

   BLOC 7 — DATA : index semaines (statut enregistré/vide)

   ====================================================== */



async function loadWeekStatusIndex() {

  const anneeId = await getActiveAnneeId();

  if (!anneeId) return;



  const sb = sbAgoram();

  const { data, error } = await sb

    .from("edt_week_status")

    .select("iso_lundi, has_data, type, trimestre, semestre, last_update")

    .eq("annee_id", anneeId);



  if (error) throw new Error(`Impossible de lire 'edt_week_status'. ${error.message}`);



  weekStatusIndex = new Map();

  (data || []).forEach(r => {

    weekStatusIndex.set(String(r.iso_lundi), {

      has_data: !!r.has_data,

      type: r.type,

      trimestre: r.trimestre,

      semestre: r.semestre,

      last_update: r.last_update || null

    });

  });

}



/* ======================================================

   BLOC 8 — DATA : charger une semaine (même vide)

   ====================================================== */



async function ensureWeekRow(anneeId, isoLundi) {

  const sb = sbAgoram();



  const { data: existing, error: errSel } = await sb

    .from("edt_weeks")

    .select("annee_id, iso_lundi")

    .eq("annee_id", anneeId)

    .eq("iso_lundi", isoLundi)

    .maybeSingle();



  if (errSel) throw new Error(`Lecture edt_weeks impossible. ${errSel.message}`);

  if (existing) return;



  const defaults = { type: "A", trimestre: "T1", semestre: "S1" };



  const { error: errIns } = await sb

    .from("edt_weeks")

    .insert([{

      annee_id: anneeId,

      iso_lundi: isoLundi,

      type: defaults.type,

      trimestre: defaults.trimestre,

      semestre: defaults.semestre

    }]);



  if (errIns) throw new Error(`Création semaine impossible. ${errIns.message}`);

}



async function loadWeek(isoLundi) {

  const anneeId = await getActiveAnneeId();

  if (!anneeId) throw new Error("Aucune année active.");



  semaineActive.status = "loading";



  await ensureWeekRow(anneeId, isoLundi);



  const sb = sbAgoram();



  const { data: w, error: errW } = await sb

    .from("edt_weeks")

    .select("type, trimestre, semestre")

    .eq("annee_id", anneeId)

    .eq("iso_lundi", isoLundi)

    .maybeSingle();



  if (errW) throw new Error(`Lecture edt_weeks impossible. ${errW.message}`);



  const { data: cells, error: errC } = await sb

    .from("edt_cells")

    .select("jour, creneau, classe_id, groupe")

    .eq("annee_id", anneeId)

    .eq("iso_lundi", isoLundi);



  if (errC) throw new Error(`Lecture edt_cells impossible. ${errC.message}`);



  const ids = Array.from(new Set((cells || []).map(x => x.classe_id).filter(Boolean)));

  let idToNom = new Map();



  if (ids.length) {

    const { data: cls, error: errCls } = await sb

      .from("classes")

      .select("id, nom")

      .in("id", ids);



    if (errCls) throw new Error(`Lecture classes impossible. ${errCls.message}`);

    idToNom = new Map((cls || []).map(x => [x.id, x.nom]));

  }



  const grid = new Map();

  

  JOURS.forEach(j => {

    CRENEAUX.forEach(cr => {

      if (cr.code !== "PM") {

        grid.set(`${j}|${cr.code}`, { classe_id: null, classe_nom: null, groupe: null });

      }

    });

  });



  let validCellsCount = 0;

  (cells || []).forEach(c => {

    if (c.classe_id) {

      const key = `${c.jour}|${c.creneau}`;

      grid.set(key, {

        classe_id: c.classe_id,

        classe_nom: idToNom.get(c.classe_id) || "—",

        groupe: c.groupe || null

      });

      validCellsCount++;

    }

  });



  semaineActive = {

    iso_lundi: isoLundi,

    meta: {

      type: (w?.type || "A"),

      trimestre: (w?.trimestre || "T1"),

      semestre: (w?.semestre || "S1")

    },

    grid,

    status: validCellsCount > 0 ? "loaded" : "empty"

  };



  const idx = weekStatusIndex.get(String(isoLundi));

  if (idx) {

    idx.type = semaineActive.meta.type;

    idx.trimestre = semaineActive.meta.trimestre;

    idx.semestre = semaineActive.meta.semestre;

    idx.has_data = validCellsCount > 0;

    weekStatusIndex.set(String(isoLundi), idx);

  }



  bufferEdition.meta = { ...semaineActive.meta };

  bufferEdition.grid = new Map(

    Array.from(semaineActive.grid.entries()).map(([k, v]) => [k, v ? { ...v } : v])

  );

}



/* ======================================================

   BLOC 9 — DATA : enregistrer une semaine

   ====================================================== */



async function saveWeek(isoLundi) {

  const anneeId = await getActiveAnneeId();

  if (!anneeId) throw new Error("Aucune année active.");



  const sb = sbAgoram();

  semaineActive.status = "saving";



  // BRANCHEMENT FIXE 1 : On utilise la donnée fraîche issue du buffer d'édition au moment du clic

  const meta = bufferEdition.meta;



  const { error: errUpW } = await sb

    .from("edt_weeks")

    .upsert([{

      annee_id: anneeId,

      iso_lundi: isoLundi,

      type: meta.type,

      trimestre: meta.trimestre,

      semestre: meta.semestre

    }], { onConflict: "annee_id,iso_lundi" });



  if (errUpW) throw new Error(`Upsert edt_weeks impossible. ${errUpW.message}`);



  const payload = [];

  let validCellsCount = 0;



  // BRANCHEMENT FIXE 2 : On boucle directement sur le buffer d'édition réel pour générer les paquets Supabase

  for (const [key, v] of bufferEdition.grid.entries()) {

    const [jour, creneau] = key.split("|");

    

    payload.push({

      annee_id: anneeId,

      iso_lundi: isoLundi,

      jour,

      creneau,

      classe_id: v && v.classe_id ? v.classe_id : null,

      groupe: v && v.groupe ? v.groupe : null

    });



    if (v && v.classe_id) {

      validCellsCount++;

    }

  }



  if (payload.length) {

    console.log(`📤 Envoi du payload à Supabase pour la semaine ${isoLundi} :`, payload);

    const { error: errIns } = await sb

      .from("edt_cells")

      .upsert(payload, { onConflict: "annee_id,iso_lundi,jour,creneau" });



    if (errIns) throw new Error(`Mise à jour edt_cells impossible (Supabase). ${errIns.message}`);

  }



  const prev = weekStatusIndex.get(String(isoLundi)) || {};

  weekStatusIndex.set(String(isoLundi), {

    has_data: validCellsCount > 0,

    type: meta.type,

    trimestre: meta.trimestre,

    semestre: meta.semestre,

    last_update: new Date().toISOString(),

    ...prev

  });



  // BRANCHEMENT FIXE 3 : On synchronise immédiatement la structure métier locale pour éviter le décalage asynchrone

  semaineActive.meta = { ...meta };

  semaineActive.grid = new Map(bufferEdition.grid);

  semaineActive.status = validCellsCount > 0 ? "loaded" : "empty";

  

  await inspectSupabaseState(isoLundi);

}



/* ======================================================

   BLOC 10 — DATA : appliquer semaine active aux cibles

   ====================================================== */



async function applyWeekToTargets(sourceIso, targetsIsoList) {

  if (!targetsIsoList.length) return;



  const savedGrid = new Map(bufferEdition.grid);

  const savedMeta = { ...bufferEdition.meta };



  for (const iso of targetsIsoList) {

    // On duplique l'état actuel du buffer d'édition vers chaque cible de manière séquentielle sécurisée

    await saveWeek(iso);

  }



  semaineActive.iso_lundi = sourceIso;

  semaineActive.meta = { ...savedMeta };

  semaineActive.grid = new Map(savedGrid);

}



/* ======================================================

   BLOC 11 — RENDU (UI)

   ====================================================== */



function escapeHtml(s) {

  return String(s ?? "").replace(/[&<>"']/g, m => ({

    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"

  }[m]));

}



function weekLabel(s) {

  return `S${String(s.weekNo).padStart(2,"0")} (${s.weekYear}) — ${formatFR(s.lundi)}`;

}



function cellText(jour, creneau) {

  const key = `${jour}|${creneau}`;

  const v = bufferEdition.grid.get(key); 

  if (!v || !v.classe_id) return "&nbsp;";

  const nom = escapeHtml(v.classe_nom || "—");

  return v.groupe ? `${nom} ${escapeHtml(v.groupe)}` : nom;

}



function metaButton(k, v, active) {

  return `<button class="edt-meta" data-k="${k}" data-v="${v}" ${active ? 'data-active="1"' : ""}>${v}</button>`;

}



export async function renderEmploiDuTemps() {

  await ensureCalendar();



  const annee = window.appAnneeCourante || `${getAnneeScolaireCourante().start}-${getAnneeScolaireCourante().end}`;



  if (weekStatusIndex.size === 0) {

    try { await loadWeekStatusIndex(); } catch (e) { console.error(e); }

  }



  const sem = semaines[semaineRefIndex];



  // BRANCHEMENT FIXE 4 : Si on change de semaine ou à l'initialisation, on charge la semaine

  if (syncState !== "dirty" && (!semaineActive.iso_lundi || semaineActive.iso_lundi !== sem.isoLundi)) {

    try {

      await loadWeek(sem.isoLundi);

      syncState = "ok";

      lastSyncAt = new Date();

    } catch (e) {

      console.error(e);

      syncState = "error";

    }

  }



  const meta = bufferEdition.meta; 



  return `

    <section class="page page-edt">

      <div class="topbar">

        <button id="prev">◀</button>

        <strong>${weekLabel(sem)}</strong>

        <button id="next">▶</button>

        <select id="weekSelect">

          ${semaines.map((s, i) => `

            <option value="${i}" ${i === semaineRefIndex ? "selected" : ""}>

              ${weekLabel(s)}

            </option>

          `).join("")}

        </select>



        <span>Année</span>

        <select id="anneeSelect">

          ${(() => {

            const { start, end } = getAnneeScolaireCourante();

            const options = [`${start-1}-${end-1}`, `${start}-${end}`, `${start+1}-${end+1}`];

            return options.map(a => `<option value="${a}" ${a === annee ? "selected" : ""}>${a}</option>`).join("");

          })()}

        </select>



        <span>Type</span>

        ${TYPES.map(v => metaButton("type", v, meta.type === v)).join("")}



        <span>T</span>

        ${TRIMESTRES.map(v => metaButton("trimestre", v, meta.trimestre === v)).join("")}



        <span>S</span>

        ${SEMESTRES.map(v => metaButton("semestre", v, meta.semestre === v)).join("")}



        <span id="edtSyncState">

          ${

            syncState === "ok" ? "🟢 Sync OK" :

            syncState === "dirty" ? "🟠 Modifié (En attente de validation)" :

            syncState === "error" ? "🔴 Erreur" :

            "⚪ —"

          }

        </span>

        <span id="edtSyncTime">

          ${lastSyncAt ? lastSyncAt.toLocaleTimeString("fr-FR") : ""}

        </span>

        <button id="valider">Valider</button>

      </div>



      <div class="edt-body">

        <div class="edt-leftpanel">

          <div class="edt-weeklist">

            ${semaines.map((s, i) => {

              const iso = s.isoLundi;

              const checked = semainesCibles.has(iso) ? "checked" : "";

              const st = weekStatusIndex.get(String(iso));

              const hasData = st ? !!st.has_data : false;

              const dot = hasData ? "🟦" : "⬜";



              return `

                <div class="edt-weekrow ${i === semaineRefIndex ? "active" : ""}">

                  <input type="checkbox" class="edt-weekcheck" data-iso="${iso}" ${checked}>

                  <span class="edt-weekbtn" data-week-index="${i}">

                    ${dot} ${escapeHtml(weekLabel(s))}

                  </span>

                </div>

              `;

            }).join("")}

          </div>

        </div>



        <div class="edt-rightpanel">

          <div class="edt-gridwrap">

            <table class="edt-grid">

              <tr>

                <th></th>

                ${JOURS.map(j => `<th>${capitalize(j)}</th>`).join("")}

              </tr>

              ${CRENEAUX.map(cr => `

                <tr>

                  <th>${cr.code}<br><small>${cr.debut}-${cr.fin}</small></th>

                  ${JOURS.map(j => {

                    if (cr.code === "PM") return `<td class="edt-off">—</td>`;

                    return `<td class="edt-cell" data-j="${j}" data-c="${cr.code}">${cellText(j, cr.code)}</td>`;

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



/* ======================================================

   BLOC 12 — EVENTS

   ====================================================== */



export function bindEmploiDuTempsEvents() {

  const prev = document.getElementById("prev");

  const next = document.getElementById("next");

  const weekSelect = document.getElementById("weekSelect");

  const anneeSelect = document.getElementById("anneeSelect");

  const valider = document.getElementById("valider");



  if (prev) prev.onclick = async () => {

    syncState = "unknown";

    semaineRefIndex = Math.max(0, semaineRefIndex - 1);

    await refresh();

  };



  if (next) next.onclick = async () => {

    syncState = "unknown";

    semaineRefIndex = Math.min(semaines.length - 1, semaineRefIndex + 1);

    await refresh();

  };



  if (weekSelect) weekSelect.onchange = async (e) => {

    syncState = "unknown";

    semaineRefIndex = Number(e.target.value);

    await refresh();

  };



  if (anneeSelect) anneeSelect.onchange = async (e) => {

    window.appAnneeCourante = e.target.value;

    semaines = [];

    semaineActive.iso_lundi = null;

    weekStatusIndex = new Map();

    semainesCibles.clear();

    bufferEdition.meta = { type: "A", trimestre: "T1", semestre: "S1" };

    bufferEdition.grid = new Map();

    _calendarEnsuredOnce = false;

    syncState = "unknown";

    await refresh();

  };



  document.querySelectorAll(".edt-meta[data-k][data-v]").forEach(btn => {

    btn.onclick = async () => {

      const k = btn.dataset.k;

      const v = btn.dataset.v;

      bufferEdition.meta = { ...bufferEdition.meta, [k]: v };

      syncState = "dirty";

      await refresh();

    };

  });



  document.querySelectorAll(".edt-weekbtn[data-week-index]").forEach(b => {

    b.onclick = async (e) => {

      e.stopPropagation();

      syncState = "unknown";

      semaineRefIndex = Number(b.dataset.weekIndex);

      await refresh();

    };

  });



  document.querySelectorAll(".edt-weekcheck[data-iso]").forEach(cb => {

    cb.onclick = (e) => {

      e.stopPropagation();

      if (cb.checked) semainesCibles.add(cb.dataset.iso);

      else semainesCibles.delete(cb.dataset.iso);

    };

  });



  document.querySelectorAll(".edt-cell[data-j][data-c]").forEach(td => {

    td.onclick = async () => {

      await ouvrirModal(td.dataset.j, td.dataset.c);

    };

  });



  if (valider) valider.onclick = async () => {

    try {

      const sourceIso = semaineActive.iso_lundi;

      

      // BRANCHEMENT FIXE 5 : On exécute d'abord l'écriture de la source depuis le buffer actif

      await saveWeek(sourceIso);



      const targets = Array.from(semainesCibles).filter(x => x !== sourceIso);

      if (targets.length) {

        await applyWeekToTargets(sourceIso, targets);

      }



      await loadWeekStatusIndex();

      semainesCibles.clear();



      // BRANCHEMENT FIXE 6 : On ne réappelle PAS loadWeek ici, l'état local a déjà été synchronisé proprement par saveWeek

      syncState = "ok";

      lastSyncAt = new Date();

      await refresh();



    } catch (e) {

      console.error(e);

      syncState = "error";

      await refresh();

    }

  };

}



/* ======================================================

   BLOC 13 — MODALE cellule (classe/groupe)

   ====================================================== */



async function ouvrirModal(jour, creneau) {

  const options = await getClassesOptions();

  const key = `${jour}|${creneau}`;

  const current = bufferEdition.grid.get(key) || { classe_id: null, groupe: null, classe_nom: null };



  const optHtml = options.map(o => {

    const v = `${o.classe_id || ""}|${o.groupe || ""}`;

    const cur = `${current.classe_id || ""}|${current.groupe || ""}`;

    return `<option value="${v}" ${v === cur ? "selected" : ""}>${escapeHtml(o.label)}</option>`;

  }).join("");



  document.getElementById("modal").innerHTML = `

    <div class="card">

      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">

        <strong>${escapeHtml(capitalize(jour))} — ${escapeHtml(creneau)}</strong>

        <button id="edtModalClose">✕</button>

      </div>

      <div style="height:10px"></div>

      <select id="edtSel">${optHtml}</select>

      <div style="height:10px"></div>

      <div style="display:flex;gap:10px;">

        <button id="edtOk">OK</button>

        <button id="edtCancel">Annuler</button>

      </div>

    </div>

  `;



  const close = () => { document.getElementById("modal").innerHTML = ""; };



  document.getElementById("edtModalClose").onclick = close;

  document.getElementById("edtCancel").onclick = close;



  document.getElementById("edtOk").onclick = async () => {

    const [classe_id_raw, groupe_raw] = document.getElementById("edtSel").value.split("|");

    const classe_id = classe_id_raw ? classe_id_raw : null;

    const groupe = groupe_raw ? groupe_raw : null;



    if (!classe_id) {

      bufferEdition.grid.set(key, { classe_id: null, classe_nom: null, groupe: null });

    } else {

      const opt = options.find(o =>

        (String(o.classe_id || "") === String(classe_id || "")) &&

        (String(o.groupe || "") === String(groupe || ""))

      );

      const nom = opt ? opt.label.replace(" gr 1","").replace(" gr 2","") : "—";

      bufferEdition.grid.set(key, { classe_id, classe_nom: nom, groupe });

    }



    syncState = "dirty";

    close();

    await refresh();

  };

}



/* ======================================================

   BLOC 14 — REFRESH SPA

   ====================================================== */



async function refresh() {

  const app = document.getElementById("app");

  app.innerHTML = await renderEmploiDuTemps();

  bindEmploiDuTempsEvents();

}



/* ======================================================

   BLOC 15 — ACCÈS MÉTIER (lecture)

   ====================================================== */



export function getEDTActiveWeek() {

  return {

    iso_lundi: semaineActive.iso_lundi,

    meta: { ...semaineActive.meta },

    status: semaineActive.status

  };

} 

