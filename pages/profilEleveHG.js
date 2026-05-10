/* ============================
   CONSTANTES MÉTIER HG
   ============================ */

const COMPETENCES_HG = [
  "Lecture document / consignes",
  "Rédaction / présentation",
  "Lecture image",
  "Analyse",
  "Culture générale",
  "Apprentissage des connaissances",
  "Langage cartographique",
  "Usages numériques",
];

const NIVEAUX = ["I", "F", "S", "TS"];

/* ============================
   ÉTAT MÉTIER MODALE
   ============================ */

let eleveActif = null;
let periodeActive = "T1";

/* ============================
   OUVERTURE MODALE
   ============================ */

export function ouvrirProfilEleveHG(eleve, periode) {
  eleveActif = eleve;
  periodeActive = periode;

  if (!eleveActif.hg) eleveActif.hg = {};
  if (!eleveActif.hg[periodeActive]) {
    eleveActif.hg[periodeActive] = {
      competences: {},
      participation: eleve.participation ?? "passif",
      adaptationsHG: [],
    };
  }

  document.body.insertAdjacentHTML(
    "beforeend",
    renderProfilEleveHG()
  );

  bindProfilEleveHGEvents();
}

/* ============================
   RENDU MODALE
   ============================ */

function renderProfilEleveHG() {
  const data = eleveActif.hg[periodeActive];

  return `
    <div class="modal-overlay" id="profilEleveHG">

      <div class="modal">

        <h2>${eleveActif.prenom} ${eleveActif.nom}</h2>

        <p>
          Classe : ${eleveActif.classe}<br>
          Groupe : ${eleveActif.groupe ?? "classe entière"}
        </p>

        <h3>Période : ${periodeActive}</h3>

        <h3>Compétences HG</h3>

        <table>
          ${COMPETENCES_HG.map(c => renderCompetence(c, data)).join("")}
        </table>

        <h3>Participation HG</h3>

        <div class="participation">
          ${NIVEAUX.map(n =>
            `<button
              data-participation="${n}"
              class="${data.participation === n ? "active" : ""}">
              ${n}
            </button>`
          ).join("")}
        </div>

        <h3>Adaptations HG</h3>

        <textarea id="adaptationsHG"
          placeholder="Adaptations spécifiques à l’HG">${data.adaptationsHG.join("; ")}</textarea>

        <div class="actions">
          <button id="fermerProfilHG">Fermer</button>
        </div>

      </div>
    </div>
  `;
}

function renderCompetence(libelle, data) {
  const valeur = data.competences[libelle] ?? "";

  return `
    <tr>
      <td>${libelle}</td>
      <td>
        ${NIVEAUX.map(n =>
          `<button
            data-competence="${libelle}"
            data-valeur="${n}"
            class="${valeur === n ? "active" : ""}">
            ${n}
          </button>`
        ).join("")}
      </td>
    </tr>
  `;
}

/* ============================
   ÉVÉNEMENTS MÉTIER
   ============================ */

function bindProfilEleveHGEvents() {
  const data = eleveActif.hg[periodeActive];

  // Compétences
  document.querySelectorAll("button[data-competence]").forEach(btn => {
    btn.addEventListener("click", () => {
      const comp = btn.dataset.competence;
      const val = btn.dataset.valeur;
      data.competences[comp] = val;
      refreshProfilEleveHG();
    });
  });

  // Participation
  document.querySelectorAll("button[data-participation]").forEach(btn => {
    btn.addEventListener("click", () => {
      data.participation = btn.dataset.participation;
      refreshProfilEleveHG();
    });
  });

  // Adaptations HG
  document
    .getElementById("adaptationsHG")
    .addEventListener("blur", e => {
      data.adaptationsHG = e.target.value
        .split(";")
        .map(a => a.trim())
        .filter(Boolean);
    });

  // Fermeture
  document
    .getElementById("fermerProfilHG")
    .addEventListener("click", fermerProfilEleveHG);
}

/* ============================
   RAFRAÎCHISSEMENT / FERMETURE
   ============================ */

function refreshProfilEleveHG() {
  fermerProfilEleveHG();
  ouvrirProfilEleveHG(eleveActif, periodeActive);
}

function fermerProfilEleveHG() {
  document.getElementById("profilEleveHG")?.remove();
}
