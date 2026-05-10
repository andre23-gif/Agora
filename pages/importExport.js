// =======================================================
// IMPORT / EXPORT — AGORAMOSAÏQUE
// Source centrale : élèves + classes + groupes
// =======================================================

// -------------------------------------------------------
// ÉTAT CENTRAL
// -------------------------------------------------------

let eleves = [];
let bulletinsHG = [];

let nextId = 1;

// -------------------------------------------------------
// OUTILS
// -------------------------------------------------------

function normaliserGenre(valeur) {
  const v = valeur.toLowerCase();
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m")) return "M";
  return "Autre";
}

function buildEleveKey(eleve) {
  return `${eleve.prenom}|${eleve.nom}|${eleve.classe}`;
}

// -------------------------------------------------------
// ACCÈS MÉTIER GLOBAL
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
// IMPORT CSV — ÉLÈVES
// -------------------------------------------------------

function importerElevesCSV(contenuCSV) {
  const lignes = contenuCSV.trim().split("\n");
  const entetes = lignes[0].split(",").map(h => h.trim().toLowerCase());

  const champsObligatoires = ["prenom", "nom", "classe", "genre"];

  champsObligatoires.forEach(champ => {
    if (!entetes.includes(champ)) {
      throw new Error(`Colonne obligatoire absente : ${champ}`);
    }
  });

  lignes.slice(1).forEach(ligne => {
    const valeurs = ligne.split(",");

    const get = champ =>
      valeurs[entetes.indexOf(champ)]?.trim() ?? "";

    const prenom = get("prenom");
    const nom = get("nom");
    const classe = get("classe");
    const genre = normaliserGenre(get("genre"));

    if (!prenom || !nom || !classe || !genre) {
      throw new Error("Ligne invalide : données manquantes");
    }

    const adaptations = entetes.includes("adaptations")
      ? get("adaptations")
          .split(";")
          .map(a => a.trim())
          .filter(Boolean)
      : [];

    const existant = eleves.find(
      e =>
        e.prenom === prenom &&
        e.nom === nom &&
        e.classe === classe
    );

    if (existant) {
      existant.genre = genre;
      existant.adaptations = adaptations;
    } else {
      const nouvelEleve = {
        id: nextId++,
        prenom,
        nom,
        classe,
        genre,
        adaptations,
      };

      eleves.push(nouvelEleve);

      bulletinsHG.push({
        eleveKey: buildEleveKey(nouvelEleve),
        periode: "T1",
        texte: "Bulletin HG non encore généré."
      });
    }
  });
}

// -------------------------------------------------------
// EXPORT CSV — ÉLÈVES
// -------------------------------------------------------

function exporterElevesCSV() {
  let csv = "prenom,nom,classe,genre,adaptations\n";

  eleves.forEach(e => {
    csv += `"${e.prenom}","${e.nom}","${e.classe}","${e.genre}","${e.adaptations.join(";")}"\n`;
  });

  return csv;
}

// -------------------------------------------------------
// UI
// -------------------------------------------------------

export function renderImportExport() {
  return `
    <section>
      <h1>Import / Export</h1>

      <h2>Importer des élèves (CSV)</h2>
      <input type="file" id="csvInput" accept=".csv">
      <div id="importStatus"></div>

      <h2>Exporter</h2>

      <button id="exportElevesBtn">Exporter élèves</button>
    </section>
  `;
}

export function bindImportExportEvents() {
  const input = document.getElementById("csvInput");
  const status = document.getElementById("importStatus");

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        importerElevesCSV(reader.result);
        status.textContent = "✅ Import réussi";
      } catch (e) {
        status.textContent = "❌ " + e.message;
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("exportElevesBtn")
    .addEventListener("click", () => {
      console.log(exporterElevesCSV());
    });
}
