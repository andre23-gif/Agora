/* === AG_SALLE_IMPORTS_V2_BEGIN ================================= */
import { getEleves } from "./importExport.js";
import * as EDT from "./emploiDuTemps.js";

// --- AJOUT : année active (pour filtrer edt_cells comme dans EDT)
async function getActiveAnneeId() {
  if (!window.sb) return null;
  const sb = window.sb.schema("agoram");
  const { data, error } = await sb
    .from("annees")
    .select("id")
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? data.id : null;
}

/*
  Contrat Salle ↔ EDT (compat)
  - Ancien EDT : exportait getEDT + CRENEAUX
  - Nouveau EDT : peut ne plus exporter getEDT
  => On expose ici un getEDT() compatible pour que le reste de salle.js ne casse pas.
*/
const CRENEAUX = EDT.CRENEAUX;

const getEDT = (...args) => {
  if (typeof EDT.getEDT === "function") return EDT.getEDT(...args);

  // Nouveau contrat : si tu exposes plus tard un getter explicite, branche-le ici.
  // Pour l’instant, on renvoie une structure vide plutôt que casser Salle.
  return {};
};
/* === AG_SALLE_IMPORTS_V2_END =================================== */

/* =======================================================
   PAGE : Salle
   RÔLE MÉTIER :
     - Saisie terrain en situation de classe (assiduité + comportement + participation fin de séance)
     - Affichage spatial de la classe (vue du dessus) : 3 colonnes, 5 rangées, 2 tables / rangée
     - Choix du contenu de séance (code) : proposé par défaut (dernier utilisé) + saisie libre
   LIT :
     - Import/Export : getEleves() (nom/prénom, genre, groupe, adaptations, place)
     - EDT : getEDT() + CRENEAUX (contexte séance : classe/groupe/créneau du moment)
     - LocalStorage : dernier contenu par classe/groupe, événements locaux
     - Supabase : window.sb (si configuré) pour persister la participation (agoram.participations_hg)
   ÉCRIT :
     - Local (toujours) : window.AG_EVENTS + localStorage("AG_EVENTS_V1")
     - Supabase (participation fin de séance) : agoram.participations_hg (upsert)
   ======================================================= */

/* -------------------------------------------------------
   BLOC 1 — RÉFÉRENTIEL CONTENU (codes) — COMPLET
------------------------------------------------------- */

function buildContenusCatalogue() {
  const out = [];

  const addChapitre13 = (prefix, n) => {
    const base = `${prefix}${n}`;
    out.push(`${base} Intro`);
    for (let i = 1; i <= 3; i++) out.push(`${base} 1.${i}`);
    for (let i = 1; i <= 3; i++) out.push(`${base} 2.${i}`);
    for (let i = 1; i <= 3; i++) out.push(`${base} 3.${i}`);
    out.push(`${base} Conclusion`);
    out.push(`${base} DST`);
    out.push(`${base} Correction`);
  };

  for (let n = 1; n <= 10; n++) addChapitre13("H", n);
  for (let n = 1; n <= 10; n++) addChapitre13("G", n);
  for (let n = 1; n <= 5; n++) addChapitre13("EMC", n);
  for (let n = 1; n <= 25; n++) out.push(`AP${n}`);

  return out;
}

const CONTENUS_CATALOGUE = buildContenusCatalogue();

/* -------------------------------------------------------
   BLOC 2 — PLAN SALLE (structure spatiale)
------------------------------------------------------- */

const PLAN_SALLE = {
  gauche: [1,2,3,4,5,6,7,8,9,10],
  centre: [11,12,13,14,15,16,17,18,19,20],
  droite: [21,22,23,24,25,26,27,28,29,30],
};

function couleurTable(place) {
  if (place >= 1 && place <= 10) return (place <= 5) ? "vert" : "violet";
  if (place >= 11 && place <= 20) return (place <= 15) ? "jaune" : "bleu";
  if (place >= 21 && place <= 30) return (place <= 25) ? "rouge" : "noir";
  return "";
}

function classeAdaptation(adapt) {
  switch (adapt) {
    case "PPS": return "adapt-pps";
    case "PAP": return "adapt-pap";
    case "PPRE": return "adapt-ppre";
    case "Adaptations": return "adapt-vert-fonce";
    case "Adaptations partielles": return "adapt-vert-clair";
    default: return "";
  }
}

