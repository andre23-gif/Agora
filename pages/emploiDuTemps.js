/* === AG_EDT_PAGE_REWRITE_V1_BUFFER =====================================
   Page : Emploi du Temps (EDT) — SANS MODÈLE
   Métier :
     - 1 semaine = 1 document (edt_weeks + edt_cells)
     - semaine visible même vide
     - modification via bufferEdition (édition temporaire)
     - "Valider" = injecter bufferEdition -> semaineActive, enregistrer semaine active + appliquer aux semaines cochées
   Dépendances :
     - window.sb (supabase-js)
     - window.appAnneeCourante ("YYYY-YYYY")
   =============================================================== */

/* ======================================================
   BLOC 1 — CONSTANTES (créneaux + jours)
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
const TYPES = ["A", "B", "V"];
const TRIMESTRES = ["T1", "T2", "T3"];
const SEMESTRES = ["S1", "S2"];

/* ======================================================
   BLOC 2 — ÉTAT LOCAL (SANS MODÈLE)
   ====================================================== */

let semaines = [];                // [{ isoLundi, lundi:Date, weekNo, weekYear }]
let semaineRefIndex = 0;          // index semaine affichée

let semainesCibles = new Set();   // iso_lundi cochés pour application

let weekStatusIndex = new Map();  // iso_lundi -> { has_data, type, trimestre, semestre, last_update }

let semaineActive = {
  iso_lundi: null,
  meta: { type: "A", trimestre: "T1", semestre: "S1" },
  grid: new Map(),               // key "jour|creneau" -> { classe_id, classe_nom, groupe }
  status: "idle"                 // idle|loading|empty|loaded|dirty|saving|error
};

/* ======================================================
   BLOC 2B — BUFFER D'ÉDITION (NOUVEAU, SEUL AJOUT STRUCTUREL)
   ====================================================== */

let bufferEdition = {
  meta: { type: "A", trimestre: "T1", semestre: "S1" },
  grid: new Map()                // key "jour|creneau" -> { classe_id, classe_nom, groupe }
};

let syncState = "unknown";        // ok|dirty|error|unknown
let lastSyncAt = null;

/* ======================================================
   BLOC 3 — SUPABASE HELPERS
   ====================================================== */

function requireSupabase() {
  if (!window.sb) throw new Error("Supabase non initialisé (window.sb absent).");
  return window.sb;
}

function sbAgoram() {
  return requireSupabase().schema("agoram");
}

async function getActiveAnneeId() {
  const sb = sbAgoram();
  const { data, error } = await sb
    .from("annees")
    .select("id")
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(`Impossible de lire 'annees'. ${error.message}`);
  return data ? data.id : null;
}

/* ======================================================
   BLOC 4 — OUTILS DATE (ISO semaine)
   ====================================================== */

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function formatFR(d) {
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function mondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7; // dimanche=7
  if (day !== 1) d.setDate(d.getDate() - day + 1);
  d.setHours(0,0,0,0);
  return d;
}

function getNowDate() {
  if (window.APP_SERVER_DATE_ISO) {
    const [y, m, dd] = window.APP_SERVER_DATE_ISO.split("-").map(Number);
    return new Date(y, m - 1, dd);
  }
  return new Date();
}

function getISOWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const weekYear = d.getUTCFullYear();

  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

  return { weekYear, weekNo };
}

function mondayOfISOWeek(weekYear, weekNo) {
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));

  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (weekNo - 1) * 7);

  return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0,0,0,0);
}

function isoWeeksInYear(weekYear) {
  const dec28 = new Date(Date.UTC(weekYear, 11, 28));
  return getISOWeekInfo(new Date(dec28.getUTCFullYear(), dec28.getUTCMonth(), dec28.getUTCDate())).weekNo;
}

