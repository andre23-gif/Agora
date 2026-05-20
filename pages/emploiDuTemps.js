/* ======================================================
   ÉTATS GLOBAUX & STRUCTURES D'ORIGINE
   ====================================================== */

let semaines = [];
let semaineRefIndex = -1;
let weekStatusIndex = new Map();
let semainesCibles = new Set();
let syncState = "ok"; 
let lastSyncAt = null;

let semaineActive = {
  iso_lundi: null,
  meta: { type: "A", trimestre: "T1", semestre: "S1" },
  grid: new Map(),
  status: "empty"
};

let bufferEdition = {
  meta: { type: "A", trimestre: "T1", semestre: "S1" },
  grid: new Map()
};

// TES HORAIRES STRICTS ET EXACTS REPLUGGÉS ICI
export const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export const TYPES = ["A", "B"];
export const TRIMESTRES = ["T1", "T2", "T3"];
export const SEMESTRES = ["S1", "S2"];
export const CRENEAUX = [
  { code: "M1", debut: "08:30", fin: "09:25" },
  { code: "M2", debut: "09:25", fin: "10:20" },
  { code: "M3", debut: "10:35", fin: "11:30" },
  { code: "M4", debut: "11:30", fin: "12:25" },
  { code: "S1", debut: "13:30", fin: "14:25" },
  { code: "S2", debut: "14:25", fin: "15:20" },
  { code: "S3", debut: "15:35", fin: "16:30" },
  { code: "S4", debut: "16:30", fin: "17:25" },
  { code: "PM", debut: "Mercredi", fin: "Après-midi" }
];

/* ======================================================
   UTILITAIRES DE BASE
   ====================================================== */

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatFR(dateObj) {
  if (!dateObj) return "";
  const d = new Date(dateObj);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

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

/* ======================================================
   FONCTIONS CALENDRIER ET ACCÈS RÉSEAU
   ====================================================== */

export function getAnneeScolaireCourante() {
  const now = new Date();
  const year = now.getFullYear();
  if (now.getMonth() >= 7) {
    return { start: year, end: year + 1 };
  } else {
    return { start: year - 1, end: year };
  }
}

async function ensureCalendar() {
  if (semaines && semaines.length > 0) return;
  const annee = window.appAnneeCourante || `${getAnneeScolaireCourante().start}-${getAnneeScolaireCourante().end}`;
  const [yearStart] = annee.split("-").map(Number);
  
  let current = new Date(yearStart, 8, 1); 
  const day = current.getDay();
  const diff = current.getDate() - day + (day === 0 ? -6 : 1);
  current = new Date(current.setDate(diff));

  const end = new Date(yearStart + 1, 6, 31); 
  const list = [];

  while (current <= end) {
    const isoLundi = current.toISOString().split("T")[0];
    const d = new Date(Date.UTC(current.getFullYear(), current.getMonth(), current.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStartIso = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStartIso) / 86400000) + 1) / 7);

    list.push({ isoLundi, lundi: new Date(current), weekNo, weekYear: d.getUTCFullYear() });
    current.setDate(current.getDate() + 7);
  }
  semaines = list;
  if (semaineRefIndex === -1 && semaines.length > 0) semaineRefIndex = 0;
}

async function getActiveAnneeId() {
  const sb = sbAgoram();
  const codeAnnee = window.appAnneeCourante || `${getAnneeScolaireCourante().start}-${getAnneeScolaireCourante().end}`;
  const { data, error } = await sb.from("annees").select("id").eq("code", codeAnnee).maybeSingle();
  if (error) throw new Error(`Impossible de récupérer l'ID de l'année : ${error.message}`);
  return data ? data.id : null;
}

async function getClassesOptions() {
  const sb = sbAgoram();
  const { data, error } = await sb.from("classes").select("id, nom, code").order("nom");
  if (error) return [{ classe_id: null, groupe: null, label: "Erreur" }];

  const options = [{ classe_id: null, groupe: null, label: "[ Retirer le cours ]" }];
  if (data) {
    for (const c of data) {
      options.push({ classe_id: c.id, groupe: null, label: c.nom });
      options.push({ classe_id: c.id, groupe: "gr 1", label: `${c.nom} gr 1` });
      options.push({ classe_id: c.id, groupe: "gr 2", label: `${c.nom} gr 2` });
    }
  }
  return options;
}

