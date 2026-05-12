import { getEleves } from "./importExport.js";

/* ============================
   CONFIGURATION SALLE
   ============================ */

/*
  Plan de salle :
  - 3 colonnes
  - 5 rangées
  - 2 places par rangée
  - numérotation globale
*/

const PLAN_SALLE = {
  gauche:  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  centre:  [11,12,13,14,15,16,17,18,19,20],
  droite:  [21,22,23,24,25,26,27,28,29,30],
};

/*
  Couleurs par colonne / plage
*/
function getCouleur(place) {
  if (place <= 10) {
    if (place <= 5) return "vert";
    return "violet";
  }
  if (place <= 20) {
    if (place <= 15) return "jaune";
    return "bleu";
  }
  if (place <= 25) return "rouge";
  return "noir";
}

/*
  Couleur adaptation (1 seule par élève)
*/
function getCouleurAdaptation(adaptation) {
  switch (adaptation) {
    case "PPS": return "rouge";
    case "PAP": return "jaune";
    case "PPRE": return "bleu";
    case "Adaptations": return "vert-fonce";
    case "Adaptations partielles": return "vert-clair";
    default: return null;
  }
}

/* ============================
   ÉTAT MÉTIER
   ============================ */

let elevesSalle = [];

/* ============================
   INITIALISATION
   ============================ */

export function initSalle(classe) {
  elevesSalle = getEleves()
    .filter(e => e.classe === classe)
    .map(e => ({
      ...e,
      place: e.place ?? null,
      adaptations: e.adaptations ?? [],
    }));
}

/* ============================
   RENDU PRINCIPAL
   ============================ */

export function renderSalle() {
  return `
    <div class="salle-plein-ecran">

      ${renderColonne("gauche")}
      <div class="allee"></div>
      ${renderColonne("centre")}
      <div class="allee"></div>
      ${renderColonne("droite")}

      <div id="modal"></div>
    </div>
  `;
}

/* ============================
   RENDU COLONNE
   ============================ */

function renderColonne(nom) {
  const places = PLAN_SALLE[nom];

  // découpe par paires (rangées)
  const rangees = [];
  for (let i = 0; i < places.length; i += 2) {
    rangees.push([places[i], places[i + 1]]);
  }

  return `
    <div class="colonne ${nom}">
      ${rangees.map(renderRangee).join("")}
    </div>
  `;
}

/* ============================
   RENDU RANGÉE
   ============================ */

function renderRangee([p1, p2]) {
  return `
    <div class="rangee">
      ${renderTable(p1)}
      ${renderTable(p2)}
    </div>
  `;
}

/* ============================
   RENDU TABLE
   ============================ */

function renderTable(place) {
  const eleve = elevesSalle.find(e => e.place === place);
  const couleur = getCouleur(place);

  let adaptationHtml = "";
  if (eleve && eleve.adaptations.length === 1) {
    const couleurAdapt = getCouleurAdaptation(eleve.adaptations[0]);
    if (couleurAdapt) {
      adaptationHtml = `<span class="adaptation ${couleurAdapt}"></span>`;
    }
  }

  return `
    <div class="table ${couleur}" data-place="${place}">
      <span class="numero">${place}</span>

      ${eleve ? `<div class="prenom">${eleve.prenom}</div>` : ""}

      ${adaptationHtml}
    </div>
  `;
}

/* ============================
   ÉVÉNEMENTS
   ============================ */

export function bindSalleEvents() {
  document.querySelectorAll(".table").forEach(el => {
    el.addEventListener("click", () => {
      const place = Number(el.dataset.place);
      const eleve = elevesSalle.find(e => e.place === place);
      if (eleve) ouvrirFicheEleve(eleve);
    });
  });
}

/* ============================
   FICHE ÉLÈVE (MODALE)
   ============================ */

function ouvrirFicheEleve(eleve) {
  document.getElementById("modal").innerHTML = `
    <div class="fiche-eleve">
      <h2>${eleve.prenom} ${eleve.nom}</h2>

      <label>
        <input type="checkbox" ${eleve.suivi?.absence ? "checked" : ""}>
        Absence
      </label>

      <label>
        <input type="checkbox" ${eleve.suivi?.retard ? "checked" : ""}>
        Retard
      </label>

      <label>
        <input type="checkbox" ${eleve.suivi?.devoir ? "checked" : ""}>
        Devoir non fait
      </label>

      <label>
        <input type="checkbox" ${eleve.suivi?.absentControle ? "checked" : ""}>
        Absent au contrôle
      </label>

      <textarea>${eleve.suivi?.observation ?? ""}</textarea>

      <button id="closeFiche">Fermer</button>
    </div>
  `;

  document.getElementById("closeFiche").onclick = () => {
    document.getElementById("modal").innerHTML = "";
  };
}
