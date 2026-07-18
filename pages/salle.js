/* === AG_SALLE_IMPORTS_V2_BEGIN ================================= */
import { getEleves } from "./importExport.js";
import * as EDT from "./emploiDuTemps.js";

// --- année active (pour filtrer edt_cells comme dans EDT)
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
     - LocalStorage : dernier contenu par classe/groupe (backup), événements locaux (backup)
     - Supabase : window.sb — toutes les données sont persistées en priorité dans Supabase
   ÉCRIT :
     - Supabase (priorité) :
         agoram.seances          → contenu de séance (code_cours)
         agoram.eleves_events    → assiduité + comportement (delete+insert par élève+séance)
         agoram.participations_hg → participation (cumulatif, upsert eleve_id+seance_id)
     - Local (backup / anti-perte) :
         window.AG_EVENTS + localStorage("AG_EVENTS_V1")
         localStorage("AG_LAST_CONTENU::...")
         localStorage("AG_SEANCE_ID::...")
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
  for (let n = 0; n <= 25; n++) out.push(`AP${n}`);

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
   BLOC 3 — STOCK LOCAL ÉVÉNEMENTS (backup anti-perte)
   NOTE : le local est un filet de sécurité.
          La source de vérité est Supabase.
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

/* === AG_SALLE_CONTEXTE_SUPABASE_V2_BEGIN ===================== */

async function getContexteSeanceCourante() {
  const now     = new Date();
  const dateISO = toISODate(now);
  const isoLundi = toISODate(mondayOfWeek(now));
  const jour    = getJourFR(now);
  const creneau = getCreneauCourant();

  const vide = { dateISO, isoLundi, jour, creneau, classe: null, classe_id: null, groupe: null };

  if (!window.sb) return vide;

  const sb = window.sb.schema("agoram");

  try {
    const anneeId = await getActiveAnneeId();
    if (!anneeId || !creneau) return vide;

    const { data: cell, error: errCell } = await sb
      .from("edt_cells")
      .select("classe_id, groupe")
      .eq("annee_id", anneeId)
      .eq("iso_lundi", isoLundi)
      .eq("jour", jour)
      .eq("creneau", creneau)
      .maybeSingle();

    if (errCell) throw errCell;
    if (!cell?.classe_id) return vide;

    const { data: classeRow, error: errClasse } = await sb
      .from("classes")
      .select("nom")
      .eq("annee_id", anneeId)
      .eq("id", cell.classe_id)
      .maybeSingle();

    if (errClasse) throw errClasse;

    return {
      dateISO, isoLundi, jour, creneau,
      classe:    classeRow?.nom || null,
      classe_id: cell.classe_id,
      groupe:    cell.groupe || null
    };

  } catch (e) {
    console.error("Contexte salle (Supabase):", e.message || e);
    return vide;
  }
}
/* === AG_SALLE_CONTEXTE_SUPABASE_V2_END ======================= */

/* =======================================================
   AG_SALLE_SEANCE_ID_V2
   Cherche d'abord en Supabase (évite les doublons),
   crée seulement si absente, cache en localStorage.
   ======================================================= */

function getSeanceKey(ctx) {
  return `${ctx?.isoLundi||""}|${ctx?.jour||""}|${ctx?.creneau||""}|${ctx?.classe||""}|${ctx?.groupe||""}`;
}