/* -------------------------------------------------------
   BLOC 3 — STOCK LOCAL ÉVÉNÉMENTS (anti-perte)
------------------------------------------------------- */

const LS_EVENTS_KEY = "AG_EVENTS_V1";

function loadEvents() {
  try {
    const raw = localStorage.getItem(LS_EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return { assiduite: [], comportement: [], participation: [], contenu: [] };
}

function saveEvents(store) {
  try { localStorage.setItem(LS_EVENTS_KEY, JSON.stringify(store)); } catch {}
}

function getEventsStore() {
  if (!window.AG_EVENTS) window.AG_EVENTS = loadEvents();
  return window.AG_EVENTS;
}

/* -------------------------------------------------------
   BLOC 4 — CONTEXTE SÉANCE (depuis EDT)
------------------------------------------------------- */

function todayKeyISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function mondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - day + 1);
  d.setHours(0,0,0,0);
  return d;
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getJourFR(date) {
  const js = date.getDay();
  return ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"][js];
}

function getCreneauCourant() {
  const now = new Date();
  const hhmm = (d) => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  const t = hhmm(now);

  for (const cr of CRENEAUX) {
    if (cr.code === "PM") continue;
    if (t >= cr.debut && t < cr.fin) return cr.code;
  }
  return null;
}

/* === AG_SALLE_CONTEXTE_SUPABASE_V1_BEGIN ===================== */

async function getContexteSeanceCourante() {

  // ✅ FORÇAGE POUR TEST (à enlever après)
const isoLundi = "2026-05-18";
const dateISO = "2026-05-21";
const jour = "jeudi";
const creneau = "S4";

  if (!window.sb) {
    return {
      dateISO,
      isoLundi,
      jour,
      creneau,
      classe: null,
      groupe: null
    };
  }

 const sb = window.sb.schema("agoram");

  try {
    // ✅ année active
    const anneeId = await getActiveAnneeId();
    if (!anneeId) {
      return {
        dateISO,
        isoLundi,
        jour,
        creneau,
        classe: null,
        groupe: null
      };
    }

    // ✅ si hors créneau, inutile de requêter (évite eq("creneau", null))
    if (!creneau) {
      return {
        dateISO,
        isoLundi,
        jour,
        creneau,
        classe: null,
        groupe: null
      };
    }

    const { data: cell, error: errCell } = await sb
      .from("edt_cells")
      .select("classe_id, groupe")
      .eq("annee_id", anneeId)         // ✅ AJOUT
      .eq("iso_lundi", isoLundi)
      .eq("jour", jour)
      .eq("creneau", creneau)
      .maybeSingle();

    if (errCell) throw errCell;

    if (!cell || !cell.classe_id) {
      return {
        dateISO,
        isoLundi,
        jour,
        creneau,
        classe: null,
        groupe: null
      };
    }

    const { data: classeRow, error: errClasse } = await sb
      .from("classes")
      .select("nom")
      .eq("annee_id", anneeId)         // ✅ AJOUT (sécurité si classes multi-années)
      .eq("id", cell.classe_id)
      .maybeSingle();

    if (errClasse) throw errClasse;

    return {
      dateISO,
      isoLundi,
      jour,
      creneau,
      classe: classeRow ? classeRow.nom : null,
      groupe: cell.groupe || null
    };

  } catch (e) {
    console.error("Contexte salle (Supabase):", e.message || e);
    return {
      dateISO,
      isoLundi,
      jour,
      creneau,
      classe: null,
      groupe: null
    };
  }

}
/* === AG_SALLE_CONTEXTE_SUPABASE_V1_END ======================= */

/* =======================================================
   AG_SALLE_SEANCE_ID_V1
   But : fabriquer un seance_id UUID stable par créneau (EDT)
   Clé : isoLundi|jour|creneau|classe|groupe
   Stockage : localStorage (clé -> uuid)
   ======================================================= */

function getSeanceKey(ctx) {
  const c = ctx?.classe || "";
  const g = ctx?.groupe || "";
  const j = ctx?.jour || "";
  const cr = ctx?.creneau || "";
  const iso = ctx?.isoLundi || "";
  return `${iso}|${j}|${cr}|${c}|${g}`;
}

function getOrCreateSeanceId(ctx) {
  const key = getSeanceKey(ctx);
  const lsKey = `AG_SEANCE_ID::${key}`;

  try {
    const existing = localStorage.getItem(lsKey);
    if (existing) return existing;

    const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(lsKey, id);
    return id;
  } catch {
    return (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  }
}

/* === AG_SALLE_SEANCE_SUPABASE_BEGIN === */

async function ensureSeanceSupabase(ctx, seanceId) {
  if (!window.sb) return;

  const sb = window.sb.schema("agoram");

  if (!ctx?.classe || !ctx?.creneau || !ctx?.dateISO) return;

const anneeId = await getActiveAnneeId();

  const { data: classeRow } = await sb
    .from("classes")
    .select("id")
    .eq("annee_id", anneeId)
    .eq("nom", ctx.classe)
    .maybeSingle();

  if (!classeRow) {
    console.error("Classe introuvable:", ctx.classe);
    return;
  }

  const cr = CRENEAUX.find(c => c.code === ctx.creneau);

  const { error } = await sb
    .from("seances")
    .upsert([{
      id: seanceId,
      classe_id: classeRow.id,
      date_seance: ctx.dateISO,
      heure_debut: cr?.debut || null,
      heure_fin: cr?.fin || null
    }], { onConflict: "id" });

  if (error) console.error("Erreur seance supabase:", error.message);
}

/* === AG_SALLE_SEANCE_SUPABASE_END === */

/* -------------------------------------------------------
   BLOC 5 — ÉTAT SALLE
------------------------------------------------------- */

let contexte = null;
let elevesSalle = [];
let contenuCode = "";
let contenuLibre = "";
let lastContentKey = "";

/* -------------------------------------------------------
   BLOC 6 — DERNIER CONTENU
------------------------------------------------------- */

function getLastContentStorageKey(classe, groupe) {
  const g = groupe || "classe entière";
  return `AG_LAST_CONTENU::${classe}::${g}`;
}

function loadLastContent(classe, groupe) {
  try {
    const k = getLastContentStorageKey(classe, groupe);
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
}

function saveLastContent(classe, groupe, code) {
  try {
    const k = getLastContentStorageKey(classe, groupe);
    localStorage.setItem(k, code || "");
  } catch {}
}

/* -------------------------------------------------------
   BLOC 7 — INITIALISATION SALLE
------------------------------------------------------- */

export async function initSalle() {
  contexte = await getContexteSeanceCourante();

  const all = getEleves();

  if (contexte.classe) {
    const filtered = all.filter(e => e.classe === contexte.classe);

    if (contexte.groupe) {
      elevesSalle = filtered.filter(e => (e.groupe || null) === contexte.groupe);
    } else {
      elevesSalle = filtered;
    }
  } else {
    elevesSalle = [];
  }

  elevesSalle = elevesSalle.map((e, idx) => ({
    ...e,
    id: e.id ?? String(e._fallbackIndex ?? idx), // on force une clé stable
    place: (Number.isInteger(e.place) ? e.place : null),
    suivi: e.suivi ?? {
      absence: false,
      retard: false,
      devoir: false,
      absentControle: false,
      observation: ""
    },
    adaptations: Array.isArray(e.adaptations) ? e.adaptations : [],
    _fallbackIndex: idx
  }));

  // fallback places séquentielles si rien n'est placé
  const anyPlaced = elevesSalle.some(e => Number.isInteger(e.place));
  if (!anyPlaced) {
    elevesSalle.forEach((e, i) => { e.place = i + 1; });
  }

  // contenu_code : dernier utilisé
  if (contexte.classe) {
    const last = loadLastContent(contexte.classe, contexte.groupe);
    contenuCode = last || "";
    contenuLibre = "";
    lastContentKey = getLastContentStorageKey(contexte.classe, contexte.groupe);
  } else {
    contenuCode = "";
    contenuLibre = "";
    lastContentKey = "";
  }
}

/* -------------------------------------------------------
   BLOC 8 — RENDU (HTML)
------------------------------------------------------- */

export function renderSalle() {
  
if (!contexte) {
  return `<div class="page">Chargement...</div>`;
}


  const titreClasse = contexte.classe
    ? `${contexte.classe}${contexte.groupe ? " " + contexte.groupe : ""}`
    : "Aucune classe (EDT non renseigné pour ce créneau)";

  const titreSeance = (contexte.jour && contexte.creneau)
    ? `${capitalize(contexte.jour)} — ${contexte.creneau} — ${contexte.dateISO}`
    : `${capitalize(contexte.jour || "—")} — (hors créneau) — ${contexte.dateISO}`;

  return `
    <div class="page page-salle">

      <div class="salle-topbar">

        <div class="salle-contexte">
          <div class="salle-classe"><strong>${escapeHtml(titreClasse)}</strong></div>
          <div class="salle-seance">${escapeHtml(titreSeance)}</div>
        </div>

        <div class="salle-contenu">
          <label>Contenu</label>
          <select id="contenuSelect">
            <option value="">—</option>
            ${CONTENUS_CATALOGUE.map(c => `
              <option value="${escapeAttr(c)}" ${c === contenuCode ? "selected" : ""}>${escapeHtml(c)}</option>
            `).join("")}
          </select>

          <input id="contenuLibre" type="text" placeholder="Saisie libre (optionnel)" value="${escapeAttr(contenuLibre)}">
          <button id="contenuSave">OK</button>
        </div>

        <div class="salle-actions">
          <button id="openParticipation" title="Participation fin de séance">Participation</button>
        </div>

      </div>

      <div class="salle-plein-ecran">
        ${renderColonne("gauche")}
        <div class="allee"></div>
        ${renderColonne("centre")}
        <div class="allee"></div>
        ${renderColonne("droite")}
      </div>

      <div id="modal"></div>
    </div>
  `;
}

function renderColonne(nom) {
  const places = PLAN_SALLE[nom];
  const rangees = [];
  for (let i = 0; i < places.length; i += 2) rangees.push([places[i], places[i+1]]);

  return `
    <div class="colonne ${nom}">
      ${rangees.map(([p1,p2]) => `
        <div class="rangee">
          ${renderTable(p1)}
          ${renderTable(p2)}
        </div>
      `).join("")}
    </div>
  `;
}

function renderTable(place) {
  const eleve = elevesSalle.find(e => e.place === place);
  const couleur = couleurTable(place);

  const adapt = eleve && eleve.adaptations && eleve.adaptations.length ? eleve.adaptations[0] : "";
  const adaptClass = classeAdaptation(adapt);

  return `
    <div class="table ${couleur}" data-place="${place}">
      <span class="numero">${place}</span>

      ${eleve ? `
        <div class="nom">${escapeHtml(eleve.prenom)} ${escapeHtml(eleve.nom || "")}</div>
        ${adaptClass ? `<span class="adaptation-dot ${adaptClass}" title="${escapeAttr(adapt)}"></span>` : ""}
      ` : `<div class="nom vide">—</div>`}
    </div>
  `;
}

/* -------------------------------------------------------
   BLOC 9 — EVENTS UI
------------------------------------------------------- */

export function bindSalleEvents() {
  const sel = document.getElementById("contenuSelect");
  const libre = document.getElementById("contenuLibre");
  const btnOK = document.getElementById("contenuSave");

  if (sel) sel.onchange = () => {
    contenuCode = sel.value || "";
  };

  if (libre) libre.oninput = () => {
    contenuLibre = libre.value;
  };

  if (btnOK) btnOK.onclick = () => {
    const codeFinal = (contenuLibre && contenuLibre.trim()) ? contenuLibre.trim() : contenuCode;

    if (contexte && contexte.classe) {
      saveLastContent(contexte.classe, contexte.groupe, codeFinal);
    }

    recordEvent("contenu", { contenu_code: codeFinal });
  };

  document.querySelectorAll(".table").forEach(el => {
    el.addEventListener("click", () => {
      const place = Number(el.dataset.place);
      const eleve = elevesSalle.find(e => e.place === place);
      if (eleve) ouvrirFicheEleve(eleve);
    });
  });

  const btnPart = document.getElementById("openParticipation");
  if (btnPart) btnPart.onclick = () => ouvrirParticipation();
}

/* -------------------------------------------------------
   BLOC 10 — MODALE FICHE ÉLÈVE
------------------------------------------------------- */

function ouvrirFicheEleve(eleve) {
  document.getElementById("modal").innerHTML = `
    <div class="fiche-eleve">
      <div class="fiche-head">
        <h2>${escapeHtml(eleve.prenom)} ${escapeHtml(eleve.nom || "")}</h2>
        <button id="closeFiche">✕</button>
      </div>

      <div class="fiche-bloc">
        <label><input id="chkAbs" type="checkbox" ${eleve.suivi.absence ? "checked" : ""}> Absence</label>
        <label><input id="chkRet" type="checkbox" ${eleve.suivi.retard ? "checked" : ""}> Retard</label>
        <label><input id="chkDev" type="checkbox" ${eleve.suivi.devoir ? "checked" : ""}> Devoir non fait</label>
        <label><input id="chkCtrl" type="checkbox" ${eleve.suivi.absentControle ? "checked" : ""}> Absent au contrôle</label>
      </div>

      <div class="fiche-bloc">
        <label>Observation (comportement)</label>
        <textarea id="obs" rows="3">${escapeHtml(eleve.suivi.observation || "")}</textarea>
      </div>

      <div class="fiche-actions">
        <button id="saveFiche">Enregistrer</button>
      </div>
    </div>
  `;

  document.getElementById("closeFiche").onclick = () => {
    document.getElementById("modal").innerHTML = "";
  };

  document.getElementById("saveFiche").onclick = () => {
    eleve.suivi.absence = document.getElementById("chkAbs").checked;
    eleve.suivi.retard = document.getElementById("chkRet").checked;
    eleve.suivi.devoir = document.getElementById("chkDev").checked;
    eleve.suivi.absentControle = document.getElementById("chkCtrl").checked;
    eleve.suivi.observation = document.getElementById("obs").value || "";

    recordEvent("assiduite", { eleveId: String(eleve.id), type: "absence", state: eleve.suivi.absence });
    recordEvent("assiduite", { eleveId: String(eleve.id), type: "retard", state: eleve.suivi.retard });
    recordEvent("assiduite", { eleveId: String(eleve.id), type: "devoir", state: eleve.suivi.devoir });
    recordEvent("assiduite", { eleveId: String(eleve.id), type: "absentControle", state: eleve.suivi.absentControle });

    if (eleve.suivi.observation && eleve.suivi.observation.trim()) {
      recordEvent("comportement", { eleveId: String(eleve.id), texte: eleve.suivi.observation.trim() });
    }

    document.getElementById("modal").innerHTML = "";
  };
}

/* -------------------------------------------------------
   BLOC 11 — MODALE PARTICIPATION (fin de séance) — SUPABASE
   Valeurs : Perturbateur / Passif / Impliqué / Moteur
   Défaut : Passif
   Stockage : agoram.participations_hg (upsert eleve_id + seance_id)
------------------------------------------------------- */

const PART_VALUES = ["Perturbateur", "Passif", "Impliqué", "Moteur"];

function ouvrirParticipation() {
  const list = elevesSalle
    .slice()
    .filter(e => Number.isInteger(e.place))
    .sort((a, b) => a.place - b.place);

  const seanceId = getOrCreateSeanceId(contexte);

  // état local : Passif par défaut
  const currentByEleve = new Map();
  list.forEach(e => currentByEleve.set(String(e.id), "Passif"));

  // précharge depuis Supabase si disponible, puis rend
  (async () => {
    if (window.sb && contexte?.classe && contexte?.creneau) {
      await ensureSeanceSupabase(contexte, seanceId);
      const sb = window.sb.schema("agoram");
      const ids = list.map(e => String(e.id));

      const { data, error } = await sb
        .from("participations_hg")
        .select("eleve_id, valeur")
        .eq("seance_id", seanceId)
        .in("eleve_id", ids);

      if (!error && Array.isArray(data)) {
        data.forEach(r => {
          const k = String(r.eleve_id);
          if (PART_VALUES.includes(r.valeur)) currentByEleve.set(k, r.valeur);
        });
      }
    }

    renderParticipationModal(list, seanceId, currentByEleve);
  })().catch(e => {
    console.error(e);
    renderParticipationModal(list, seanceId, currentByEleve);
  });
}

function renderParticipationModal(list, seanceId, currentByEleve) {
  document.getElementById("modal").innerHTML = `
    <div class="participation">
      <div class="fiche-head">
        <h2>Participation — ${escapeHtml(contexte?.classe || "—")}</h2>
        <button id="closePart">✕</button>
      </div>

      <div class="hint">
        Ordre par place · défaut = Passif
      </div>

      <div class="part-list">
        ${list.map(e => {
          const val = currentByEleve.get(String(e.id)) || "Passif";
          return `
            <div class="part-row" data-eleve="${escapeAttr(String(e.id))}">
              <span class="part-place">#${e.place}</span>
              <span class="part-nom">${escapeHtml(e.prenom)} ${escapeHtml(e.nom || "")}</span>

              <div class="part-btns">
                ${renderPartBtn(e.id, "Perturbateur", val)}
                ${renderPartBtn(e.id, "Passif", val)}
                ${renderPartBtn(e.id, "Impliqué", val)}
                ${renderPartBtn(e.id, "Moteur", val)}
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <div class="fiche-actions">
        <button id="savePart">Valider la séance</button>
      </div>
    </div>
  `;

  document.getElementById("closePart").onclick = () => {
    document.getElementById("modal").innerHTML = "";
  };

  // clic : change l'état local + active visuel
  document.querySelectorAll(".btn-part").forEach(btn => {
    btn.addEventListener("click", () => {
      const eleveId = String(btn.dataset.id);
      const val = btn.dataset.val;

      currentByEleve.set(eleveId, val);

      const row = btn.closest(".part-row");
      if (row) {
        row.querySelectorAll(".btn-part").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      }
    });
  });

  // valider : backup local + upsert supabase
document.getElementById("savePart").onclick = async () => {
    // backup local
    list.forEach(e => {
      const v = currentByEleve.get(String(e.id)) || "Passif";
      recordEvent("participation", {
        eleveId: String(e.id),
        seance_id: seanceId,
        valeur: v
      });
    });

    // Supabase
    try {
      if (window.sb) {
        const sb = window.sb.schema("agoram");

        // ✅ 1) Garantit que seanceId existe bien dans agoram.seances (FK)
        await ensureSeanceSupabase(contexte, seanceId);

        // ✅ 2) Filtre : on n’envoie à Supabase que des UUID valides
        const rows = list
          .filter(e => typeof e.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(e.id))
          .map(e => ({
            eleve_id: e.id,
            seance_id: seanceId,
            valeur: currentByEleve.get(String(e.id)) || "Passif"
          }));

        const { error } = await sb
          .from("participations_hg")
          .upsert(rows, { onConflict: "eleve_id,seance_id" });

        if (error) console.error("Supabase upsert participations_hg:", error.message);
      }
    } catch (e) {
      console.error("Supabase upsert exception:", e?.message || e);
    }

    document.getElementById("modal").innerHTML = "";
  };
}

   function renderPartBtn(id, val, currentVal) {
  const active = (val === currentVal) ? "active" : "";

  // classes CSS (tu gères les couleurs dans ton style Art déco)
  const cls =
    (val === "Perturbateur") ? "part-perturbateur" :
    (val === "Passif") ? "part-passif" :
    (val === "Impliqué") ? "part-implique" :
    "part-moteur";

  // labels courts mais compréhensibles
  const label =
    (val === "Perturbateur") ? "P" :
    (val === "Passif") ? "Pa" :
    (val === "Impliqué") ? "I" :
    "M";

  return `<button class="btn-part ${cls} ${active}" data-id="${escapeAttr(String(id))}" data-val="${escapeAttr(val)}" title="${escapeAttr(val)}">${label}</button>`;
}

/* -------------------------------------------------------
   BLOC 12 — ENREGISTREMENT ÉVÉNÉMENTS (local)
   But : toujours écrire local (AG_EVENTS + localStorage)
   NOTE : la participation est aussi persistée en Supabase
------------------------------------------------------- */

function recordEvent(kind, payload) {
  const store = getEventsStore();

  const codeFinal = (contenuLibre && contenuLibre.trim()) ? contenuLibre.trim() : contenuCode;

  const meta = {
    kind,
    date: contexte?.dateISO || todayKeyISO(),
    isoLundi: contexte?.isoLundi || toISODate(mondayOfWeek(new Date())),
    jour: contexte?.jour || getJourFR(new Date()),
    creneau: contexte?.creneau || getCreneauCourant(),
    classe: contexte?.classe || null,
    groupe: contexte?.groupe || null,
    type: contexte?.type || null,
    trimestre: contexte?.trimestre || null,
    semestre: contexte?.semestre || null,
    contenu_code: codeFinal || null,
    ...payload
  };

  if (kind === "assiduite") store.assiduite.push(meta);
  else if (kind === "comportement") store.comportement.push(meta);
  else if (kind === "participation") store.participation.push(meta);
  else if (kind === "contenu") store.contenu.push(meta);

  saveEvents(store);
}

/* -------------------------------------------------------
   BLOC 13 — UTILITAIRES
------------------------------------------------------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[m]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
