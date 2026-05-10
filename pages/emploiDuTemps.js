/* ============================
   CRÉNEAUX OFFICIELS COLLÈGE
   ============================ */

export const CRENEAUX = [
  { code: "M1", debut: "08:30", fin: "09:25" },
  { code: "M2", debut: "09:25", fin: "10:20" },
  { code: "M3", debut: "10:35", fin: "11:30" },
  { code: "M4", debut: "11:30", fin: "12:30" },
  { code: "PM", debut: "12:30", fin: "13:55" },
  { code: "S1", debut: "13:55", fin: "14:55" },
  { code: "S2", debut: "14:55", fin: "15:50" },
  { code: "S3", debut: "16:05", fin: "17:05" },
  { code: "S4", debut: "17:05", fin: "18:00" },
];

/* ============================
   EMPLOI DU TEMPS (ANNÉE ACTIVE)
   ============================ */

let edt = [
  {
    jour: "lundi",
    creneau: "M2",
    classe: "6°1",
    groupe: null,
    semaine: "A",
  },
  {
    jour: "lundi",
    creneau: "S1",
    classe: "6°1",
    groupe: "gr 1",
    semaine: "A",
  },
  {
    jour: "lundi",
    creneau: "S1",
    classe: "6°1",
    groupe: "gr 2",
    semaine: "B",
  },
];

/* ============================
   MÉTIER : CONTEXTE COURANT
   ============================ */

export function getContexteCourant(date = new Date(), semaine) {
  const jour = getJour(date);
  const heure = date.toTimeString().slice(0, 5);

  const creneau = CRENEAUX.find(
    c => c.debut <= heure && heure < c.fin
  )?.code;

  if (!creneau || creneau === "PM") return null;

  return edt.find(
    l =>
      l.jour === jour &&
      l.creneau === creneau &&
      (l.semaine === semaine || l.semaine === "toutes")
  ) ?? null;
}

function getJour(date) {
  return [
    "dimanche",
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
  ][date.getDay()];
}

/* ============================
   UI : EMPLOI DU TEMPS
   ============================ */

export function renderEmploiDuTemps() {
  return `
    <section>

      <h1>Emploi du temps</h1>

      <p>
        Cet écran permet d’associer un créneau horaire,
        une classe et éventuellement un groupe.
      </p>

      <table border="1" cellpadding="6">
        <thead>
          <tr>
            <th>Jour</th>
            <th>Créneau</th>
            <th>Classe</th>
            <th>Groupe</th>
            <th>Semaine</th>
          </tr>
        </thead>
        <tbody>
          ${edt.map(renderLigneEDT).join("")}
        </tbody>
      </table>

    </section>
  `;
}

function renderLigneEDT(ligne) {
  return `
    <tr>
      <td>${ligne.jour}</td>
      <td>${ligne.creneau}</td>
      <td>${ligne.classe}</td>
      <td>${ligne.groupe ?? "classe entière"}</td>
      <td>${ligne.semaine}</td>
    </tr>
  `;
}

/* ============================
   ACCÈS MÉTIER
   ============================ */

export function getEDT() {
  return edt;
}

export function setEDT(nouvelEDT) {
  edt = nouvelEDT;
}
