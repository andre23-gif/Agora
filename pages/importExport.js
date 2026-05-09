// ===============================
// DONNÉES MÉTIER PARTAGÉES
// ===============================

let eleves = [];

// ===============================
// MOTEUR IMPORT
// ===============================

function importerCSV(contenuCSV) {
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
      eleves.push({
        prenom,
        nom,
        classe,
        genre,
        adaptations,
        participation: "passif",
        suivi: {},
      });
    }
  });
}

// ===============================
// MOTEUR EXPORT
// ===============================

function exporterCSV() {
  const entetes = [
    "prenom",
    "nom",
    "classe",
    "genre",
    "adaptations",
    "participation",
  ];

  const lignes = [entetes.join(",")];

  eleves.forEach(e => {
    lignes.push(
      [
        e.prenom,
        e.nom,
        e.classe,
        e.genre,
        e.adaptations.join(";"),
        e.participation,
      ].join(",")
    );
  });

  return lignes.join("\n");
}

// ===============================
// OUTILS
// ===============================

function normaliserGenre(valeur) {
  const v = valeur.toLowerCase();
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m")) return "M";
  return "Autre";
}

// ===============================
// UI IMPORT / EXPORT
// ===============================

export function renderImportExport() {
  return `
    <section>

      <h1>Import / Export des données</h1>

      <p>
        Cette page permet d’alimenter l’application en données
        et d’en extraire une copie exploitable.
      </p>

      <p>
        Les données importées sont immédiatement utilisées
        par les autres pages de l’application
        (Salle, Classes, Suivi, Bulletins).
      </p>

      <h2>Importer des données</h2>

      <p>
        L’import s’effectue à partir d’un fichier CSV.
        Chaque ligne du fichier correspond à un élève.
      </p>

      <p>
        Les élèves sont identifiés par le triplet
        prénom + nom + classe.
        Un élève déjà présent est mis à jour,
        un élève absent est créé.
      </p>

      <input type="file" id="csvInput" accept=".csv">

      <div id="importStatus"></div>

      <h2>Exporter des données</h2>

      <p>
        L’export produit un fichier CSV contenant
        l’ensemble des données actuellement chargées
        dans l’application.
      </p>

      <button id="exportBtn">Exporter les données</button>

      <textarea id="exportOutput" rows="10" style="width:100%;"></textarea>

    </section>
  `;
}

export function bindImportExportEvents() {
  const input = document.getElementById("csvInput");
  const status = document.getElementById("importStatus");
  const exportBtn = document.getElementById("exportBtn");
  const output = document.getElementById("exportOutput");

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        importerCSV(reader.result);
        status.textContent = "Import réalisé avec succès.";
      } catch (e) {
        status.textContent = e.message;
      }
    };
    reader.readAsText(file);
  });

  exportBtn.addEventListener("click", () => {
    output.value = exporterCSV();
  });
}

// ===============================
// ACCÈS MÉTIER POUR LES AUTRES PAGES
// ===============================

export function getEleves() {
  return eleves;
}