function parseAnneeScolaire(str) {
  const m = String(str || "").match(/^(\d{4})-(\d{4})$/);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

function getAnneeScolaireCourante() {
  return parseAnneeScolaire(window.appAnneeCourante || "2025-2026")
    || { start: 2025, end: 2026 };
}

function makeWeekItem(lundi) {
  const { weekYear, weekNo } = getISOWeekInfo(lundi);
  return { isoLundi: toISODate(lundi), lundi, weekYear, weekNo };
}

function genererSemainesScolaires() {
  const { start, end } = getAnneeScolaireCourante();
  const startWeek = 35;
  const endWeek = 34;

  const lastWeekStartYear = isoWeeksInYear(start);
  const out = [];

  for (let w = startWeek; w <= lastWeekStartYear; w++) out.push(makeWeekItem(mondayOfISOWeek(start, w)));
  for (let w = 1; w <= endWeek; w++) out.push(makeWeekItem(mondayOfISOWeek(end, w)));

  return out;
}

function positionnerSemaineCourante() {
  const now = getNowDate();
  const isoCourant = toISODate(mondayOfWeek(now));
  const idx = semaines.findIndex(s => s.isoLundi === isoCourant);
  semaineRefIndex = idx >= 0 ? idx : 0;
}

/* ======================================================
   BLOC 5 — INIT PAGE (calendrier + index semaines)
   ====================================================== */

function ensureCalendar() {
  if (semaines.length === 0) {
    semaines = genererSemainesScolaires();
    positionnerSemaineCourante();
  }
}

/* ======================================================
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

  const defaults = semaineActive?.meta || { type: "A", trimestre: "T1", semestre: "S1" };

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
  syncState = "unknown";

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
  (cells || []).forEach(c => {
    const key = `${c.jour}|${c.creneau}`;
    grid.set(key, {
      classe_id: c.classe_id || null,
      classe_nom: c.classe_id ? (idToNom.get(c.classe_id) || "—") : null,
      groupe: c.groupe || null
    });
  });

  semaineActive = {
    iso_lundi: isoLundi,
    meta: {
      type: (w?.type || "A"),
      trimestre: (w?.trimestre || "T1"),
      semestre: (w?.semestre || "S1")
    },
    grid,
    status: (cells && cells.length) ? "loaded" : "empty"
  };

  const idx = weekStatusIndex.get(String(isoLundi));
  if (idx) {
    idx.type = semaineActive.meta.type;
    idx.trimestre = semaineActive.meta.trimestre;
    idx.semestre = semaineActive.meta.semestre;
    idx.has_data = (cells && cells.length) ? true : idx.has_data;
    weekStatusIndex.set(String(isoLundi), idx);
  }

  /* === AG_EDT_BUFFER_SYNC_FROM_WEEK_V1 =====================
     Copie de la semaine réelle -> bufferEdition (édition temporaire)
     ======================================================== */
  bufferEdition.meta = { ...semaineActive.meta };
  bufferEdition.grid = new Map(
    Array.from(semaineActive.grid.entries()).map(([k, v]) => [k, v ? { ...v } : v])
  );
  /* === AG_EDT_BUFFER_SYNC_FROM_WEEK_V1_END ================= */

  syncState = "ok";
  lastSyncAt = new Date();
}

/* ======================================================
   BLOC 9 — DATA : enregistrer une semaine
   ====================================================== */

async function saveWeek(isoLundi) {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) throw new Error("Aucune année active.");

  const sb = sbAgoram();
  semaineActive.status = "saving";

  const meta = semaineActive.meta;

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

  const { error: errDel } = await sb
    .from("edt_cells")
    .delete()
    .eq("annee_id", anneeId)
    .eq("iso_lundi", isoLundi);

  if (errDel) throw new Error(`Delete edt_cells impossible. ${errDel.message}`);

  const payload = [];
  for (const [key, v] of semaineActive.grid.entries()) {
    if (!v || !v.classe_id) continue;
    const [jour, creneau] = key.split("|");
    payload.push({
      annee_id: anneeId,
      iso_lundi: isoLundi,
      jour,
      creneau,
      classe_id: v.classe_id,
      groupe: v.groupe || null
    });
  }

  if (payload.length) {
    const { error: errIns } = await sb
      .from("edt_cells")
      .insert(payload);

    if (errIns) throw new Error(`Insert edt_cells impossible. ${errIns.message}`);
  }

  const prev = weekStatusIndex.get(String(isoLundi)) || {};
  weekStatusIndex.set(String(isoLundi), {
    has_data: payload.length > 0,
    type: meta.type,
    trimestre: meta.trimestre,
    semestre: meta.semestre,
    last_update: new Date().toISOString(),
    ...prev
  });

  syncState = "ok";
  lastSyncAt = new Date();
  semaineActive.status = payload.length ? "loaded" : "empty";
}

/* ======================================================
   BLOC 10 — DATA : appliquer semaine active aux cibles
   ====================================================== */

async function applyWeekToTargets(sourceIso, targetsIsoList) {
  if (!targetsIsoList.length) return;

  const savedGrid = new Map(semaineActive.grid);
  const savedMeta = { ...semaineActive.meta };

  for (const iso of targetsIsoList) {
    semaineActive.iso_lundi = iso;
    semaineActive.meta = { ...savedMeta };
    semaineActive.grid = new Map(savedGrid);
    await saveWeek(iso);
  }

  // Restore source (UI cohérente)
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
  const v = bufferEdition.grid.get(key); // ✅ affichage buffer
  if (!v || !v.classe_id) return "&nbsp;";
  const nom = escapeHtml(v.classe_nom || "—");
  return v.groupe ? `${nom} ${escapeHtml(v.groupe)}` : nom;
}

