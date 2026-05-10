import { getEleves } from "./importExport.js";

/* ============================
   ÉTAT MÉTIER CLASSES HG
   ============================ */

let classeActive = null;
let elevesClasse = [];

/* ============================
   INITIALISATION
   ============================ */

export function initClassesHG(nomClasse) {
  classeActive = nomClasse;
  elevesClasse = getEleves().filter(e => e.classe === nomClasse);
}

/* ============================
   RENDU PRINCIPAL
   ============================ */

export function renderClassesHG() {
  if (!classeActive) {
    return `<p>Aucune classe sélectionnée.</p>`;
  }

  return `
    <section>

      <h1>Classe ${classeActive}</h1>

      <div class="liste-eleves">
        ${elevesClasse.map(renderEleve).join("")}
      </div>

      <h2>Plan de salle – attribution des places</h2>

      <div class="plan-salle">
        ${Array.from({ length: 30 }, (_, i) =>
          renderPlace(i + 1)
        ).join("")}
      </div>

    </section>
  `;
}

/* ============================
   RENDU ÉLÈVE
   ============================ */

function renderEleve(eleve) {
  return `
    <div class="eleve"
         draggable="true"
         data-id="${eleve.id}"
         ondragstart="onDragStart(event)">
      <strong>${eleve.prenom} ${eleve.nom}</strong><br>
      Genre : ${eleve.genre}<br>
      Groupe : ${eleve.groupe ?? "classe entière"}<br>
      Aides : ${eleve.adaptations.join(", ") || "—"}<br>
      Place : ${eleve.place ?? "non attribuée"}
    </div>
  `;
}

/* ============================
   RENDU PLACE
   ============================ */

function renderPlace(numero) {
  const eleve = elevesClasse.find(e => e.place === numero);

  return `
    <div class="place"
         data-place="${numero}"
         ondragover="onDragOver(event)"
         ondrop="onDrop(event)">
      <strong>Table ${numero}</strong>
      ${eleve ? `<div>${eleve.prenom}</div>` : ""}
    </div>
  `;
}

/* ============================
   DRAG & DROP (MÉTIER)
   ============================ */

window.onDragStart = function (event) {
  event.dataTransfer.setData("eleveId", event.target.dataset.id);
};

window.onDragOver = function (event) {
  event.preventDefault();
};

window.onDrop = function (event) {
  event.preventDefault();

  const eleveId = Number(event.dataTransfer.getData("eleveId"));
  const place = Number(event.currentTarget.dataset.place);

  const eleve = elevesClasse.find(e => e.id === eleveId);
  if (!eleve) return;

  // Une seule place par élève
  elevesClasse.forEach(e => {
    if (e.place === place) e.place = null;
  });

  eleve.place = place;

  // Re-rendu immédiat
  document.getElementById("app").innerHTML = renderClassesHG();
};

/* ============================
   ACCÈS MÉTIER
   ============================ */

export function getElevesClasseHG() {
  return elevesClasse;
}
