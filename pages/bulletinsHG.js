// =======================================================
// PAGE BULLETINS HG — AGORAMOSAÏQUE
// Sélection élève + période + suggestion + validation
// =======================================================

import { getEleves, getBulletinsHG } from "./importExport.js";

// -------------------------------------------------------
// OUTILS
// -------------------------------------------------------

function buildEleveKey(e) {
  return `${e.prenom}|${e.nom}|${e.classe}`;
}

function findBulletin(eleveKey, periode) {
  return getBulletinsHG().find(
    b => b.eleveKey === eleveKey && b.periode === periode
  );
}

// -------------------------------------------------------
// SUGGESTION AUTOMATIQUE
// (logique simple, améliorable plus tard)
// -------------------------------------------------------

function detecterEvaluationsInsuffisantes(eleveKey, periode) {
  // ⚠️ Pour l’instant :
  // on suggère si le bulletin est encore vide ou générique
  const bulletin = findBulletin(eleveKey, periode);
  if (!bulletin) return false;

  return bulletin.texte.includes("non encore généré");
}

// -------------------------------------------------------
// UI — RENDER
// -------------------------------------------------------

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

      <!-- Suggestion automatique -->
      <div id="suggestionBloc" style="margin-top:1em; display:none;">
        <strong>⚠️ Suggestion automatique :</strong><br>
        <label>
          <input type="checkbox" id="evalInsuffisantesChk">
          Nombre d’évaluations insuffisant pour apprécier pleinement les acquis
        </label>
      </div>

      <textarea
        id="bulletinTexte"
        rows="10"
        style="width:100%; margin-top:1em;"
        placeholder="Texte du bulletin HG…"
      ></textarea>

      <div style="margin-top:1em;">
        <button id="copyBulletinBtn">
          📋 Copier le bulletin
        </button>

        <button id="validateBulletinBtn">
          ✅ Valider le bulletin
        </button>
      </div>

      <div id="bulletinStatus" style="margin-top:0.5em;"></div>

    </section>
  `;
}

// -------------------------------------------------------
// UI — EVENTS
// -------------------------------------------------------

export function bindBulletinsHGEvents() {
  const eleveSelect = document.getElementById("bulletinEleve");
  const periodeSelect = document.getElementById("bulletinPeriode");
  const textarea = document.getElementById("bulletinTexte");
  const status = document.getElementById("bulletinStatus");

  const suggestionBloc = document.getElementById("suggestionBloc");
  const evalChk = document.getElementById("evalInsuffisantesChk");

  function chargerBulletin() {
    const eleveKey = eleveSelect.value;
    const periode = periodeSelect.value;

    textarea.value = "";
    suggestionBloc.style.display = "none";
    evalChk.checked = false;

    if (!eleveKey) return;

    const bulletin = findBulletin(eleveKey, periode);
    if (bulletin) {
      textarea.value = bulletin.texte;
    }

    // Détection suggestion
    if (detecterEvaluationsInsuffisantes(eleveKey, periode)) {
      suggestionBloc.style.display = "block";
    }
  }

  eleveSelect.addEventListener("change", chargerBulletin);
  periodeSelect.addEventListener("change", chargerBulletin);

  // Copier bulletin
  document
    .getElementById("copyBulletinBtn")
    .addEventListener("click", () => {
      navigator.clipboard.writeText(textarea.value);
      alert("✅ Bulletin copié dans le presse‑papiers");
    });

  // Valider bulletin
  document
    .getElementById("validateBulletinBtn")
    .addEventListener("click", async () => {
      const eleveKey = eleveSelect.value;
      const periode = periodeSelect.value;

      if (!eleveKey) {
        alert("Choisis un élève.");
        return;
      }

      let texteFinal = textarea.value;

      // Injection manuelle de la suggestion si cochée
      if (evalChk.checked) {
        const phrase =
          "Le nombre d’évaluations est insuffisant pour apprécier pleinement les acquis. ";

        if (!texteFinal.includes(phrase)) {
          texteFinal = phrase + texteFinal;
        }
      }

      let bulletin = findBulletin(eleveKey, periode);

      if (!bulletin) {
        bulletin = {
          eleveKey,
          periode,
          texte: texteFinal
        };
        getBulletinsHG().push(bulletin);
      } else {
        bulletin.texte = texteFinal;
      }

      // Sauvegarde Supabase
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
        status.textContent = "❌ Erreur lors de l’enregistrement";
        console.error(error.message);
      } else {
        status.textContent = "✅ Bulletin validé et enregistré";
      }
    });
}
``
