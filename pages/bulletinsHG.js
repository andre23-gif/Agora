// =======================================================
// PAGE BULLETINS HG — AGORAMOSAÏQUE
// Version MÉTIER FINALE
// Génération + édition + validation
// =======================================================

import { getEleves } from "./importExport.js";
import { genererBulletinHG } from "../logic/bulletinGeneratorHG.js";

// =======================================================
// OUTILS INTERNES
// =======================================================

function buildEleveKey(e) {
  return `${e.prenom}|${e.nom}|${e.classe}`;
}

// =======================================================
// CODES CONSTATS (issus de l’Excel)
// =======================================================

function buildConstatCode({
  posture,
  investissement,
  acquisition,
  comprehension
}) {
  return `${posture}_${investissement}_${acquisition}_${comprehension}`;
}

// =======================================================
// CODES CONSEIL (axes stratégiques)
// =======================================================

function detecterAxeConseil({
  posture,
  investissement,
  acquisition,
  methodes
}) {
  // Logique stratégique (non mécanique)
  if (posture === "perturbateur" || posture === "passif") {
    return "engagement";
  }

  if (methodes === "faibles") {
    return "methodes";
  }

  if (investissement === "rien" || investissement === "maison") {
    return "regularite";
  }

  return "reinvestissement";
}

// =======================================================
// RENDER UI
// =======================================================

export function renderBulletinsHG() {
  const eleves = getEleves();

  const optionsEleves = eleves.map(e =>
    `<option value="${buildEleveKey(e)}">
      ${e.prenom} ${e.nom} (${e.classe})
     </option>`
  ).join("");

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

      <!-- ========================= -->
      <!-- SUGGESTION AUTOMATIQUE     -->
      <!-- ========================= -->
      <div id="suggestionBloc" style="margin-top:1em; display:none;">
        <strong>Suggestion de conseil :</strong><br>
        <em id="suggestionTexte"></em>
      </div>

      <!-- ========================= -->
      <!-- TEXTE DU BULLETIN          -->
      <!-- ========================= -->
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

  // Données simulées (seront branchées plus tard sur Supabase)
  let profil = {
    posture: "passif",
    investissement: "maison",
    acquisition: "fragile",
    methodes: "faibles",
    comprehension: "docs",
    niveau: "F",
    evaluationsInsuffisantes: false
  };

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
    suggestionTexte.textContent =
      "Conseil proposé : axe « " + axe + " »";
  });

  document.getElementById("copyBtn").addEventListener("click", () => {
    navigator.clipboard.writeText(textarea.value);
