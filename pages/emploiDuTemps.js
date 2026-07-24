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

let portee = "trimestre";   // "trimestre" ou "semestre"
let propagerActif = false;  // case à cocher

let classeActive = null;  // { classe_id, groupe, label } ou null

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

function formatFR(isoDate) {
  const [, m, d] = String(isoDate).split("-");
  return `${d}/${m}`;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function getNowDateISO() {
  if (window.APP_SERVER_DATE_ISO) return window.APP_SERVER_DATE_ISO;

  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ======================================================
   BLOC 5 — INIT PAGE (Chargement depuis agoram.semaines)
   ====================================================== */

/* === AG_EDT_CALENDAR_FROM_ACTIVE_ANNEE_BEGIN ===================== */

async function ensureCalendar() {
  if (_calendarEnsuredOnce) return;

  const sb = sbAgoram(); // ← était window.sb.schema(...) manquant ou mauvais schéma

  // Récupérer l'année active
  const { data: anneeRow, error: errAnnee } = await sb
    .from("annees")
    .select("libelle")
    .eq("active", true)
    .maybeSingle();

  if (errAnnee) throw new Error(`Lecture année active impossible: ${errAnnee.message}`);
  if (!anneeRow) throw new Error("Aucune année active trouvée.");

  const annee = anneeRow.libelle;

  // Charger les semaines depuis agoram.semaines
  const { data, error } = await sb
    .from("semaines")
    .select("id, libelle, date_lundi, annee_scolaire")
    .eq("annee_scolaire", annee)
    .order("date_lundi");

  if (error) throw new Error(`Chargement semaines impossible: ${error.message}`);

  if (!data || data.length === 0) {
    throw new Error(`Aucune semaine trouvée pour l'année '${annee}'. Vérifie la table agoram.semaines.`);
  }

  semaines = data.map(s => ({
    isoLundi: s.date_lundi,  // "2025-09-01" — chaîne ISO directe, pas de new Date()
    libelle: s.libelle       // "Semaine 36"
  }));

  semaineRefIndex = 0;
  _calendarEnsuredOnce = true;
}

/* ======================================================
   BLOC 5bis — CALCUL DES TYPES A/B/V ET DES PÉRIODES
   ====================================================== */

let reperesAnnee = null;      // { premiere_semaine_a, debut_t2, debut_t3, debut_s2 }
let joursVacances = new Set(); // dates ISO "2025-10-20"

async function loadReperesAnnee() {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return;

  const sb = sbAgoram();
  const { data, error } = await sb
    .from("annees")
    .select("premiere_semaine_a, debut_t2, debut_t3, debut_s2")
    .eq("id", anneeId)
    .maybeSingle();

  if (error) throw new Error(`Lecture repères impossible. ${error.message}`);
  reperesAnnee = data || null;
}

async function loadJoursVacances() {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return;

  const sb = sbAgoram();
  const { data, error } = await sb
    .from("jours_speciaux")
    .select("date, type")
    .eq("annee_id", anneeId)
    .eq("type", "vacances");

  if (error) throw new Error(`Lecture jours spéciaux impossible. ${error.message}`);

  joursVacances = new Set((data || []).map(r => String(r.date)));
}

// Ajoute n jours à une date ISO, renvoie une date ISO
function addDaysISO(isoDate, n) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// Une semaine est "vacances" si ses 5 jours ouvrés sont dans joursVacances
function semaineEstVacances(isoLundi) {
  for (let i = 0; i < 5; i++) {
    if (!joursVacances.has(addDaysISO(isoLundi, i))) return false;
  }
  return true;
}

// Calcule type / trimestre / semestre pour toutes les semaines
function calculerPeriodes() {
  const out = new Map();
  if (!semaines.length) return out;

  const r = reperesAnnee || {};
  const debutA = r.premiere_semaine_a ? String(r.premiere_semaine_a) : null;
  const debutT2 = r.debut_t2 ? String(r.debut_t2) : null;
  const debutT3 = r.debut_t3 ? String(r.debut_t3) : null;
  const debutS2 = r.debut_s2 ? String(r.debut_s2) : null;

  let compteur = 0;      // 0 = A, 1 = B
  let alternanceDemarree = false;

  semaines.forEach(s => {
    const iso = s.isoLundi;

    const trimestre =
      debutT3 && iso >= debutT3 ? "T3" :
      debutT2 && iso >= debutT2 ? "T2" : "T1";

    const semestre = debutS2 && iso >= debutS2 ? "S2" : "S1";

    let type;
    if (semaineEstVacances(iso)) {
      type = "V";                       // ne consomme pas de tour
    } else if (!debutA || iso < debutA) {
      type = "A";                       // avant le repère : par défaut
    } else {
      if (!alternanceDemarree) {
        alternanceDemarree = true;
        compteur = 0;
      }
      type = compteur % 2 === 0 ? "A" : "B";
      compteur++;
    }

    out.set(iso, { type, trimestre, semestre, vacances: type === "V" });
  });

  return out;
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
// Marqueur hors_serie, lu directement dans edt_weeks
  const { data: weeks } = await sb
    .from("edt_weeks")
    .select("iso_lundi, hors_serie")
    .eq("annee_id", anneeId);

  (weeks || []).forEach(w => {
    const key = String(w.iso_lundi);
    const prev = weekStatusIndex.get(key) || { has_data: false };
    prev.hors_serie = !!w.hors_serie;
    weekStatusIndex.set(key, prev);
  });
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



async function saveWeek(isoLundi, horsSerie = false) {

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
      semestre: meta.semestre,
      hors_serie: horsSerie
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
   BLOC 7a — CALCUL DES SEMAINES CIBLES
   ====================================================== */

// Semaines jumelles à partir de la semaine courante (vers l'avant)
function calculerCibles(isoSource) {
  const periodes = calculerPeriodes();
  const src = periodes.get(isoSource);
  if (!src || src.type === "V") return [];

  const clePeriode = portee === "semestre" ? "semestre" : "trimestre";
  const valPeriode = src[clePeriode];

  const cibles = [];
  semaines.forEach(s => {
    const iso = s.isoLundi;
    if (iso <= isoSource) return;                   // uniquement vers l'avant
    const p = periodes.get(iso);
    if (!p) return;
    if (p.type !== src.type) return;                // même type A ou B
    if (p[clePeriode] !== valPeriode) return;       // même période
    cibles.push(iso);
  });

  return cibles;
}

// Libellé de la case à cocher
function libelleProfagation(isoSource) {
  const periodes = calculerPeriodes();
  const src = periodes.get(isoSource);
  if (!src || src.type === "V") return "Semaine de vacances";
  const p = portee === "semestre" ? src.semestre : src.trimestre;
  return `Appliquer aux semaines ${src.type} du ${p} (à partir de celle-ci)`;
}

/* ======================================================

   BLOC 11 — RENDU (UI)

   ====================================================== */



function escapeHtml(s) {

  return String(s ?? "").replace(/[&<>"']/g, m => ({

    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"

  }[m]));

}

/* ======================================================
   BLOC 4a — COULEURS PAR NIVEAU
   ====================================================== */

// Teintes de base par niveau (HSL)
const TEINTES_NIVEAU = {
  "6": 0,    // rouge
  "5": 45,   // jaune
  "4": 120,  // vert
  "3": 210   // bleu
};

// Extrait le niveau du nom de classe : "6A" -> "6", "3e2" -> "3"
function niveauDeClasse(nom) {
  const m = String(nom || "").match(/[3-6]/);
  return m ? m[0] : null;
}

// Couleur de fond stable pour un nom de classe
function couleurClasse(nom) {
  const niveau = niveauDeClasse(nom);
  if (niveau === null) return "#eeeeee";

  const teinte = TEINTES_NIVEAU[niveau];

  // Variation de clarté selon la lettre/chiffre qui suit le niveau
  const suite = String(nom).replace(/[^A-Za-z0-9]/g, "").slice(1);
  let somme = 0;
  for (const c of suite) somme += c.charCodeAt(0);

  const clarte = 80 + (somme % 4) * 4;  // entre 80% et 92%
  return `hsl(${teinte}, 70%, ${clarte}%)`;
}

/* === AG_EDT_WEEK_LABEL_FINAL_V3_BEGIN ===================== */


function weekLabel(s) {
  return `${s.libelle} (${formatFR(s.isoLundi)})`;
}

/* === AG_EDT_WEEK_LABEL_FINAL_V3_END ======================= */



function cellText(jour, creneau) {
  const key = `${jour}|${creneau}`;
  const v = bufferEdition.grid.get(key);
  if (!v || !v.classe_id) return "&nbsp;";
  const nom = escapeHtml(v.classe_nom || "—");
  return v.groupe ? `${nom} ${escapeHtml(v.groupe)}` : nom;
}

// Style de fond d'une cellule
// Une cellule diffère-t-elle de ce qui est enregistré ?
function cellModifiee(jour, creneau) {
  const key = `${jour}|${creneau}`;
  const buf = bufferEdition.grid.get(key);
  const sav = semaineActive.grid.get(key);

  const bufId = buf && buf.classe_id ? String(buf.classe_id) : "";
  const savId = sav && sav.classe_id ? String(sav.classe_id) : "";
  const bufGr = buf && buf.groupe ? String(buf.groupe) : "";
  const savGr = sav && sav.groupe ? String(sav.groupe) : "";

  return bufId !== savId || bufGr !== savGr;
}

// Nombre total de cellules modifiées
function compterModifications() {
  let n = 0;
  JOURS.forEach(j => {
    CRENEAUX.forEach(cr => {
      if (cr.code !== "PM" && cellModifiee(j, cr.code)) n++;
    });
  });
  return n;
}

// Style de fond d'une cellule, plus liseré si modifiée
function cellStyle(jour, creneau) {
  const v = bufferEdition.grid.get(`${jour}|${creneau}`);
  const fond = (v && v.classe_nom) ? `background:${couleurClasse(v.classe_nom)};` : "";
  const liseré = cellModifiee(jour, creneau) ? "box-shadow:inset 4px 0 0 #e8880c;" : "";
  if (!fond && !liseré) return "";
  return ` style="${fond}${liseré}"`;
}

// Compte les créneaux par classe dans le buffer
function compterCreneauxParClasse() {
  const compte = new Map(); // nom -> nombre
  bufferEdition.grid.forEach(v => {
    if (!v || !v.classe_id) return;
    const label = v.groupe ? `${v.classe_nom} ${v.groupe}` : v.classe_nom;
    compte.set(label, (compte.get(label) || 0) + 1);
  });
  return Array.from(compte.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

// HTML du bandeau de totaux
function bandeauTotaux() {
  const lignes = compterCreneauxParClasse();
  if (!lignes.length) return `<div class="edt-totaux"><em>Semaine vide</em></div>`;

  const total = lignes.reduce((s, x) => s + x[1], 0);

  const pastilles = lignes.map(([label, n]) => {
    const nom = label.replace(" gr 1", "").replace(" gr 2", "");
    return `<span class="edt-total-item" style="background:${couleurClasse(nom)}">
              ${escapeHtml(label)} : ${n}
            </span>`;
  }).join("");

  return `<div class="edt-totaux">${pastilles}
            <span class="edt-total-general">Total : ${total} créneaux</span>
          </div>`;
}

function metaButton(k, v, active) {

  return `<button class="edt-meta" data-k="${k}" data-v="${v}" ${active ? 'data-active="1"' : ""}>${v}</button>`;

}



export async function renderEmploiDuTemps() {
  await ensureCalendar();

  const currentYear = new Date().getFullYear();
  const startYear = new Date().getMonth() < 8 ? currentYear - 1 : currentYear;
  const annee = window.appAnneeCourante || `${startYear}-${startYear + 1}`;

if (!reperesAnnee) {
    try { await loadReperesAnnee(); await loadJoursVacances(); } catch (e) { console.error(e); }
  }
   
  if (weekStatusIndex.size === 0) {
    try { await loadWeekStatusIndex(); } catch (e) { console.error(e); }
  }

  if (!semaines || semaines.length === 0) {
  return `<div style="padding:20px">Aucune semaine disponible</div>`;
}

semaineRefIndex = Math.min(semaineRefIndex, semaines.length - 1);

const sem = semaines[semaineRefIndex];


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

  const periodes = calculerPeriodes();
  const pSem = periodes.get(sem.isoLundi) || { type: "?", trimestre: "?", semestre: "?" };

  return `
    <section class="page page-edt">
      <div class="topbar">
        <button id="semPrec" ${semaineRefIndex === 0 ? "disabled" : ""}>‹</button>
        <select id="semSelect">
          ${semaines.map((s, i) => {
            const p = periodes.get(s.isoLundi) || {};
            const st = weekStatusIndex.get(String(s.isoLundi));
            const dot = (st && st.has_data) ? "🟦" : "⬜";
            const suffixe = p.type === "V" ? "V" : (p.type || "?");
            const etoile = (st && st.hors_serie) ? " *" : "";
            return `<option value="${i}" ${i === semaineRefIndex ? "selected" : ""}>
                      ${dot} ${escapeHtml(weekLabel(s))} — ${suffixe}${etoile}
                    </option>`;
          }).join("")}
        </select>
        <button id="semSuiv" ${semaineRefIndex >= semaines.length - 1 ? "disabled" : ""}>›</button>
        <strong>${pSem.type} · ${pSem.trimestre} · ${pSem.semestre}</strong>
                <span>Année</span>
       <select id="anneeSelect">
          ${(() => {
            const currentYear = new Date().getFullYear();
            const startYear = new Date().getMonth() < 7 ? currentYear - 1 : currentYear;
            const options = [`${startYear}-${startYear+1}`, `${startYear+1}-${startYear+2}`, `${startYear+2}-${startYear+3}`];
            return options.map(a => `<option value="${a}" ${a === annee ? "selected" : ""}>${a}</option>`).join("");
          })()}
        </select>



       <label class="edt-propag">
          <input type="checkbox" id="propagCheck" ${propagerActif ? "checked" : ""}
                 ${pSem.type === "V" ? "disabled" : ""}>
          ${escapeHtml(libelleProfagation(sem.isoLundi))}
        </label>

        <select id="porteeSelect">
          <option value="trimestre" ${portee === "trimestre" ? "selected" : ""}>Trimestre</option>
          <option value="semestre" ${portee === "semestre" ? "selected" : ""}>Semestre</option>
        </select>


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

        <button id="preparerAnnee">Préparer une année</button>
        <button id="valider">Valider${(() => {
          const n = compterModifications();
          return n ? ` (${n})` : "";
        })()}</button>

      </div>

${(() => {
        const st = weekStatusIndex.get(String(sem.isoLundi));
        if (!st || !st.hors_serie) return "";
        return `<div class="edt-horsserie">
                  Cette semaine a été modifiée seule — elle diffère de ses semaines jumelles.
                  <button id="resyncBtn">Resynchroniser</button>
                </div>`;
      })()}

      <div class="edt-body">

<div class="edt-palette">
          ${(await getClassesOptions())
            .filter(o => o.classe_id)
            .map(o => {
              const actif = classeActive
                && String(classeActive.classe_id) === String(o.classe_id)
                && String(classeActive.groupe || "") === String(o.groupe || "");
              const nom = o.label.replace(" gr 1", "").replace(" gr 2", "");
              return `<button class="edt-pastille${actif ? " active" : ""}"
                        data-cid="${o.classe_id}"
                        data-grp="${o.groupe || ""}"
                        data-lab="${escapeHtml(o.label)}"
                        style="background:${couleurClasse(nom)}${actif ? ";outline:2px solid #333" : ""}">
                        ${escapeHtml(o.label)}
                      </button>`;
            }).join("")}
          <button class="edt-pastille" id="pinceauGomme"
                  style="background:#fff;border:1px dashed #999">Gomme</button>
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

                    return `<td class="edt-cell" data-j="${j}" data-c="${cr.code}"${cellStyle(j, cr.code)}>${cellText(j, cr.code)}</td>`;

                  }).join("")}

                </tr>

              `).join("")}

           </table>

            ${bandeauTotaux()}

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

const anneeSelect = document.getElementById("anneeSelect");

  const valider = document.getElementById("valider");
  const preparerAnnee = document.getElementById("preparerAnnee");



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

const propagCheck = document.getElementById("propagCheck");
  if (propagCheck) propagCheck.onchange = (e) => { propagerActif = e.target.checked; };

  const porteeSelect = document.getElementById("porteeSelect");
  if (porteeSelect) porteeSelect.onchange = async (e) => {
    portee = e.target.value;
    await refresh();
  };

const allerSemaine = async (i) => {
    if (i < 0 || i >= semaines.length) return;
    if (compterModifications() > 0) {
      if (!confirm("Des modifications ne sont pas enregistrées. Changer de semaine quand même ?")) return;
    }
    syncState = "unknown";
    semaineRefIndex = i;
    await refresh();
  };

  const semSelect = document.getElementById("semSelect");
  if (semSelect) semSelect.onchange = (e) => allerSemaine(Number(e.target.value));

  const semPrec = document.getElementById("semPrec");
  if (semPrec) semPrec.onclick = () => allerSemaine(semaineRefIndex - 1);

  const semSuiv = document.getElementById("semSuiv");
  if (semSuiv) semSuiv.onclick = () => allerSemaine(semaineRefIndex + 1);



  // Sélection d'une classe dans la palette
  document.querySelectorAll(".edt-pastille[data-cid]").forEach(btn => {
    btn.onclick = async () => {
      const cid = btn.dataset.cid;
      const grp = btn.dataset.grp || null;
      const deja = classeActive
        && String(classeActive.classe_id) === String(cid)
        && String(classeActive.groupe || "") === String(grp || "");

      classeActive = deja ? null : { classe_id: cid, groupe: grp, label: btn.dataset.lab };
      await refresh();
    };
  });

  // Gomme
  const gomme = document.getElementById("pinceauGomme");
  if (gomme) gomme.onclick = async () => {
    classeActive = (classeActive && classeActive.classe_id === "__gomme__")
      ? null
      : { classe_id: "__gomme__", groupe: null, label: "Gomme" };
    await refresh();
  };

  // Clic sur une cellule
  document.querySelectorAll(".edt-cell[data-j][data-c]").forEach(td => {
    td.onclick = async () => {
      const j = td.dataset.j;
      const c = td.dataset.c;
      const key = `${j}|${c}`;

      if (!classeActive) {
        await ouvrirModal(j, c);
        return;
      }

      if (classeActive.classe_id === "__gomme__") {
        bufferEdition.grid.set(key, { classe_id: null, classe_nom: null, groupe: null });
      } else {
        const actuel = bufferEdition.grid.get(key);
        const memeClasse = actuel
          && String(actuel.classe_id) === String(classeActive.classe_id)
          && String(actuel.groupe || "") === String(classeActive.groupe || "");

        if (memeClasse) {
          bufferEdition.grid.set(key, { classe_id: null, classe_nom: null, groupe: null });
        } else {
          const nom = classeActive.label.replace(" gr 1", "").replace(" gr 2", "");
          bufferEdition.grid.set(key, {
            classe_id: classeActive.classe_id,
            classe_nom: nom,
            groupe: classeActive.groupe
          });
        }
      }

      syncState = "dirty";
      await refresh();
    };
  });


if (preparerAnnee) preparerAnnee.onclick = () => ouvrirModalPreparerAnnee();
 if (valider) valider.onclick = async () => {
    const sourceIso = semaineActive.iso_lundi;

   if (!propagerActif) {
      try {
        await saveWeek(sourceIso, true);   // modification isolée → hors série
        await loadWeekStatusIndex();
        syncState = "ok";
        lastSyncAt = new Date();
      } catch (e) {
        console.error(e);
        syncState = "error";
      }
      await refresh();
      return;
    }

    const cibles = calculerCibles(sourceIso);
    await ouvrirModalConfirmation(sourceIso, cibles);
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
   BLOC 7b — MODALE DE CONFIRMATION DE PROPAGATION
   ====================================================== */

async function ouvrirModalConfirmation(sourceIso, cibles) {
  const semSource = semaines.find(s => s.isoLundi === sourceIso);
  const periodes = calculerPeriodes();
  const p = periodes.get(sourceIso) || {};

  const nomSemaine = (iso) => {
    const s = semaines.find(x => x.isoLundi === iso);
    return s ? weekLabel(s) : iso;
  };

  const dejaRemplies = cibles.filter(iso => {
    const st = weekStatusIndex.get(String(iso));
    return st && st.has_data;
  });

  let corps;
  if (!cibles.length) {
    corps = `<p>Aucune autre semaine ${p.type} dans ce ${portee}.<br>
             Seule la semaine courante sera enregistrée.</p>`;
  } else {
    corps = `
      <p><strong>${escapeHtml(weekLabel(semSource))}</strong> (${p.type}, ${p.trimestre})
         + ${cibles.length} semaine(s) :</p>
      <p>${cibles.map(iso => escapeHtml(nomSemaine(iso))).join("<br>")}</p>
      ${dejaRemplies.length
        ? `<p style="color:#c00">Dont ${dejaRemplies.length} déjà remplie(s), qui seront remplacée(s) :<br>
           ${dejaRemplies.map(iso => escapeHtml(nomSemaine(iso))).join("<br>")}</p>`
        : ""}
    `;
  }

  document.getElementById("modal").innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <strong>Confirmer l'enregistrement</strong>
        <button id="cfClose">✕</button>
      </div>
      <div style="height:10px"></div>
      ${corps}
      <div id="cfLog" style="font-size:0.9em"></div>
      <div style="height:10px"></div>
      <div style="display:flex;gap:10px;">
        <button id="cfOk">Confirmer</button>
        <button id="cfCancel">Annuler</button>
      </div>
    </div>
  `;

  const close = () => { document.getElementById("modal").innerHTML = ""; };
  document.getElementById("cfClose").onclick = close;
  document.getElementById("cfCancel").onclick = close;

  document.getElementById("cfOk").onclick = async () => {
    const btn = document.getElementById("cfOk");
    const log = document.getElementById("cfLog");
    btn.disabled = true;
    log.textContent = "Enregistrement…";

    try {
      await saveWeek(sourceIso, false);
      for (const iso of cibles) {
        await saveWeek(iso, false);
      }

      semaineActive.iso_lundi = sourceIso;
      await loadWeekStatusIndex();

      syncState = "ok";
      lastSyncAt = new Date();
      close();
      await refresh();

    } catch (e) {
      console.error(e);
      log.textContent = `Erreur : ${e.message}`;
      btn.disabled = false;
    }
  };
}

/* ======================================================
   BLOC 8 — RESYNCHRONISATION D'UNE SEMAINE HORS SÉRIE
   ====================================================== */

// Semaine jumelle la plus proche en amont
function trouverJumelleAmont(isoCible) {
  const periodes = calculerPeriodes();
  const p = periodes.get(isoCible);
  if (!p || p.type === "V") return null;

  const cle = portee === "semestre" ? "semestre" : "trimestre";

  let trouvee = null;
  semaines.forEach(s => {
    const iso = s.isoLundi;
    if (iso >= isoCible) return;
    const q = periodes.get(iso);
    if (!q || q.type !== p.type || q[cle] !== p[cle]) return;
    const st = weekStatusIndex.get(String(iso));
    if (!st || !st.has_data) return;
    if (st.hors_serie) return;              // on ne copie pas une autre exception
    trouvee = iso;                          // la boucle avance, on garde la dernière
  });

  return trouvee;
}

async function resynchroniserSemaine(isoCible) {
  const source = trouverJumelleAmont(isoCible);
  if (!source) {
    alert("Aucune semaine jumelle enregistrée avant celle-ci.");
    return;
  }

  const semSource = semaines.find(s => s.isoLundi === source);
  const nom = semSource ? weekLabel(semSource) : source;

  if (!confirm(`Reprendre le contenu de ${nom} ?\nLa saisie actuelle sera remplacée.`)) return;

  try {
    // Charge la source dans le buffer, puis réécrit sur la cible
    await loadWeek(source);
    await saveWeek(isoCible, false);
    await loadWeek(isoCible);
    await loadWeekStatusIndex();

    syncState = "ok";
    lastSyncAt = new Date();
    await refresh();
  } catch (e) {
    console.error(e);
    alert(`Resynchronisation impossible : ${e.message}`);
  }
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
   BLOC 3a — GÉNÉRATION DES SEMAINES D'UNE ANNÉE
   ====================================================== */

// Numéro de semaine ISO d'une date ISO "2027-01-04"
function numeroSemaineISO(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // jeudi de la semaine courante
  const jour = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - jour);
  const debutAnnee = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil(((dt - debutAnnee) / 86400000 + 1) / 7);
}

// Lundi de la semaine contenant le 1er septembre
function premierLundiSeptembre(annee) {
  const dt = new Date(Date.UTC(annee, 8, 1)); // 8 = septembre
  const jour = dt.getUTCDay() || 7;           // dimanche = 7
  dt.setUTCDate(dt.getUTCDate() - (jour - 1));
  return dt.toISOString().slice(0, 10);
}

// Calcule la liste des semaines, sans rien écrire
function calculerSemainesAnnee(anneeScolaire) {
  const [debut, fin] = anneeScolaire.split("-").map(Number);
  if (!debut || !fin) throw new Error(`Année scolaire invalide : ${anneeScolaire}`);

  const premier = premierLundiSeptembre(debut);
  const limite = `${fin}-08-31`;

  const out = [];
  let courant = premier;

  while (courant <= limite) {
    out.push({
      libelle: `Semaine ${numeroSemaineISO(courant)}`,
      date_lundi: courant,
      annee_scolaire: anneeScolaire
    });
    courant = addDaysISO(courant, 7);
  }

  return out;
}

// Insère les semaines manquantes d'une année
async function genererSemaines(anneeScolaire) {
  const sb = sbAgoram();

  const { data: existantes, error: errSel } = await sb
    .from("semaines")
    .select("date_lundi")
    .eq("annee_scolaire", anneeScolaire);

  if (errSel) throw new Error(`Lecture semaines impossible. ${errSel.message}`);

  const dejaLa = new Set((existantes || []).map(s => String(s.date_lundi)));
  const toutes = calculerSemainesAnnee(anneeScolaire);
  const aCreer = toutes.filter(s => !dejaLa.has(s.date_lundi));

  if (!aCreer.length) {
    return { crees: 0, existantes: dejaLa.size, total: toutes.length };
  }

  const { error: errIns } = await sb.from("semaines").insert(aCreer);
  if (errIns) throw new Error(`Insertion semaines impossible. ${errIns.message}`);

  return { crees: aCreer.length, existantes: dejaLa.size, total: toutes.length };
}

/* ======================================================
   BLOC 3c — MODALE "PRÉPARER UNE ANNÉE"
   ====================================================== */

async function ouvrirModalPreparerAnnee() {
  const sb = sbAgoram();

  const { data: annees, error } = await sb
    .from("annees")
    .select("id, libelle, premiere_semaine_a, debut_t2, debut_t3, debut_s2, calendrier_importe_le")
    .order("libelle");

  if (error) { alert(`Lecture années impossible. ${error.message}`); return; }

  const optAnnees = (annees || [])
    .map(a => `<option value="${a.libelle}">${escapeHtml(a.libelle)}</option>`)
    .join("");

  document.getElementById("modal").innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <strong>Préparer une année</strong>
        <button id="paClose">✕</button>
      </div>
      <div style="height:10px"></div>

      <label>Année scolaire</label>
      <select id="paAnnee">${optAnnees}</select>
      <div style="height:10px"></div>

      <label>1re semaine A (lundi)</label>
      <input type="date" id="paSemA">
      <div style="height:6px"></div>

      <label>Début T2 (lundi)</label>
      <input type="date" id="paT2">
      <div style="height:6px"></div>

      <label>Début T3 (lundi)</label>
      <input type="date" id="paT3">
      <div style="height:6px"></div>

      <label>Début S2 (lundi)</label>
      <input type="date" id="paS2">
      <div style="height:10px"></div>

      <div id="paLog" style="font-size:0.9em;white-space:pre-line;"></div>
      <div style="height:10px"></div>

      <div style="display:flex;gap:10px;">
        <button id="paOk">Lancer</button>
        <button id="paCancel">Annuler</button>
      </div>
    </div>
  `;

  const close = () => { document.getElementById("modal").innerHTML = ""; };
  document.getElementById("paClose").onclick = close;
  document.getElementById("paCancel").onclick = close;

  const selAnnee = document.getElementById("paAnnee");
  const log = document.getElementById("paLog");

  // Pré-remplit les champs avec les valeurs déjà en base
  const remplirChamps = () => {
    const a = (annees || []).find(x => x.libelle === selAnnee.value);
    document.getElementById("paSemA").value = a?.premiere_semaine_a || "";
    document.getElementById("paT2").value = a?.debut_t2 || "";
    document.getElementById("paT3").value = a?.debut_t3 || "";
    document.getElementById("paS2").value = a?.debut_s2 || "";
    log.textContent = a?.calendrier_importe_le
      ? `Calendrier importé le ${new Date(a.calendrier_importe_le).toLocaleDateString("fr-FR")}`
      : "Calendrier jamais importé.";
  };
  selAnnee.onchange = remplirChamps;
  remplirChamps();

  document.getElementById("paOk").onclick = async () => {
    const anneeScolaire = selAnnee.value;
    const repere = {
      premiere_semaine_a: document.getElementById("paSemA").value || null,
      debut_t2: document.getElementById("paT2").value || null,
      debut_t3: document.getElementById("paT3").value || null,
      debut_s2: document.getElementById("paS2").value || null
    };

    // Contrôle : toutes les dates doivent être des lundis
    const mauvais = Object.entries(repere)
      .filter(([, v]) => v && new Date(v + "T12:00:00").getDay() !== 1)
      .map(([k]) => k);

    if (mauvais.length) {
      log.textContent = `⚠ Ces dates ne sont pas des lundis : ${mauvais.join(", ")}`;
      return;
    }

    const btn = document.getElementById("paOk");
    btn.disabled = true;
    log.textContent = "";

    const ajouter = (txt) => { log.textContent += txt + "\n"; };

    try {
      // 1. Semaines
      const rs = await genererSemaines(anneeScolaire);
      ajouter(`✔ Semaines : ${rs.crees} créées, ${rs.existantes} déjà présentes.`);

      // 2. Repères
      const { error: errRep } = await sb
        .from("annees").update(repere).eq("libelle", anneeScolaire);
      if (errRep) throw new Error(`Enregistrement repères impossible. ${errRep.message}`);
      ajouter("✔ Repères enregistrés.");

      // 3. Calendrier
      try {
        const rc = await importerCalendrier(anneeScolaire);
        ajouter(`✔ Calendrier : ${rc.joursVacances} jours de vacances, ${rc.feriesHorsVacances} fériés.`);
      } catch (e) {
        ajouter(`⚠ Calendrier non importé : ${e.message}`);
      }

ajouter("\nTerminé.");
      const btnFermer = document.getElementById("paCancel");
      btnFermer.textContent = "Fermer et recharger";
      btnFermer.onclick = () => location.reload();

    } catch (e) {
      ajouter(`✖ ${e.message}`);
    } finally {
      btn.disabled = false;
    }
  };
}

window._dbg = {
  loadReperesAnnee, loadJoursVacances, calculerPeriodes,
  getSemaines: () => semaines,
  calculerSemainesAnnee, genererSemaines,
  calculerCalendrier, importerCalendrier,
  couleurClasse
};

/* ======================================================
   BLOC 3b — IMPORT DU CALENDRIER (vacances + fériés)
   ====================================================== */

const ACADEMIE = "Versailles";
const ZONE = "Zone C";

// Date locale (Paris) d'un timestamp ISO renvoyé par l'API
function dateLocaleDepuisISO(ts) {
  return String(ts).slice(0, 10);
}

// Récupère les périodes de vacances d'une année scolaire
async function fetchVacances(anneeScolaire) {
  const where = encodeURIComponent(
    `zones="${ZONE}" and annee_scolaire="${anneeScolaire}" and location="${ACADEMIE}"`
  );
  const url =
    `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/` +
    `fr-en-calendrier-scolaire/records?where=${where}&limit=100`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API vacances: HTTP ${res.status}`);
  const json = await res.json();
  return json.results || [];
}

// Développe les périodes en jours individuels
function developperVacances(periodes, anneeScolaire) {
  const finAnnee = `${anneeScolaire.split("-")[1]}-08-31`;
  const out = new Map(); // date -> libelle

  periodes.forEach(p => {
    const debutSource = dateLocaleDepuisISO(p.start_date);
    const finSource = dateLocaleDepuisISO(p.end_date);
    const libelle = p.description || "Vacances";

    // Les vacances commencent le lendemain du dernier jour de classe
    const premier = addDaysISO(debutSource, 1);

    let dernier;
    if (libelle.includes("Été")) {
      dernier = finAnnee;                       // jusqu'à la fin de l'année scolaire
    } else if (debutSource === finSource) {
      dernier = premier;                        // jour unique (pont)
    } else {
      dernier = addDaysISO(finSource, -1);      // veille de la reprise
    }

    let courant = premier;
    while (courant <= dernier) {
      out.set(courant, libelle);
      courant = addDaysISO(courant, 1);
    }
  });

  return out;
}

// Récupère les jours fériés d'une année civile
async function fetchFeries(anneeCivile) {
  const url = `https://calendrier.api.gouv.fr/jours-feries/metropole/${anneeCivile}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API fériés ${anneeCivile}: HTTP ${res.status}`);
  return await res.json(); // { "2027-01-01": "1er janvier", ... }
}

// Calcule tout, sans rien écrire en base
async function calculerCalendrier(anneeScolaire) {
  const [an1, an2] = anneeScolaire.split("-").map(Number);
  const debutAnnee = `${an1}-08-01`;
  const finAnnee = `${an2}-08-31`;

  const periodes = await fetchVacances(anneeScolaire);
  if (!periodes.length) {
    throw new Error(`Aucune période trouvée pour ${anneeScolaire} / ${ACADEMIE}.`);
  }
  const vacances = developperVacances(periodes, anneeScolaire);

  const feries = new Map();
  for (const an of [an1, an2]) {
    const data = await fetchFeries(an);
    Object.entries(data).forEach(([date, nom]) => {
      if (date >= debutAnnee && date <= finAnnee) feries.set(date, nom);
    });
  }

  // Un férié pendant les vacances reste marqué "vacances"
  const lignes = [];
  vacances.forEach((libelle, date) => {
    lignes.push({ date, type: "vacances", libelle });
  });
  feries.forEach((libelle, date) => {
    if (!vacances.has(date)) {
      lignes.push({ date, type: "ferie", libelle });
    }
  });

  lignes.sort((a, b) => a.date.localeCompare(b.date));

  return {
    lignes,
    resume: {
      periodes: periodes.length,
      joursVacances: vacances.size,
      feriesHorsVacances: lignes.filter(l => l.type === "ferie").length
    }
  };
}

// Écrit en base, en préservant les jours marqués "travaillé"
async function importerCalendrier(anneeScolaire) {
  const sb = sbAgoram();

  const { data: annee, error: errA } = await sb
    .from("annees").select("id").eq("libelle", anneeScolaire).maybeSingle();

  if (errA) throw new Error(`Lecture année impossible. ${errA.message}`);
  if (!annee) throw new Error(`Année ${anneeScolaire} introuvable.`);

  const { lignes, resume } = await calculerCalendrier(anneeScolaire);

  // Jours déjà marqués travaillés : à préserver
  const { data: dejaTravailles } = await sb
    .from("jours_speciaux")
    .select("date")
    .eq("annee_id", annee.id)
    .eq("travaille", true);

  const preserves = new Set((dejaTravailles || []).map(r => String(r.date)));

  const payload = lignes.map(l => ({
    annee_id: annee.id,
    date: l.date,
    type: l.type,
    libelle: l.libelle,
    travaille: preserves.has(l.date)
  }));

  const { error: errUp } = await sb
    .from("jours_speciaux")
    .upsert(payload, { onConflict: "annee_id,date" });

  if (errUp) throw new Error(`Écriture jours_speciaux impossible. ${errUp.message}`);

  await sb.from("annees")
    .update({ calendrier_importe_le: new Date().toISOString() })
    .eq("id", annee.id);

  return { ...resume, ecrites: payload.length, preserves: preserves.size };
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
