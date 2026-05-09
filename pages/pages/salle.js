const SALLE = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  numero: i + 1,
  couleur: ["bleu", "vert", "jaune", "orange", "violet", "gris"][i % 6],
}));

let eleves = [
  {
    id: 1,
    prenom: "Emma",
    adaptations: ["PAP"],
    place: 1,
    suivi: {
      absence: false,
      retard: false,
      devoir: false,
      observation: "",
    },
    participation: "passif",
  },
  {
    id: 2,
    prenom: "Lucas",
    adaptations: [],
    place: 2,
    suivi: {
      absence: false,
      retard: false,
      devoir: false,
      observation: "",
    },
    participation: "passif",
  },
];

export function renderSalle() {
  return `
    <section>
      <h1>Vue de la classe</h1>

      <div class="salle">
        ${SALLE.map(renderTable).join("")}
      </div>

      <div id="modal"></div>

      <button id="finHeure">Fin d’heure</button>
    </section>
  `;
}

function renderTable(table) {
  const eleve = eleves.find(e => e.place === table.id);

  return `
    <div class="table ${table.couleur}" data-id="${table.id}">
      <strong>${table.numero}</strong>
      ${eleve ? `<div>${eleve.prenom}</div>` : ""}
      ${eleve && eleve.adaptations.length
        ? `<div class="badge">${eleve.adaptations.join(", ")}</div>`
        : ""}
    </div>
  `;
}

export function bindSalleEvents() {
  document.querySelectorAll(".table").forEach(el => {
    el.addEventListener("click", () => {
      const place = Number(el.dataset.id);
      const eleve = eleves.find(e => e.place === place);
      if (eleve) ouvrirFicheEleve(eleve);
    });
  });

  document.getElementById("finHeure")
    .addEventListener("click", ouvrirParticipation);
}

function ouvrirFicheEleve(eleve) {
  document.getElementById("modal").innerHTML = `
    <h2>${eleve.prenom}</h2>

    <label><input type="checkbox" ${eleve.suivi.absence ? "checked" : ""}> Absence</label>
    <label><input type="checkbox" ${eleve.suivi.retard ? "checked" : ""}> Retard</label>
    <label><input type="checkbox" ${eleve.suivi.devoir ? "checked" : ""}> Devoir non fait</label>

    <textarea placeholder="Observation">${eleve.suivi.observation}</textarea>
  `;
}

function ouvrirParticipation() {
  document.getElementById("modal").innerHTML = `
    <h2>Participation</h2>
    ${eleves.map(e =>
      `<div>
        ${e.prenom}
        ${["I","F","S","TS"].map(v =>
          `<button data-id="${e.id}" data-val="${v}">${v}</button>`
        ).join("")}
      </div>`
    ).join("")}
  `;

  document.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const eleve = eleves.find(e => e.id === Number(btn.dataset.id));
      eleve.participation = btn.dataset.val;
    });
  });
}