async function getOrEnsureSeanceId(ctx) {
  if (!ctx?.classe_id || !ctx?.dateISO) return null;

  // 1. Cache localStorage
  const lsKey = `AG_SEANCE_ID::${getSeanceKey(ctx)}`;
  try {
    const cached = localStorage.getItem(lsKey);
    if (cached) return cached;
  } catch {}

  const sb = window.sb?.schema("agoram");
  if (!sb) return crypto.randomUUID();

  const cr = CRENEAUX.find(c => c.code === ctx.creneau);

  // 2. Chercher une séance existante en Supabase
  try {
    const query = sb
      .from("seances")
      .select("id")
      .eq("classe_id", ctx.classe_id)
      .eq("date_seance", ctx.dateISO);

    if (cr?.debut) query.eq("heure_debut", cr.debut);

    const { data: existing } = await query.maybeSingle();

    if (existing?.id) {
      try { localStorage.setItem(lsKey, existing.id); } catch {}
      return existing.id;
    }
  } catch {}

  // 3. Créer la séance si absente
  const newId = crypto.randomUUID();
  const anneeId = await getActiveAnneeId();

  const { error } = await sb.from("seances").insert([{
    id:          newId,
    classe_id:   ctx.classe_id,
    date_seance: ctx.dateISO,
    annee_id:    anneeId,
    jour:        ctx.jour   || null,
    creneau:     ctx.creneau || null,
    heure_debut: cr?.debut  || null,
    heure_fin:   cr?.fin    || null,
  }]);

  if (error) console.error("Création séance impossible:", error.message);

  try { localStorage.setItem(lsKey, newId); } catch {}
  return newId;
}

/* -------------------------------------------------------
   BLOC 4b — CONTENU SÉANCE → Supabase (seances.code_cours)
   Appelé depuis btnOK onclick
   Stratégie : upsert sur id (la séance doit déjà exister)
------------------------------------------------------- */

async function saveContenuSupabase(seanceId, codeFinal) {
  if (!window.sb || !seanceId) return;

  const sb = window.sb.schema("agoram");

  const { error } = await sb
    .from("seances")
    .update({ code_cours: codeFinal || null })
    .eq("id", seanceId);

  if (error) console.error("Erreur update seances.code_cours:", error.message);
}

/* -------------------------------------------------------
   BLOC 4c — ASSIDUITÉ + COMPORTEMENT → Supabase (eleves_events)
   Stratégie DELETE + INSERT par (eleve_id, seance_id)
   Types gérés :
     "absence", "retard", "devoir", "oubli_materiel", "absent_controle"
     "comportement"
   Colonne "code" = contenu_code courant (optionnel)
------------------------------------------------------- */

const ASSIDUITE_TYPES = ["absence", "retard", "devoir", "oubli_materiel", "absent_controle", "comportement"];

async function saveEleveEventsSupabase(eleveId, seanceId, events) {
  /*
    events = tableau d'objets { type, valeur, code? }
    On supprime TOUS les events de cet élève sur cette séance,
    puis on ré-insère uniquement ceux qui sont "actifs" (valeur != "false" ou texte non vide).
  */
  if (!window.sb || !eleveId || !seanceId) return;

  // Vérifie que l'eleveId est un UUID valide (FK contrainte)
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eleveId);
  if (!isUUID) {
    console.warn("saveEleveEventsSupabase : eleveId non UUID, skip.", eleveId);
    return;
  }

  const sb = window.sb.schema("agoram");

  try {
    // 1) DELETE tous les events de cet élève sur cette séance
    const { error: errDel } = await sb
      .from("eleves_events")
      .delete()
      .eq("eleve_id", eleveId)
      .eq("seance_id", seanceId)
      .in("type", ASSIDUITE_TYPES);

    if (errDel) {
      console.error("Erreur delete eleves_events:", errDel.message);
      return;
    }

    // 2) INSERT uniquement les events actifs
    const rowsToInsert = events.filter(ev => {
      if (ev.type === "comportement") return ev.valeur && ev.valeur.trim().length > 0;
      return ev.valeur === "true" || ev.valeur === true;
    }).map(ev => ({
      eleve_id: eleveId,
      seance_id: seanceId,
      type: ev.type,
      valeur: String(ev.valeur),
      code: ev.code || null
    }));

    if (rowsToInsert.length === 0) return; // rien à insérer, c'est normal

    const { error: errIns } = await sb
      .from("eleves_events")
      .insert(rowsToInsert);

    if (errIns) console.error("Erreur insert eleves_events:", errIns.message);

  } catch (e) {
    console.error("saveEleveEventsSupabase exception:", e?.message || e);
  }
}

