// =======================================================
// PAGE : Import / Export
// RÔLE MÉTIER : Source centrale des élèves importés (base de vérité en mémoire)
// LIT : CSV élèves (prenom, nom, classe, genre [+ adaptations optionnel])
// ÉCRIT : tableau eleves[] (en mémoire) + bulletinsHG[] (en mémoire)
// EXPOSE : getEleves(), getClasses(), getClassesAvecGroupes()
// HORS-PÉRIMÈTRE : places / groupes élèves / assiduité / participation / compétences
// =======================================================


// -------------------------------------------------------
// BLOC 1 — ÉTAT CENTRAL EN MÉMOIRE
// But : stocker les données importées (élevés + bulletins) tant que l’app tourne
// Entrées : importerElevesCSV()
// Sorties : getEleves() / getClasses() / getClassesAvecGroupes()
// -------------------------------------------------------

let eleves = [];        // Liste d'élèves importés (source centrale des pages)
let bulletinsHG = [];   // Préparation de bulletins (non exposé ici, mais alimenté)

let nextId = 1;         // Identifiant interne auto-incrémenté (session)


// -------------------------------------------------------
// BLOC 2 — OUTILS DE NORMALISATION
// But : garantir des valeurs propres et cohérentes après import
// -------------------------------------------------------

function normaliserGenre(valeur) {
  const v = valeur.toLowerCase();
  if (v.startsWith("f")) return "F";
  if (v.startsWith("m")) return "M";
  return "Autre";
}

function buildEleveKey(eleve) {
  // Clé stable (utile pour indexer bulletinsHG)
  return `${eleve.prenom}|${eleve.nom}|${eleve.classe}`;
}


// -------------------------------------------------------
// BLOC 3 — API MÉTIER PUBLIQUE (consommée par les autres pages)
// But : fournir les élèves + classes + classes avec groupes (pour EDT)
// -------------------------------------------------------

export function getEleves() {
  // Connexion attendue :
  // - ClassesHG lit les élèves et filtre par classe
  // - Salle lit les élèves et filtre par classe (puis place)
  return eleves;
}

export function getClasses() {
  // Connexion attendue :
  // - ClassesHG doit pouvoir créer des onglets de classe à partir de cette liste
  // - EDT doit proposer les classes
  return [...new Set(eleves.map(e => e.classe))].sort();
}

export function getClassesAvecGroupes() {
  // Connexion attendue :
  // - EDT propose toujours : classe entière + gr 1 + gr 2
  // Remarque : ce sont des variantes “structurelles” proposées par l’app,
  // pas une donnée importée.
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
// BLOC 4 — IMPORT CSV ÉLÈVES
// But : charger / mettre à jour la base eleves[] à partir d'un CSV
// Contrat CSV : prenom, nom, classe, genre obligatoires
// Option : adaptations (séparées par ";")
// -------------------------------------------------------

function importerElevesCSV(contenuCSV) {
  const lignes = contenuCSV.trim().split("\n");
  const entetes = lignes[0].split(/[;,]/).map(h => h.trim().toLowerCase());

  // Champs imposés par le métier Import
  const champsObligatoires = ["prenom", "nom", "classe", "genre"];
  champsObligatoires.forEach(champ => {
    if (!entetes.includes(champ)) {
      throw new Error(`Colonne obligatoire absente : ${champ}`);
    }
  });

  // Traitement ligne par ligne
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

    // Adaptations optionnelles (tableau)
    const adaptations = entetes.includes("adaptations")
      ? get("adaptations")
          .split(";")
          .map(a => a.trim())
          .filter(Boolean)
      : [];

    // Règle : si l'élève existe déjà (même prenom/nom/classe), on met à jour
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
      // Création d’un nouvel élève (ID stable dans la session)
      const nouvelEleve = {
        id: nextId++,
        prenom,
        nom,
        classe,
        genre,
        adaptations,
      };

      eleves.push(nouvelEleve);

      // Préparation d’une entrée bulletin HG (usage futur)
      bulletinsHG.push({
        eleveKey: buildEleveKey(nouvelEleve),
        periode: "T1",
        texte: "Bulletin HG non encore généré."
      });
    }
  });
}


// -------------------------------------------------------
// BLOC 5 — EXPORT CSV ÉLÈVES
// But : produire un CSV depuis la base eleves[]
// Remarque : actuellement export vers console (pas téléchargement)
// -------------------------------------------------------

function exporterElevesCSV() {
  let csv = "prenom,nom,classe,genre,adaptations\n";

  eleves.forEach(e => {
    csv += `"${e.prenom}","${e.nom}","${e.classe}","${e.genre}","${e.adaptations.join(";")}"\n`;
  });

  return csv;
}


// -------------------------------------------------------
// BLOC 6 — UI (Affichage de la page Import/Export)
// But : fournir le HTML de la page
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


// -------------------------------------------------------
// BLOC 7 — UI (Événements de page)
// But : brancher l’input CSV et le bouton export
// -------------------------------------------------------

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