/* ======================================================
   REPARATION : ensureWeekRow (RÉPARATION CRASH 409)
   ====================================================== */

async function ensureWeekRow(anneeId, isoLundi) {
  const sb = sbAgoram();
  const { error } = await sb
    .from("edt_weeks")
    .upsert([
      { annee_id: anneeId, iso_lundi: isoLundi, type: "A", trimestre: "T1", semestre: "S1" }
    ], { onConflict: "annee_id,iso_lundi" });

  if (error) throw new Error(`Création de la ligne de semaine impossible. ${error.message}`);
}

/* ======================================================
   FONCTION loadWeek
   ====================================================== */

async function loadWeek(isoLundi) {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) throw new Error("Aucune année active.");

  await ensureWeekRow(anneeId, isoLundi);
  const sb = sbAgoram();

  const { data: wData, error: wErr } = await sb
    .from("edt_weeks")
    .select("type, trimestre, semestre")
    .eq("annee_id", anneeId)
    .eq("iso_lundi", isoLundi)
    .maybeSingle();

  if (wErr) throw new Error(`Erreur loadWeek (meta): ${wErr.message}`);

  const { data: cData, error: cErr } = await sb
    .from("edt_cells")
    .select(`jour, creneau, classe_id, groupe, classes:classe_id ( nom )`)
    .eq("annee_id", anneeId)
    .eq("iso_lundi", isoLundi);

  if (cErr) throw new Error(`Erreur loadWeek (cells): ${cErr.message}`);

  semaineActive.iso_lundi = isoLundi;
  semaineActive.meta = {
    type: wData?.type || "A",
    trimestre: wData?.trimestre || "T1",
    semestre: wData?.semestre || "S1"
  };

  semaineActive.grid = new Map();
  if (cData) {
    for (const c of cData) {
      const key = `${c.jour}|${c.creneau}`;
      semaineActive.grid.set(key, {
        classe_id: c.classe_id,
        classe_nom: c.classes?.nom || "—",
        groupe: c.groupe
      });
    }
  }

  bufferEdition.meta = { ...semaineActive.meta };
  bufferEdition.grid = new Map(
    Array.from(semaineActive.grid.entries()).map(([k, v]) => [k, { ...v }])
  );

  semaineActive.status = "loaded";
  syncState = "ok";
}

/* ======================================================
   REPARATION : saveWeek (RÉPARATION SEMAINE VIDE)
   ====================================================== */

async function saveWeek(isoLundi) {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) throw new Error("Aucune année active.");

  const sb = sbAgoram();
  semaineActive.status = "saving";
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

  const { error: errDel } = await sb
    .from("edt_cells")
    .delete()
    .eq("annee_id", anneeId)
    .eq("iso_lundi", isoLundi);

  if (errDel) throw new Error(`Delete edt_cells impossible. ${errDel.message}`);

  const payload = [];
  for (const [key, v] of bufferEdition.grid.entries()) {
    if (!v || !v.classe_id || String(v.classe_id).trim() === "") continue;
    
    const [jour, creneau] = key.split("|");
    const cleanClasseId = isNaN(v.classe_id) ? v.classe_id : parseInt(v.classe_id, 10);

    payload.push({
      annee_id: anneeId,
      iso_lundi: isoLundi,
      jour: jour,
      creneau: creneau,
      classe_id: cleanClasseId,
      groupe: v.groupe || null
    });
  }

  if (payload.length > 0) {
    const { error: errIns } = await sb.from("edt_cells").insert(payload);
    if (errIns) throw new Error(`Insert edt_cells impossible. ${errIns.message}`);
  }

  const prev = weekStatusIndex.get(String(isoLundi)) || {};
  weekStatusIndex.set(String(isoLundi), {
    ...prev,
    has_data: payload.length > 0,
    type: meta.type,
    trimestre: meta.trimestre,
    semestre: meta.semestre,
    last_update: new Date().toISOString()
  });

  semaineActive.status = payload.length ? "loaded" : "empty";
}

