// =======================================================
// PAGE : Import / Export — AGORAMOSAÏQUE
// RÔLE MÉTIER (Supabase, schéma agoram) :
// - Import CSV élèves : prenom, nom, classe, genre
// - Accepte CSV séparé par ";" (Excel FR) OU "," (CSV standard) — cas simple
// - Crée automatiquement les classes manquantes pour l’année active
// - Upsert des élèves (clé : classe_id + prenom + nom)
// - Maintient un miroir mémoire eleves[] (pour les pages qui lisent encore getEleves/getClasses)
// DÉPENDANCES : window.sb (supabase-js v2), window.appAnneeCourante
// TABLES : agoram.annees (nom, active), agoram.classes (annee_id, nom, ...), agoram.eleves (classe_id, prenom, nom, genre, ...)
// =======================================================

const DB_SCHEMA = "agoram";

// -------------------------------------------------------
// BLOC 1 — ÉTAT CENTRAL EN MÉMOIRE (miroir UI)
// -------------------------------------------------------
let eleves = [];        // { id(local), prenom, nom, classe, genre, adaptations:[] }
let bulletinsHG = [];   // conservé si besoin ailleurs
let nextId = 1;

// -------------------------------------------------------
// BLOC 2 — NORMALISATION & OUTILS
// -------------------------------------------------------
function norm(s) {
  return String(s ?? "").trim();
}

function normaliserGenre(valeur) {
  const v = norm(valeur).toLowerCase();
  if (!v) return "";
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m")) return "M";
  return "Autre";
}

function buildEleveKey(eleve) {
  return `${eleve.prenom}|${eleve.nom}|${eleve.classe}`;
}

function splitLines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/**
 * Parse CSV CAS SIMPLE :
 * - séparateur colonnes : détecté automatiquement ";" ou ","
 * - pas de guillemets complexes, pas de séparateurs internes dans les valeurs
 * - lignes vides ignorées
 */
