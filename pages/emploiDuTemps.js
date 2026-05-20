/* ======================================================
   FONCTIONS ET ÉTATS GLOBAUX — DÉBUT DU FICHIER
   ====================================================== */

// Vos variables d'état (state) globales au fichier
let semaines = [];
let semaineRefIndex = -1;
let weekStatusIndex = new Map();
let semainesCibles = new Set();
let syncState = "ok"; // ok, dirty, error, unknown
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

// Constantes de structure
const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const TYPES = ["A", "B"];
const TRIMESTRES = ["T1", "T2", "T3"];
const SEMESTRES = ["S1", "S2"];
const CRENEAUX = [
  { code: "M1", debut: "08:00", fin: "08:55" },
  { code: "M2", debut: "08:55", fin: "09:50" },
  { code: "M3", debut: "10:05", fin: "11:00" },
  { code: "M4", debut: "11:00", fin: "11:55" },
  { code: "M5", debut: "11:55", fin: "12:50" },
  { code: "A1", debut: "13:00", fin: "13:55" },
  { code: "A2", debut: "13:55", fin: "14:50" },
  { code: "A3", debut: "15:05", fin: "16:00" },
  { code: "A4", debut: "16:00", fin: "16:55" },
  { code: "A5", debut: "17:00", fin: "17:55" },
  { code: "PM", debut: "Mercredi", fin: "Après-midi" }
];

/* ======================================================
   BLOC 7 — DATA : ensureWeekRow (CORRIGÉ ET SÉCURISÉ)
   ====================================================== */

async function ensureWeekRow(anneeId, isoLundi) {
  const sb = sbAgoram();

  // Sécurité UPSERT : Si la ligne existe, Supabase la laisse tranquille, sinon il la crée.
  const { error } = await sb
    .from("edt_weeks")
    .upsert(
      [
        { 
          annee_id: anneeId, 
          iso_lundi: isoLundi, 
          type: "A", 
          trimestre: "T1", 
          semestre: "S1" 
        }
      ], 
      { onConflict: "annee_id,iso_lundi" }
    );

  if (error) {
    throw new Error(`Création de la ligne de semaine impossible. ${error.message}`);
  }
}

/* ======================================================
   BLOC 8 — DATA : loadWeek (Chargement d'une semaine)
   ====================================================== */

async function loadWeek(isoLundi) {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) throw new Error("Aucune année active.");

  await ensureWeekRow(anneeId, isoLundi);

  const sb = sbAgoram();

  // 1. Charger les métadonnées de la semaine
  const { data: wData, error: wErr } = await sb
    .from("edt_weeks")
    .select("type, trimestre, semestre")
    .eq("annee_id", anneeId)
    .eq("iso_lundi", isoLundi)
    .maybeSingle();

  if (wErr) throw new Error(`Erreur loadWeek (meta): ${wErr.message}`);

  // 2. Charger les cellules de cours de la semaine
  const { data: cData, error: cErr } = await sb
    .from("edt_cells")
    .select(`
      jour, creneau, classe_id, groupe,
      classes:classe_id ( nom )
    `)
    .eq("annee_id", anneeId)
    .eq("iso_lundi", isoLundi);

  if (cErr) throw new Error(`Erreur loadWeek (cells): ${cErr.message}`);

  // 3. Mettre à jour l'état de l'application
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

  // Synchronisation du buffer de travail (copie miroir pour l'édition)
  bufferEdition.meta = { ...semaineActive.meta };
  bufferEdition.grid = new Map(
    Array.from(semaineActive.grid.entries()).map(([k, v]) => [k, { ...v }])
  );

  semaineActive.status = "loaded";
  syncState = "ok";
}

/* ======================================================
   BLOC 9 — DATA : saveWeek (Sauvegarde complète propre)
   ====================================================== */

async function saveWeek(isoLundi) {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) throw new Error("Aucune année active.");

  const sb = sbAgoram();
  semaineActive.status = "saving";

  const meta = bufferEdition.meta;

  // Enregistrement/Mise à jour des métadonnées de la semaine
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

  // Nettoyage des anciennes cellules existantes pour cette semaine
  const { error: errDel } = await sb
    .from("edt_cells")
    .delete()
    .eq("annee_id", anneeId)
    .eq("iso_lundi", isoLundi);

  if (errDel) throw new Error(`Delete edt_cells impossible. ${errDel.message}`);

  // Préparation du payload depuis notre buffer d'édition
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

  // Insertion des nouvelles cellules s'il y en a
  if (payload.length > 0) {
    const { error: errIns } = await sb.from("edt_cells").insert(payload);
    if (errIns) throw new Error(`Insert edt_cells impossible. ${errIns.message}`);
  }

  // Mise à jour de l'index des statuts locaux pour l'UI (le petit carré bleu)
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
   BLOC 10 — DATA : Multi-reproduction (Duplication semaines)
   ====================================================== */

async function applyWeekToTargets(sourceIso, targetIsos) {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return;

  const sb = sbAgoram();
  const meta = bufferEdition.meta;

  // 1. On prépare les semaines cibles dans edt_weeks
  const weeksPayload = targetIsos.map(iso => ({
    annee_id: anneeId,
    iso_lundi: iso,
    type: meta.type,
    trimestre: meta.trimestre,
    semestre: meta.semestre
  }));

  const { error: wErr } = await sb
    .from("edt_weeks")
    .upsert(weeksPayload, { onConflict: "annee_id,iso_lundi" });

  if (wErr) throw wErr;

  // 2. On supprime les anciens cours des semaines cibles
  const { error: dErr } = await sb
    .from("edt_cells")
    .delete()
    .eq("annee_id", anneeId)
    .in("iso_lundi", targetIsos);

  if (dErr) throw dErr;

  // 3. On extrait les cellules du buffer actuel pour les dupliquer
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

  // 4. On envoie tout d'un coup dans Supabase
  if (cellsPayload.length > 0) {
    const { error: iErr } = await sb.from("edt_cells").insert(cellsPayload);
    if (iErr) throw iErr;
  }
}

// --- LA SUITE DU FICHIER EST LE BLOC 11 DE NOTRE DISCUSSIONS PRÉCÉDENTE ---
/* ======================================================
   BLOC 11 — RENDU (UI) — VERSION FINALE SÉCURISÉE
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

  // CORRECTION SÉCURITÉ : Si la semaine affichée change, on FORCE le rechargement depuis Supabase
  // pour écraser le buffer d'édition de la semaine précédente.
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
   BLOC 12 — EVENTS — VERSION FINALE SÉCURISÉE
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

    // Reset complet et propre de l'état local pour forcer le recalcul
    semaines = [];
    semaineRefIndex = -1; 
    semaineActive.iso_lundi = null; // FORCE loadWeek() à s'exécuter au prochain render
    weekStatusIndex = new Map();
    semainesCibles.clear();

    bufferEdition.meta = { type: "A", trimestre: "T1", semestre: "S1" };
    bufferEdition.grid = new Map(); // Vide le buffer pour éviter les fuites visuelles entre années

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
      syncState = "unknown";
      semaineActive.meta = { ...bufferEdition.meta };
      semaineActive.grid = new Map(
        Array.from(bufferEdition.grid.entries()).map(([k, v]) => [k, v ? { ...v } : v])
      );

      const sourceIso = semaineActive.iso_lundi;
      await saveWeek(sourceIso);

      const targets = Array.from(semainesCibles).filter(x => x !== sourceIso);
      if (targets.length) {
        await applyWeekToTargets(sourceIso, targets);
      }

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
