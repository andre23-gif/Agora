// =======================================================
// PAGE BULLETINS HG — AGORAMOSAÏQUE
// VERSION MÉTIER COMPLÈTE ET PROPRE
// Génération + édition + validation + export CSV
// =======================================================

import { getEleves } from "./importExport.js";
import { genererBulletinHG } from "../logic/bulletinGeneratorHG.js";

// =======================================================
// ÉTAT LOCAL (SANS SUPABASE POUR L’INSTANT)
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
// DÉTECTION DE L’AXE DE CONSEIL (STRATÉGIE VALIDÉE)
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

      <!-- Suggestion de conseil -->
      <div id="suggestionBloc" style="margin-top:1em; display:none;">
        <strong>Suggestion de conseil :</strong>
        <div id="suggestionTexte"></div>
      </div>

      <!-- Bulletin -->
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
// EVENTS + LOGIQUE MÉTIER
// =======================================================

export function bindBulletinsHGEvents() {
  const eleveSelect = document.getElementById("bulletinEleve");
  const periodeSelect = document.getElementById("bulletinPeriode");
  const textarea = document.getElementById("bulletinTexte");
  const status = document.getElementById("status");

  const suggestionBloc = document.getElementById("suggestionBloc");
  const suggestionTexte = document.getElementById("suggestionTexte");

  // ⚠️ Profil simulé pour l’instant
  // (sera branché sur Supabase plus tard)
  let profil = {
    posture: "passif",
    investissement: "maison",
    acquisition: "fragile",
    methodes: "faibles",
    comprehension: "docs",
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

  // Valider (mémoire locale)
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

  // Export CSV Pronote
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