/* ======================================================
   FONCTION applyWeekToTargets
   ====================================================== */

async function applyWeekToTargets(sourceIso, targetIsos) {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return;

  const sb = sbAgoram();
  const meta = bufferEdition.meta;

  const weeksPayload = targetIsos.map(iso => ({
    annee_id: anneeId,
    iso_lundi: iso,
    type: meta.type,
    trimestre: meta.trimestre,
    semestre: meta.semestre
  }));

  const { error: wErr } = await sb.from("edt_weeks").upsert(weeksPayload, { onConflict: "annee_id,iso_lundi" });
  if (wErr) throw wErr;

  const { error: dErr } = await sb.from("edt_cells").delete().eq("annee_id", anneeId).in("iso_lundi", targetIsos);
  if (dErr) throw dErr;

  const cellsPayload = [];
  for (const [key, v] of bufferEdition.grid.entries()) {
    if (!v || !v.classe_id) continue;
    const [jour, creneau] = key.split("|");
    const cleanClasseId = isNaN(v.classe_id) ? v.classe_id : parseInt(v.classe_id, 10);

    for (const targetIso of targetIsos) {
      cellsPayload.push({
        annee_id: anneeId,
        iso_lundi: targetIso,
        jour: jour,
        creneau: creneau,
        classe_id: cleanClasseId,
        groupe: v.groupe || null
      });
    }
  }

  if (cellsPayload.length > 0) {
    const { error: iErr } = await sb.from("edt_cells").insert(cellsPayload);
    if (iErr) throw iErr;
  }
}

async function loadWeekStatusIndex() {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return;
  const sb = sbAgoram();
  const { data, error } = await sb.from("edt_weeks").select("iso_lundi, type, trimestre, semestre").eq("annee_id", anneeId);
  if (error) throw new Error(`Erreur loadWeekStatusIndex : ${error.message}`);
  weekStatusIndex.clear();
  if (data) {
    for (const w of data) {
      weekStatusIndex.set(String(w.iso_lundi), { has_data: true, type: w.type, trimestre: w.trimestre, semestre: w.semestre });
    }
  }
}

/* ======================================================
   REPARATION : renderEmploiDuTemps (FLUX SEMAINE)
   ====================================================== */

