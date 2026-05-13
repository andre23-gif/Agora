// =======================================================
// PAGE : Import / Export — AGORAMOSAÏQUE
// RÔLE MÉTIER (version Supabase) :
// - Import CSV élèves (prenom, nom, classe, genre)
// - Crée automatiquement les classes manquantes (par année active)
// - Upsert des élèves (clé : classe_id + prenom + nom)
// - Maintient un miroir mémoire eleves[] (pour alimenter les pages existantes)
// EXPOSE : getEleves(), getClasses(), getClassesAvecGroupes()
// DÉPENDANCES : window.sb (supabase-js v2), schéma "agoram"
// ANNÉE : window.appAnneeCourante (ex "2024-2025")
// =======================================================

// -------------------------------------------------------
// BLOC 1 — ÉTAT CENTRAL EN MÉMOIRE (miroir UI)
// -------------------------------------------------------
let eleves = [];        // { id(local), prenom, nom, classe, genre, groupe?, adaptations? }
let bulletinsHG = [];   // conservé si tu l’utilises ailleurs
let nextId = 1;

// -------------------------------------------------------
// BLOC 2 — NORMALISATION & OUTILS
// -------------------------------------------------------
function normaliserGenre(valeur) {
  const v = String(valeur ?? "").trim().toLowerCase();
  if (!v) return "";
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m")) return "M";
  return "Autre";
}

function buildEleveKey(eleve) {
  return `${eleve.prenom}|${eleve.nom}|${eleve.classe}`;
}

function norm(s) {
  return String(s ?? "").trim();
}

function splitLines(text) {
  // gère \n / \r\n
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/**
 * Parse CSV minimal (comma-separated) avec guillemets standards.
 * - séparateur colonnes : ,
 * - champs potentiellement "quotés"
 * - pas de multi-ligne dans les champs
 */
function parseCSV(content) {
  const lines = splitLines(content).filter(l => l.trim() !== "");
  if (!lines.length) throw new Error("CSV vide.");

  const parseLine = (line) => {
    const out = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        // "" -> échappement
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
        continue;
      }

      cur += ch;
    }
    out.push(cur);
    return out.map(v => v.trim());
  };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase());
  return { headers, rows: lines.slice(1).map(parseLine) };
}

function requireSupabase() {
  if (!window.sb) {
    throw new Error("Supabase non initialisé (window.sb absent). Vérifie index.html.");
  }
  return window.sb;
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
  const result = [];
  classes.forEach(c => {
    result.push({ classe: c, groupe: null, label: c });
    result.push({ classe: c, groupe: "gr 1", label: `${c} gr 1` });
    result.push({ classe: c, groupe: "gr 2", label: `${c} gr 2` });
  });
  return result;
}

// -------------------------------------------------------
// BLOC 4 — SUPABASE : ANNÉE ACTIVE + CLASSES
// -------------------------------------------------------
async function ensureAnneeActive() {
  const sb = requireSupabase();
  const nomAnnee = norm(window.appAnneeCourante);
  if (!nomAnnee) throw new Error("Année courante absente (window.appAnneeCourante).");

  // 1) Chercher par nom
  const { data: found, error: errSel } = await sb
    .from("annees")
    .select("id, nom, active")
    .eq("nom", nomAnnee)
    .maybeSingle();

  if (errSel) {
    // typiquement : table inexistante / schema non exposé / RLS
    throw new Error(`Impossible de lire 'annees'. ${errSel.message}`);
  }

  // 2) Si absente : créer et la rendre active (en désactivant toute active existante)
  if (!found) {
    const { error: errOff } = await sb
      .from("annees")
      .update({ active: false })
      .eq("active", true);

    if (errOff) {
      throw new Error(`Impossible de désactiver l’année active. ${errOff.message}`);
    }

    const { data: created, error: errIns } = await sb
      .from("annees")
      .insert([{ nom: nomAnnee, active: true }])
      .select("id, nom, active")
      .single();

    if (errIns) {
      throw new Error(`Impossible de créer l’année '${nomAnnee}'. ${errIns.message}`);
    }
    return created.id;
  }

  // 3) Si trouvée mais pas active : la rendre active et désactiver les autres
  if (!found.active) {
    const { error: errOff } = await sb
      .from("annees")
      .update({ active: false })
      .eq("active", true);

    if (errOff) {
      throw new Error(`Impossible de désactiver l’année active. ${errOff.message}`);
    }

    const { error: errOn } = await sb
      .from("annees")
      .update({ active: true })
      .eq("id", found.id);

    if (errOn) {
      throw new Error(`Impossible d’activer l’année '${nomAnnee}'. ${errOn.message}`);
    }
  }

  return found.id;
}