/* -------------------------------------------------------
   BLOC 4d — CHARGEMENT assiduité depuis Supabase au retour
   But : quand on rouvre la fiche élève, les checkboxes
         reflètent ce qui est déjà en base.
------------------------------------------------------- */

async function loadEleveEventsSupabase(eleveId, seanceId) {
  /*
    Retourne un objet { absence, retard, devoir, oubli_materiel, absent_controle, observation }
    avec les valeurs courantes en base.
  */
  const defaults = {
    absence: false,
    retard: false,
    devoir: false,
    oubli_materiel: false,
    absent_controle: false,
    observation: ""
  };

  if (!window.sb || !eleveId || !seanceId) return defaults;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eleveId);
  if (!isUUID) return defaults;

  try {
    const sb = window.sb.schema("agoram");

    const { data, error } = await sb
      .from("eleves_events")
      .select("type, valeur")
      .eq("eleve_id", eleveId)
      .eq("seance_id", seanceId)
      .in("type", ASSIDUITE_TYPES);

    if (error) {
      console.error("Erreur chargement eleves_events:", error.message);
      return defaults;
    }

    const result = { ...defaults };

    (data || []).forEach(row => {
      if (row.type === "comportement") {
        result.observation = row.valeur || "";
      } else if (row.type in result) {
        result[row.type] = row.valeur === "true";
      }
    });

    return result;

  } catch (e) {
    console.error("loadEleveEventsSupabase exception:", e?.message || e);
    return defaults;
  }
}

/* -------------------------------------------------------
   BLOC 5 — ÉTAT SALLE
------------------------------------------------------- */

let contexte = null;
let seanceId = null;      // calculé une seule fois dans initSalle
let elevesSalle = [];
let contenuCode = "";
let contenuLibre = "";
let lastContentKey = "";

/* -------------------------------------------------------
   BLOC 6 — DERNIER CONTENU (backup local)
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
   BLOC 7 — INIT
------------------------------------------------------- */

