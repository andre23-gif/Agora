// =======================================================
// PAGE BULLETINS HG — AGORAMOSAÏQUE
// Version fonctionnelle SANS import externe
// Génération + édition + validation + export CSV
// =======================================================

import { getEleves } from "./importExport.js";

// =======================================================
// ÉTAT LOCAL
// =======================================================

// bulletins finalisés en mémoire
// structure : { eleveKey, periode, texte }
let bulletinsHG = [];

// année courante (déjà définie ailleurs dans l’app)
const ANNEE_COURANTE = window.appAnneeCourante || "2024-2025";

// =======================================================
// OUTILS INTERNES
// =======================================================

function buildEleveKey(e) {
  return `${e.prenom}|${e.nom}|${e.classe}`;
}

function getBulletin(eleveKey, periode) {
  return bulletinsHG.find(
    b => b.eleveKey === eleveKey && b.periode === periode
  );
}

// =======================================================
// GÉNÉRATEUR DE BULLETIN HG (INTÉGRÉ ICI)
// =======================================================

function genererBulletinHG({
  niveau,
  participation,
  evaluationsInsuffisantes,
  axeConseil
}) {
  // ---- Niveau
  let texte = "";

  if (niveau === "TB") {
    texte +=
      "Le niveau des acquisitions est très satisfaisant au regard des attentes. ";
  } else if (niveau === "S") {
    texte +=
      "Le niveau des acquisitions est satisfaisant au regard des attentes. ";
  } else if (niveau === "F") {
    texte +=
      "Le niveau des acquisitions reste fragile et doit être consolidé. ";
  } else {
    texte +=
      "Le niveau des acquisitions est insuffisant et nécessite un travail plus régulier. ";
  }

  // ---- Participation / posture
  if (participation === "moteur") {
    texte +=
      "L’élève participe activement et s’implique avec sérieux dans le travail proposé. ";
  } else if (participation === "passif") {
    texte +=
      "L’élève reste trop souvent en retrait et doit s’impliquer davantage. ";
  } else if (participation === "perturbateur") {
    texte +=
      "Le comportement en classe nuit à la qualité du travail et doit être corrigé. ";
  }

  // ---- Évaluations
  if (evaluationsInsuffisantes) {
    texte +=
      "Les résultats aux évaluations sont insuffisants au regard des attendus. ";
  }

  // ---- Conseil (axe unique)
  if (axeConseil === "engagement") {
    texte +=
      "Un investissement plus régulier est indispensable pour progresser. ";
  } else if (axeConseil === "methodes") {
    texte +=
      "La maîtrise des méthodes doit être renforcée afin de mieux exploiter les connaissances acquises. ";
  } else if (axeConseil === "regularite") {
    texte +=
      "Un travail plus constant permettrait de consolider les acquis. ";
  } else if (axeConseil === "reinvestissement") {
    texte +=
      "Les connaissances doivent être davantage réinvesties dans les exercices et les analyses. ";
  }

  return texte.trim();
}

// =======================================================
// STRATÉGIE DE CONSEIL (AXE)
// =======================================================

function detecterAxeConseil(profil) {
  if (profil.posture === "perturbateur" || profil.posture === "passif") {
    return "engagement";
  }

  if (profil.methodes === "faibles") {
    return "methodes";
  }

  if (profil.investissement === "rien" || profil.investissement === "maison") {
    return "regularite";
  }

  return "reinvestissement";
}

// =======================================================
// RENDER UI
// =======================================================

export function renderBulletinsHG() {
  const eleves = getEleves();

  const optionsEleves = eleves
    .map(
      e => `<option value="${buildEleveKey(e)}">
        ${e.prenom} ${e.nom} (${e.classe})
      </option>`
    )
    .join("");

  return `
    <section>
      <h1>Bulletins HG</h1>

      <label>
        Élève :
        <select id="bulletinEleve">
          <option value="">— choisir —</option>
          ${optionsEleves}
        </select>
      </label>

      <label>
        Période :
        <select id="bulletinPeriode">
          <option value="T1">T1</option>
          <option value="T2">T2</option>
          <option value="T3">T3</option>
        </select>
      </label>

      <div id="suggestionBloc" style="margin-top:1em; display:none;">
        <strong>Suggestion de conseil :</strong>
        <div id="suggestionTexte"></div>
      </div>

      <textarea
        id="bulletinTexte"
        rows="10"
        style="width:100%; margin-top:1em;"
        placeholder="Bulletin HG…"
      ></textarea>

      <div style="margin-top:1em;">
        <button id="generateBtn">🪄 Générer</button>
        <button id="copyBtn">📋 Copier</button>
        <button id="validateBtn">✅ Valider</button>
        <button id="exportCsvBtn">📄 Export CSV (Pronote)</button>
      </div>

      <div id="status" style="margin-top:0.5em;"></div>
    </section>
  `;
}

// =======================================================
// EVENTS
// =======================================================

export function bindBulletinsHGEvents() {
  const eleveSelect = document.getElementById("bulletinEleve");
  const periodeSelect = document.getElementById("bulletinPeriode");
  const textarea = document.getElementById("bulletinTexte");
  const status = document.getElementById("status");

  const suggestionBloc = document.getElementById("suggestionBloc");
  const suggestionTexte = document.getElementById("suggestionTexte");

  // Profil simulé (temporaire mais NON bloquant)
  let profil = {
    posture: "passif",
    investissement: "maison",
    methodes: "faibles",
    niveau: "F",
    evaluationsInsuffisantes: false
  };

  // Génération
  document.getElementById("generateBtn").addEventListener("click", () => {
    if (!eleveSelect.value) {
      alert("Choisis un élève.");
      return;
    }

    const axe = detecterAxeConseil(profil);

    const texte = genererBulletinHG({
      niveau: profil.niveau,
      participation: profil.posture,
      evaluationsInsuffisantes: profil.evaluationsInsuffisantes,
      axeConseil: axe
    });

    textarea.value = texte;
    suggestionBloc.style.display = "block";
    suggestionTexte.textContent = `Axe proposé : ${axe}`;
  });

  // Copier
  document.getElementById("copyBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(textarea.value);
    alert("✅ Bulletin copié");
  });

  // Valider
  document.getElementById("validateBtn").addEventListener("click", () => {
    const eleveKey = eleveSelect.value;
    const periode = periodeSelect.value;

    if (!eleveKey || !periode) {
      alert("Élève et période requis.");
      return;
    }

    let bulletin = getBulletin(eleveKey, periode);

    if (!bulletin) {
      bulletin = { eleveKey, periode, texte: textarea.value };
      bulletinsHG.push(bulletin);
    } else {
      bulletin.texte = textarea.value;
    }

    status.textContent = "✅ Bulletin validé";
  });

  // Export CSV
  document.getElementById("exportCsvBtn").addEventListener("click", () => {
    const periode = periodeSelect.value;

    const lignes = bulletinsHG.filter(
      b => b.periode === periode && b.texte.trim() !== ""
    );

    if (lignes.length === 0) {
      alert("Aucun bulletin validé pour cette période.");
      return;
    }

    let csv = "annee;periode;classe;prenom;nom;bulletin_hg\n";

    lignes.forEach(b => {
      const [prenom, nom, classe] = b.eleveKey.split("|");
      const texte = `"${b.texte.replace(/"/g, '""')}"`;
      csv += `${ANNEE_COURANTE};${periode};${classe};${prenom};${nom};${texte}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `bulletins_HG_${ANNEE_COURANTE}_${periode}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  });
}