async function ensureClassesForAnnee(anneeId, nomsClasses) {
  const sb = requireSupabase();
  const uniques = [...new Set(nomsClasses.map(norm).filter(Boolean))].sort();
  if (!uniques.length) return new Map();

  // Lire les classes existantes
  const { data: existing, error: errSel } = await sb
    .from("classes")
    .select("id, nom")
    .eq("annee_id", anneeId);

  if (errSel) throw new Error(`Impossible de lire 'classes'. ${errSel.message}`);

  const map = new Map();
  (existing ?? []).forEach(c => map.set(c.nom, c.id));

  // Déterminer celles à créer
  const toCreate = uniques
    .filter(nom => !map.has(nom))
    .map(nom => ({ annee_id: anneeId, nom, couleur: null, est_pp: false }));

  if (toCreate.length) {
    const { data: inserted, error: errIns } = await sb
      .from("classes")
      .insert(toCreate)
      .select("id, nom");

    if (errIns) {
      throw new Error(`Création classes impossible. ${errIns.message}`);
    }

    (inserted ?? []).forEach(c => map.set(c.nom, c.id));
  }

  return map; // Map(nomClasse -> classeId)
}

// -------------------------------------------------------
// BLOC 5 — IMPORT CSV (mémoire + Supabase)
// CSV attendu : prenom,nom,classe,genre
// -------------------------------------------------------
async function importerElevesCSV(contenuCSV) {
  const { headers, rows } = parseCSV(contenuCSV);

  // Champs obligatoires
  const champs = ["prenom", "nom", "classe", "genre"];
  champs.forEach(ch => {
    if (!headers.includes(ch)) throw new Error(`Colonne obligatoire absente : ${ch}`);
  });

  // Index
  const idx = (h) => headers.indexOf(h);

  // 1) Construire liste élèves depuis CSV (mémoire)
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

  // 2) Garantir année active + classes en base (règle B)
  const anneeId = await ensureAnneeActive();
  const classesMap = await ensureClassesForAnnee(anneeId, imported.map(e => e.classe));

  // 3) Upsert élèves en base (clé : classe_id, prenom, nom)
  //    - groupe/adaptations non importés ici (gérés ailleurs)
  const payload = imported.map(e => ({
    classe_id: classesMap.get(e.classe),
    prenom: e.prenom,
    nom: e.nom,
    genre: e.genre,
    // groupe / adaptations non renseignés ici
  }));

  // sécurité : toute classe doit avoir été résolue
  const unresolved = payload.find(p => !p.classe_id);
  if (unresolved) {
    throw new Error("Résolution classe_id impossible (classe non créée / non lue).");
  }

  const sb = requireSupabase();
  const { error: errUpsert } = await sb
    .from("eleves")
    .upsert(payload, { onConflict: "classe_id,prenom,nom" });

  if (errUpsert) {
    throw new Error(`Upsert élèves impossible. ${errUpsert.message}`);
  }

  // 4) Miroir mémoire (remplace la mémoire par le CSV importé)
  //    (non destructif pour Supabase : on a upserté, pas supprimé)
  eleves = imported.map(e => ({
    id: nextId++,
    prenom: e.prenom,
    nom: e.nom,
    classe: e.classe,
    genre: e.genre,
    adaptations: [], // non importé
  }));

  // 5) Bulletins HG (si utilisé par ailleurs)
  bulletinsHG = eleves.map(e => ({
    eleveKey: buildEleveKey(e),
    periode: "T1",
    texte: "Bulletin HG non encore généré.",
  }));

  return { countEleves: eleves.length, countClasses: classesMap.size };
}

// -------------------------------------------------------
// BLOC 6 — EXPORT CSV (depuis mémoire)
// -------------------------------------------------------
function exporterElevesCSV() {
  // Export minimal aligné sur le CSV d’import : sans adaptations
  let csv = "prenom,nom,classe,genre\n";
  eleves.forEach(e => {
    // CSV standard : quote si nécessaire
    const q = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    csv += `${q(e.prenom)},${q(e.nom)},${q(e.classe)},${q(e.genre)}\n`;
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
          <div class="hint">Colonnes attendues : <code>prenom,nom,classe,genre</code></div>
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
          status.textContent = `✅ Import OK — ${res.countEleves} élèves, ${res.countClasses} classes (année active)`;
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
      // téléchargement direct (UTF-8)
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