export async function renderEmploiDuTemps() {
  await ensureCalendar();
  const annee = window.appAnneeCourante || `${getAnneeScolaireCourante().start}-${getAnneeScolaireCourante().end}`;

  if (weekStatusIndex.size === 0) {
    try { await loadWeekStatusIndex(); } catch (e) { console.error(e); }
  }

  const sem = semaines[semaineRefIndex];

  // SÉCURITÉ : Forcer la lecture Supabase au saut de semaine
  if (semaineActive.iso_lundi !== sem.isoLundi) {
    try {
      await loadWeek(sem.isoLundi);
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
            <option value="${i}" ${i === semaineRefIndex ? "selected" : ""}>${weekLabel(s)}</option>
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
          ${syncState === "ok" ? "🟢 Sync OK" : syncState === "dirty" ? "🟠 Modifié" : syncState === "error" ? "🔴 Erreur" : "⚪ —"}
        </span>
        <span id="edtSyncTime">${lastSyncAt ? lastSyncAt.toLocaleTimeString("fr-FR") : ""}</span>
        <button id="valider">Valider</button>
      </div>

      <div class="edt-body">
        <div class="edt-leftpanel">
          <div class="edt-weeklist">
            ${semaines.map((s, i) => {
              const iso = s.isoLundi;
              const checked = semainesCibles.has(iso) ? "checked" : "";
              const st = weekStatusIndex.get(String(iso));
              const dot = st && st.has_data ? "🟦" : "⬜";

              return `
                <div class="edt-weekrow ${i === semaineRefIndex ? "active" : ""}">
                  <input type="checkbox" class="edt-weekcheck" data-iso="${iso}" ${checked}>
                  <span class="edt-weekbtn" data-week-index="${i}">${dot} ${escapeHtml(weekLabel(s))}</span>
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
   REPARATION : bindEmploiDuTempsEvents (SECURITE ANNEE)
   ====================================================== */

export function bindEmploiDuTempsEvents() {
  const prev = document.getElementById("prev");
  const next = document.getElementById("next");
  const weekSelect = document.getElementById("weekSelect");
  const anneeSelect = document.getElementById("anneeSelect");
  const valider = document.getElementById("valider");

  if (prev) prev.onclick = async () => { semaineRefIndex = Math.max(0, semaineRefIndex - 1); await refresh(); };
  if (next) next.onclick = async () => { semaineRefIndex = Math.min(semaines.length - 1, semaineRefIndex + 1); await refresh(); };
  if (weekSelect) weekSelect.onchange = async (e) => { semaineRefIndex = Number(e.target.value); await refresh(); };

  if (anneeSelect) anneeSelect.onchange = async (e) => {
    window.appAnneeCourante = e.target.value;
    semaines = [];
    semaineRefIndex = -1; 
    semaineActive.iso_lundi = null; 
    weekStatusIndex = new Map();
    semainesCibles.clear();
    bufferEdition.meta = { type: "A", trimestre: "T1", semestre: "S1" };
    bufferEdition.grid = new Map();
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
    b.onclick = async (e) => { e.stopPropagation(); semaineRefIndex = Number(b.dataset.weekIndex); await refresh(); };
  });

  document.querySelectorAll(".edt-weekcheck[data-iso]").forEach(cb => {
    cb.onclick = (e) => { e.stopPropagation(); if (cb.checked) semainesCibles.add(cb.dataset.iso); else semainesCibles.delete(cb.dataset.iso); };
  });

  document.querySelectorAll(".edt-cell[data-j][data-c]").forEach(td => {
    td.onclick = async () => { await ouvrirModal(td.dataset.j, td.dataset.c); };
  });

  if (valider) valider.onclick = async () => {
    try {
      syncState = "unknown";
      semaineActive.meta = { ...bufferEdition.meta };
      semaineActive.grid = new Map(Array.from(bufferEdition.grid.entries()).map(([k, v]) => [k, v ? { ...v } : v]));

      const sourceIso = semaineActive.iso_lundi;
      await saveWeek(sourceIso);

      const targets = Array.from(semainesCibles).filter(x => x !== sourceIso);
      if (targets.length) await applyWeekToTargets(sourceIso, targets);

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
   FONCTION ouvrirModal
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
      bufferEdition.grid.delete(key);
    } else {
      const opt = options.find(o => (String(o.classe_id || "") === String(classe_id || "")) && (String(o.groupe || "") === String(groupe || "")));
      const nom = opt ? opt.label.replace(" gr 1","").replace(" gr 2","") : "—";
      bufferEdition.grid.set(key, { classe_id, classe_nom: nom, groupe });
    }
    syncState = "dirty";
    close();
    await refresh();
  };
}

/* ======================================================
   FONCTION refresh
   ====================================================== */

async function refresh() {
  const app = document.getElementById("app");
  if (app) {
    app.innerHTML = await renderEmploiDuTemps();
    bindEmploiDuTempsEvents();
  }
}

/* ======================================================
   FONCTIONS CONTRACTUELLES VERS LES AUTRES PAGES
   ====================================================== */

export function getEDTActiveWeek() {
  return {
    iso_lundi: semaineActive.iso_lundi,
    meta: { ...semaineActive.meta },
    status: semaineActive.status
  };
}

export function getCreneauCourant() {
  const now = new Date();
  const HH = String(now.getHours()).padStart(2,"0");
  const MM = String(now.getMinutes()).padStart(2,"0");
  const heureIndex = `${HH}:${MM}`;

  for (const cr of CRENEAUX) {
    if (cr.code === "PM") continue;
    if (heureIndex >= cr.debut && heureIndex <= cr.fin) return cr;
  }
  return null;
}

export function getJourCourant() {
  const idx = new Date().getDay();
  const map = [null, "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", null];
  return map[idx] || null;
}