function parseCSVSimple(content) {
  const lines = splitLines(content).map(l => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error("CSV vide.");

  const headerLine = lines[0];

  // Détection robuste : on choisit le séparateur le plus présent dans l'en-tête
  const semicolons = (headerLine.match(/;/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  const sep = semicolons > commas ? ";" : ",";

  const headers = headerLine.split(sep).map(h => norm(h).toLowerCase());
  if (!headers.length) throw new Error("En-tête CSV invalide.");

  const rows = lines.slice(1).map(line => {
    const parts = line.split(sep).map(v => norm(v));
    // Compléter si ligne plus courte que headers
    while (parts.length < headers.length) parts.push("");
    return parts;
  });

  return { headers, rows, separator: sep };
}

function requireSupabase() {
  if (!window.sb) {
    throw new Error("Supabase non initialisé (window.sb absent).");
  }
  return window.sb;
}

// IMPORTANT : on force le schéma pour éviter tout accès par défaut à public.
// Supabase recommande .schema('myschema').from('table') pour cibler un schéma. [1](https://github.com/orgs/supabase/discussions/16570)
function sbAgoram() {
  return requireSupabase().schema(DB_SCHEMA);
}

// -------------------------------------------------------
// BLOC 3 — API MÉTIER PUBLIQUE (pages existantes)
// -------------------------------------------------------
export function getEleves() {
  return eleves;
}

export function getClasses() {
  return [...new Set(eleves.map(e => e.classe))].sort();
}

export function getClassesAvecGroupes() {
  const classes = getClasses();
  const out = [];
  classes.forEach(c => {
    out.push({ classe: c, groupe: null, label: c });
    out.push({ classe: c, groupe: "gr 1", label: `${c} gr 1` });
    out.push({ classe: c, groupe: "gr 2", label: `${c} gr 2` });
  });
  return out;
}

// -------------------------------------------------------
// BLOC 4 — SUPABASE : ANNÉE ACTIVE + CLASSES
// -------------------------------------------------------
async function ensureAnneeActive() {
  const sb = sbAgoram();
  const nomAnnee = norm(window.appAnneeCourante);
  if (!nomAnnee) throw new Error("Année courante absente (window.appAnneeCourante).");

  // Chercher l'année par nom
  const { data: found, error: errSel } = await sb
    .from("annees")
    .select("id, nom, active")
    .eq("nom", nomAnnee)
    .maybeSingle();

  if (errSel) throw new Error(`Impossible de lire 'annees'. ${errSel.message}`);

  // Si absente : désactiver toute active, créer celle-ci en active
  if (!found) {
    const { error: errOff } = await sb
      .from("annees")
      .update({ active: false })
      .eq("active", true);
    if (errOff) throw new Error(`Impossible de désactiver l’année active. ${errOff.message}`);

    const { data: created, error: errIns } = await sb
      .from("annees")
      .insert([{ nom: nomAnnee, active: true }])
      .select("id, nom, active")
      .single();
    if (errIns) throw new Error(`Impossible de créer l’année '${nomAnnee}'. ${errIns.message}`);

    return created.id;
  }

  // Si trouvée mais pas active : désactiver l'actuelle, activer celle-ci
  if (!found.active) {
    const { error: errOff } = await sb
      .from("annees")
      .update({ active: false })
      .eq("active", true);
    if (errOff) throw new Error(`Impossible de désactiver l’année active. ${errOff.message}`);

    const { error: errOn } = await sb
      .from("annees")
      .update({ active: true })
      .eq("id", found.id);
    if (errOn) throw new Error(`Impossible d’activer l’année '${nomAnnee}'. ${errOn.message}`);
  }

  return found.id;
}

async function ensureClassesForAnnee(anneeId, nomsClasses) {
  const sb = sbAgoram();
  const uniques = [...new Set(nomsClasses.map(norm).filter(Boolean))].sort();
  if (!uniques.length) {
    return { map: new Map(), createdCount: 0, totalCount: 0 };
  }

  // Lire les classes existantes
  const { data: existing, error: errSel } = await sb
    .from("classes")
    .select("id, nom")
    .eq("annee_id", anneeId);

  if (errSel) throw new Error(`Impossible de lire 'classes'. ${errSel.message}`);

  const map = new Map();
  (existing ?? []).forEach(c => map.set(c.nom, c.id));

  const toCreate = uniques
    .filter(nom => !map.has(nom))
    .map(nom => ({
      annee_id: anneeId,
      nom,
      couleur: null,
      est_pp: false
    }));

  // On rend l'insert idempotent via upsert sur la contrainte (annee_id, nom) si elle existe.
  // Si l'index unique n'existe pas, l'insert créera tout de même (mais peut doubler).
  let createdCount = 0;

  if (toCreate.length) {
    const { data: inserted, error: errUp } = await sb
      .from("classes")
      .upsert(toCreate, { onConflict: "annee_id,nom" })
      .select("id, nom");

    if (errUp) throw new Error(`Création classes impossible. ${errUp.message}`);

    // inserted contient les lignes insérées/affectées selon Supabase, on recalcule la map
    (inserted ?? []).forEach(c => {
      if (!map.has(c.nom)) createdCount++;
      map.set(c.nom, c.id);
    });
  }

  return { map, createdCount, totalCount: map.size };
}

// -------------------------------------------------------
// BLOC 5 — IMPORT CSV (mémoire + Supabase)
// CSV attendu : prenom,nom,classe,genre (séparateur ";" ou ",")
// -------------------------------------------------------
async function importerElevesCSV(contenuCSV) {
  const { headers, rows } = parseCSVSimple(contenuCSV);

  // Champs obligatoires
  const required = ["prenom", "nom", "classe", "genre"];
  required.forEach(ch => {
    if (!headers.includes(ch)) throw new Error(`Colonne obligatoire absente : ${ch}`);
  });

  const idx = (h) => headers.indexOf(h);

  // Construire la liste importée depuis CSV
  const imported = [];
  for (let r = 0; r < rows.length; r++) {
    const vals = rows[r];

    const prenom = norm(vals[idx("prenom")]);
    const nom = norm(vals[idx("nom")]);
    const classe = norm(vals[idx("classe")]);
    const genre = normaliserGenre(vals[idx("genre")]);

    if (!prenom || !nom || !classe || !genre) {
      throw new Error(`Ligne invalide (ligne ${r + 2}) : données manquantes`);
    }

    imported.push({ prenom, nom, classe, genre });
  }

  // Garantir année active + classes
  const anneeId = await ensureAnneeActive();
  const { map: classesMap, createdCount: classesCreated, totalCount: classesTotal } =
    await ensureClassesForAnnee(anneeId, imported.map(e => e.classe));

  // Construire payload élèves (classe_id obligatoire)
  const payload = imported.map(e => ({
    classe_id: classesMap.get(e.classe),
    prenom: e.prenom,
    nom: e.nom,
    genre: e.genre
    // groupe / adaptations non importés ici
  }));

  // Sécurité : tout classe_id doit être résolu
  const unresolved = payload.find(p => !p.classe_id);
  if (unresolved) throw new Error("Résolution classe_id impossible (classe non créée / non lue).");

  // Upsert élèves (clé : classe_id, prenom, nom)
  const sb = sbAgoram();
  const { error: errUpsert } = await sb
    .from("eleves")
    .upsert(payload, { onConflict: "classe_id,prenom,nom" });

  if (errUpsert) throw new Error(`Upsert élèves impossible. ${errUpsert.message}`);

  // Miroir mémoire : remplace la mémoire par le CSV importé
  eleves = imported.map(e => ({
    id: nextId++,
    prenom: e.prenom,
    nom: e.nom,
    classe: e.classe,
    genre: e.genre,
    adaptations: [] // non importé
  }));

  // Bulletins HG (si utilisé ailleurs)
  bulletinsHG = eleves.map(e => ({
    eleveKey: buildEleveKey(e),
    periode: "T1",
    texte: "Bulletin HG non encore généré."
  }));

  return {
    countEleves: eleves.length,
    classesCreated,
    classesTotal
  };
}

// -------------------------------------------------------
// BLOC 6 — EXPORT CSV (depuis mémoire)
// -------------------------------------------------------
function exporterElevesCSV() {
  // Export minimal aligné sur l’import : prenom,nom,classe,genre
  let csv = "prenom;nom;classe;genre\n"; // Excel FR : ; par défaut
  eleves.forEach(e => {
    const safe = (v) => String(v ?? "").replace(/\n/g, " ").trim();
    csv += `${safe(e.prenom)};${safe(e.nom)};${safe(e.classe)};${safe(e.genre)}\n`;
  });
  return csv;
}

// -------------------------------------------------------
// BLOC 7 — UI (HTML)
// -------------------------------------------------------
export function renderImportExport() {
  const annee = norm(window.appAnneeCourante) || "—";
  return `
    <section class="page page-importexport">
      <h1>Import / Export</h1>

      <div class="card">
        <div class="card-head">
          <h2>Importer des élèves (CSV)</h2>
          <div class="hint">Année active : <strong>${annee}</strong></div>
          <div class="hint">Colonnes attendues : <code>prenom;nom;classe;genre</code> (ou virgules)</div>
        </div>

        <div class="card-body">
          <input type="file" id="csvInput" accept=".csv" class="input-file">
          <div id="importStatus" class="status"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Exporter</h2>
        </div>
        <div class="card-body">
          <button id="exportElevesBtn" class="btn">Exporter élèves (CSV)</button>
        </div>
      </div>
    </section>
  `;
}

// -------------------------------------------------------
// BLOC 8 — UI (Events)
// -------------------------------------------------------
export function bindImportExportEvents() {
  const input = document.getElementById("csvInput");
  const status = document.getElementById("importStatus");
  const exportBtn = document.getElementById("exportElevesBtn");

  if (input) {
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;

      status.textContent = "⏳ Lecture du fichier…";
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const res = await importerElevesCSV(reader.result);
          status.textContent =
            `✅ Import OK — ${res.countEleves} élèves · classes créées: ${res.classesCreated} · total classes année: ${res.classesTotal}`;
        } catch (e) {
          status.textContent = "❌ " + (e?.message || String(e));
        }
      };

      reader.readAsText(file);
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      const csv = exporterElevesCSV();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `eleves_${norm(window.appAnneeCourante) || "annee"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}
