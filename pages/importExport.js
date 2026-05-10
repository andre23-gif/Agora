// =======================================================
// IMPORT / EXPORT — AGORAMOSAÏQUE
// Élèves + Bulletins HG + Supabase
// Périodes : T1 / T2 / T3
// =======================================================

// -------------------------------------------------------
// ÉTAT CENTRAL (source unique côté frontend)
// -------------------------------------------------------

let eleves = [];
let bulletinsHG = [];
// structure : { eleveKey, periode, texte }

// eleveKey = `${prenom}|${nom}|${classe}`

// -------------------------------------------------------
// OUTILS GÉNÉRAUX
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

// ✅ CONTRAT PUBLIC POUR LES AUTRES PAGES
export function getEleves() {
  return eleves;
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
        prenom,
        nom,
        classe,
        genre,
        adaptations,
      };

      eleves.push(nouvelEleve);

      // bulletin HG par défaut (en mémoire)
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
// BULLETINS HG — MÉMOIRE
// -------------------------------------------------------

function getBulletinHG(eleveKey, periode) {
  return bulletinsHG.find(
    b => b.eleveKey === eleveKey && b.periode === periode
  );
}

function copierBulletinHG(eleveKey, periode) {
  const bulletin = getBulletinHG(eleveKey, periode);
  if (!bulletin) {
    alert("Aucun bulletin trouvé.");
    return;
  }

  navigator.clipboard.writeText(bulletin.texte);
  alert("✅ Bulletin HG copié dans le presse‑papiers");
}

// -------------------------------------------------------
// EXPORT CSV — BULLETINS HG
// -------------------------------------------------------

function exporterBulletinsHGCSV() {
  let csv = "prenom,nom,classe,periode,bulletin_hg\n";

  bulletinsHG.forEach(b => {
    const [prenom, nom, classe] = b.eleveKey.split("|");

    csv += `"${prenom}","${nom}","${classe}","${b.periode}","${b.texte.replace(/"/g, '""')}"\n`;
  });

  return csv;
}

// -------------------------------------------------------
// SUPABASE — SAUVEGARDE BULLETIN HG
// (sb est défini globalement dans index.html)
// -------------------------------------------------------

async function saveBulletinHGToSupabase(eleveKey, periode) {
  if (typeof sb === "undefined") return;

  const bulletin = getBulletinHG(eleveKey, periode);
  if (!bulletin) return;

  const [prenom, nom, classe] = eleveKey.split("|");

  const { error } = await sb
    .from("bulletins_hg")
    .upsert({
      prenom,
      nom,
      classe,
      periode,
      texte: bulletin.texte
    });

  if (error) {
    console.error("Erreur Supabase :", error.message);
  }
}

// -------------------------------------------------------
// UI — PAGE IMPORT / EXPORT
// -------------------------------------------------------

export function renderImportExport() {
  return `
    <section>
      <h1>Import / Export</h1>

      <h2>Importer des élèves (CSV)</h2>
      <input type="file" id="csvInput" accept=".csv">
      <div id="importStatus"></div>

      <h2>Exporter</h2>

      <button id="exportElevesBtn">
        📄 Exporter les élèves (CSV)
      </button>

      <button id="copyBulletinBtn">
        📋 Copier le bulletin HG (1er élève, T1)
      </button>

      <button id="exportBulletinsBtn">
        📄 Exporter les bulletins HG (CSV)
      </button>

      <textarea id="exportOutput" rows="10" style="width:100%;"></textarea>
    </section>
  `;
}

export function bindImportExportEvents() {
  const input = document.getElementById("csvInput");
  const status = document.getElementById("importStatus");
  const output = document.getElementById("exportOutput");

  // Import CSV élèves
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        importerElevesCSV(reader.result);
        status.textContent = "✅ Élèves importés avec succès.";
      } catch (err) {
        status.textContent = "❌ Erreur : " + err.message;
      }
    };
    reader.readAsText(file);
  });

  // Export élèves
  document.getElementById("exportElevesBtn")
    .addEventListener("click", () => {
      output.value = exporterElevesCSV();
    });

  // Copier un bulletin HG (exemple simple)
  document.getElementById("copyBulletinBtn")
    .addEventListener("click", () => {
      if (bulletinsHG.length === 0) {
        alert("Aucun bulletin disponible.");
        return;
      }
      copierBulletinHG(bulletinsHG[0].eleveKey, "T1");
    });

  // Export bulletins HG
  document.getElementById("exportBulletinsBtn")
    .addEventListener("click", () => {
      output.value = exporterBulletinsHGCSV();
    });
}