export async function initSalle() {
  contexte = await getContexteSeanceCourante();

  if (!window.sb) {
    elevesSalle = [];
    return;
  }

  const sb = window.sb.schema("agoram");

  const { data: all, error } = await sb
    .from("eleves")
    .select("*");

  if (error || !all) {
    console.error("Erreur chargement élèves:", error);
    elevesSalle = [];
    return;
  }

  // Filtrer par classe
  const filtered = all.filter(
    e => String(e.classe_id) === String(contexte.classe_id)
  );

  // Charger les élèves
  elevesSalle = filtered.map((e, idx) => ({
    ...e,
    id: e.id ?? String(idx),
    place: e.place != null ? Number(e.place) : null,
    suivi: {
      absence: false,
      retard: false,
      devoir: false,
      oubli_materiel: false,
      absentControle: false,
      observation: ""
    },
    adaptations: Array.isArray(e.adaptations) ? e.adaptations : []
  }));

  // Fallback placement
  const anyPlaced = elevesSalle.some(e => Number.isInteger(e.place));
  if (!anyPlaced) {
    elevesSalle.forEach((e, i) => { e.place = i + 1; });
  }

  // Contenu : priorité Supabase, fallback local
  seanceId = await getOrEnsureSeanceId(contexte);

  if (contexte.classe) {
    // Charger le dernier contenu utilisé pour cette classe (séance actuelle ou séance précédente)
    let codeFromSupabase = "";
    try {
      // D'abord la séance courante
      const { data: seanceRow } = await sb
        .from("seances")
        .select("code_cours")
        .eq("id", seanceId)
        .maybeSingle();
      codeFromSupabase = seanceRow?.code_cours || "";

      // Si vide, chercher la dernière séance avec un contenu pour cette classe
      if (!codeFromSupabase && contexte.classe_id) {
        const { data: lastSeance } = await sb
          .from("seances")
          .select("code_cours")
          .eq("classe_id", contexte.classe_id)
          .not("code_cours", "is", null)
          .order("date_seance", { ascending: false })
          .limit(1)
          .maybeSingle();
        codeFromSupabase = lastSeance?.code_cours || "";
      }
    } catch {}

    contenuCode = codeFromSupabase || loadLastContent(contexte.classe, contexte.groupe);
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

  if (btnOK) btnOK.onclick = async () => {
    const codeFinal = (contenuLibre && contenuLibre.trim()) ? contenuLibre.trim() : contenuCode;

    // Backup local
    if (contexte && contexte.classe) {
      saveLastContent(contexte.classe, contexte.groupe, codeFinal);
    }

    // Backup local événement
    recordEventLocal("contenu", { contenu_code: codeFinal });

    // ✅ Supabase : update seances.code_cours
    await saveContenuSupabase(seanceId, codeFinal);
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
   - Charge les données depuis Supabase à l'ouverture
   - Enregistre via DELETE + INSERT dans eleves_events
------------------------------------------------------- */

async function ouvrirFicheEleve(eleve) {
  // Charge l'état courant depuis Supabase (ou defaults)
  const etatActuel = await loadEleveEventsSupabase(String(eleve.id), seanceId);

  // Met à jour le suivi en mémoire avec ce qu'on a en base
  eleve.suivi.absence = etatActuel.absence;
  eleve.suivi.retard = etatActuel.retard;
  eleve.suivi.devoir = etatActuel.devoir;
  eleve.suivi.oubli_materiel = etatActuel.oubli_materiel;
  eleve.suivi.absentControle = etatActuel.absent_controle;
  eleve.suivi.observation = etatActuel.observation;

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
        <label><input id="chkMat" type="checkbox" ${eleve.suivi.oubli_materiel ? "checked" : ""}> Oubli de matériel</label>
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

  document.getElementById("saveFiche").onclick = async () => {
    // Lecture des valeurs depuis le DOM
    eleve.suivi.absence        = document.getElementById("chkAbs").checked;
    eleve.suivi.retard         = document.getElementById("chkRet").checked;
    eleve.suivi.devoir         = document.getElementById("chkDev").checked;
    eleve.suivi.oubli_materiel = document.getElementById("chkMat").checked;
    eleve.suivi.absentControle = document.getElementById("chkCtrl").checked;
    eleve.suivi.observation    = document.getElementById("obs").value || "";

    const codeFinal = (contenuLibre && contenuLibre.trim()) ? contenuLibre.trim() : contenuCode;

    // ─── Backup local ──────────────────────────────────────
    recordEventLocal("assiduite", { eleveId: String(eleve.id), type: "absence",        state: eleve.suivi.absence });
    recordEventLocal("assiduite", { eleveId: String(eleve.id), type: "retard",         state: eleve.suivi.retard });
    recordEventLocal("assiduite", { eleveId: String(eleve.id), type: "devoir",         state: eleve.suivi.devoir });
    recordEventLocal("assiduite", { eleveId: String(eleve.id), type: "oubli_materiel", state: eleve.suivi.oubli_materiel });
    recordEventLocal("assiduite", { eleveId: String(eleve.id), type: "absentControle", state: eleve.suivi.absentControle });

    if (eleve.suivi.observation && eleve.suivi.observation.trim()) {
      recordEventLocal("comportement", { eleveId: String(eleve.id), texte: eleve.suivi.observation.trim() });
    }

    // ─── Supabase : DELETE + INSERT (eleves_events) ────────
    const events = [
      { type: "absence",        valeur: String(eleve.suivi.absence),        code: codeFinal },
      { type: "retard",         valeur: String(eleve.suivi.retard),         code: codeFinal },
      { type: "devoir",         valeur: String(eleve.suivi.devoir),         code: codeFinal },
      { type: "oubli_materiel", valeur: String(eleve.suivi.oubli_materiel), code: codeFinal },
      { type: "absent_controle",valeur: String(eleve.suivi.absentControle), code: codeFinal },
      { type: "comportement",   valeur: eleve.suivi.observation.trim(),     code: codeFinal },
    ];

    await saveEleveEventsSupabase(String(eleve.id), seanceId, events);

    document.getElementById("modal").innerHTML = "";
  };
}

/* -------------------------------------------------------
   BLOC 11 — MODALE PARTICIPATION (fin de séance)
   Valeurs : Perturbateur / Passif / Impliqué / Moteur
   Défaut : Passif
   Stockage :
     - agoram.participations_hg (upsert eleve_id + seance_id)
     - CUMULATIF : chaque séance crée/met à jour une ligne
     - Une autre page peut calculer la "moyenne" (score numérique)
       en lisant toutes les lignes par eleve_id sur une période
   Score de référence pour la moyenne :
     Perturbateur = 0, Passif = 1, Impliqué = 2, Moteur = 3
------------------------------------------------------- */

const PART_VALUES = ["Perturbateur", "Passif", "Impliqué", "Moteur"];

// Score numérique associé à chaque valeur (utile pour la page moyenne)
export const PART_SCORES = {
  "Perturbateur": 0,
  "Passif": 1,
  "Impliqué": 2,
  "Moteur": 3
};

function ouvrirParticipation() {
  const list = elevesSalle
    .slice()
    .filter(e => Number.isInteger(e.place))
    .sort((a, b) => a.place - b.place);

  // état local : Passif par défaut
  const currentByEleve = new Map();
  list.forEach(e => currentByEleve.set(String(e.id), "Passif"));

  // Précharge depuis Supabase si disponible, puis rend
  (async () => {
    if (window.sb) {
      try {
        // seanceId déjà garanti par initSalle
        const sb = window.sb.schema("agoram");
        const ids = list
          .map(e => String(e.id))
          .filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));

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
      } catch (e) {
        console.error("Préchargement participations_hg:", e?.message || e);
      }
    }

    renderParticipationModal(list, seanceId, currentByEleve);
  })();
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

  // Clic : change l'état local + active visuel
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

  // Valider : backup local + upsert Supabase (cumulatif)
  document.getElementById("savePart").onclick = async () => {

    // ─── Backup local ──────────────────────────────────────
    list.forEach(e => {
      const v = currentByEleve.get(String(e.id)) || "Passif";
      recordEventLocal("participation", {
        eleveId: String(e.id),
        seance_id: seanceId,
        valeur: v
      });
    });

    // ─── Supabase : upsert cumulatif participations_hg ─────
    if (window.sb) {
      try {
        const sb = window.sb.schema("agoram");

        // Garantit que seanceId existe dans agoram.seances (FK)
        // seanceId déjà garanti par initSalle

        // Filtre : UUID valides uniquement (FK eleves)
        const rows = list
          .filter(e => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(e.id)))
          .map(e => ({
            eleve_id: e.id,
            seance_id: seanceId,
            valeur: currentByEleve.get(String(e.id)) || "Passif"
          }));

        if (rows.length > 0) {
          const { error } = await sb
            .from("participations_hg")
            .upsert(rows, { onConflict: "eleve_id,seance_id" });

          if (error) console.error("Supabase upsert participations_hg:", error.message);
        }

      } catch (e) {
        console.error("Supabase upsert participations_hg exception:", e?.message || e);
      }
    }

    document.getElementById("modal").innerHTML = "";
  };
}

function renderPartBtn(id, val, currentVal) {
  const active = (val === currentVal) ? "active" : "";

  const cls =
    (val === "Perturbateur") ? "part-perturbateur" :
    (val === "Passif") ? "part-passif" :
    (val === "Impliqué") ? "part-implique" :
    "part-moteur";

  const label =
    (val === "Perturbateur") ? "P" :
    (val === "Passif") ? "Pa" :
    (val === "Impliqué") ? "I" :
    "M";

  return `<button class="btn-part ${cls} ${active}" data-id="${escapeAttr(String(id))}" data-val="${escapeAttr(val)}" title="${escapeAttr(val)}">${label}</button>`;
}

/* -------------------------------------------------------
   BLOC 12 — ENREGISTREMENT LOCAL (backup)
   Préfixé "Local" pour bien distinguer du flux Supabase.
   Le local reste comme filet de sécurité uniquement.
------------------------------------------------------- */

function recordEventLocal(kind, payload) {
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