function metaButton(k, v, active) {
  return `<button class="edt-meta" data-k="${k}" data-v="${v}" ${active ? 'data-active="1"' : ""}>${v}</button>`;
}

export async function renderEmploiDuTemps() {
  ensureCalendar();

  const annee = window.appAnneeCourante || `${getAnneeScolaireCourante().start}-${getAnneeScolaireCourante().end}`;

  if (weekStatusIndex.size === 0) {
    try { await loadWeekStatusIndex(); } catch (e) { console.error(e); }
  }

  const sem = semaines[semaineRefIndex];

  if (!semaineActive.iso_lundi || semaineActive.iso_lundi !== sem.isoLundi) {
    try {
      await loadWeek(sem.isoLundi);
    } catch (e) {
      console.error(e);
      syncState = "error";
    }
  }

  const meta = bufferEdition.meta; // ✅ meta buffer

  return `
    <section class="page page-edt">

      <div class="topbar">

        <button id="prev">◀</button>

        <strong>
          ${weekLabel(sem)}
        </strong>

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
            syncState === "dirty" ? "🟠 Modifié" :
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
    semaineRefIndex = Math.max(0, semaineRefIndex - 1);
    await refresh();
  };

  if (next) next.onclick = async () => {
    semaineRefIndex = Math.min(semaines.length - 1, semaineRefIndex + 1);
    await refresh();
  };

  if (weekSelect) weekSelect.onchange = async (e) => {
    semaineRefIndex = Number(e.target.value);
    await refresh();
  };

  if (anneeSelect) anneeSelect.onchange = async (e) => {
    window.appAnneeCourante = e.target.value;
    semaines = [];
    semaineActive.iso_lundi = null;
    weekStatusIndex = new Map();
    semainesCibles.clear();

    /* reset buffer */
    bufferEdition.meta = { type: "A", trimestre: "T1", semestre: "S1" };
    bufferEdition.grid = new Map();

    await refresh();
  };

 document.querySelectorAll(".edt-meta[data-k][data-v]").forEach(btn => {
  btn.onclick = async () => {

    const k = btn.dataset.k;
    const v = btn.dataset.v;

    // ✅ mettre à jour le buffer correctement
    bufferEdition.meta = {
      ...bufferEdition.meta,
      [k]: v
    };

    syncState = "dirty";
    await refresh();
  };
});
``

  /* === AG_EDT_WEEK_INTERACTIONS_V1_BEGIN ========================= */

  document.querySelectorAll(".edt-weekbtn[data-week-index]").forEach(b => {
    b.onclick = async (e) => {
      e.stopPropagation();
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

  /* === AG_EDT_WEEK_INTERACTIONS_V1_END =========================== */

  document.querySelectorAll(".edt-cell[data-j][data-c]").forEach(td => {
    td.onclick = async () => {
      await ouvrirModal(td.dataset.j, td.dataset.c);
    };
  });

  if (valider) valider.onclick = async () => {
    try {
      syncState = "unknown";

      /* === AG_EDT_BUFFER_INJECT_ON_VALIDATE_V1 =====================
         Injecter bufferEdition -> semaineActive juste avant écriture
         ============================================================ */
      semaineActive.meta = { ...bufferEdition.meta };
      semaineActive.grid = new Map(
        Array.from(bufferEdition.grid.entries()).map(([k, v]) => [k, v ? { ...v } : v])
      );
      /* === AG_EDT_BUFFER_INJECT_ON_VALIDATE_V1_END ================= */

      // 1) enregistrer semaine active
      const sourceIso = semaineActive.iso_lundi;
      await saveWeek(sourceIso);

      // 2) appliquer si cibles cochées (hors source)
      const targets = Array.from(semainesCibles).filter(x => x !== sourceIso);
      if (targets.length) {
        await applyWeekToTargets(sourceIso, targets);
      }

      // 3) rafraîchir index + UI
      await loadWeekStatusIndex();
      semainesCibles.clear();

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
  const current = bufferEdition.grid.get(key) || { classe_id: null, groupe: null, classe_nom: null }; // ✅ buffer

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

      <select id="edtSel">
        ${optHtml}
      </select>

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
      bufferEdition.grid.delete(key);
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
