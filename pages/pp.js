// =======================================================
// PAGE PROF PRINCIPAL (PP) — AGORAMOSAÏQUE
// Suivi global élève (hors HG)
// Import CSV DNB blanc + oral de stage
// Version STABLE SANS SUPABASE
// =======================================================

import { getEleves } from "./importExport.js";

// =======================================================
// ÉTAT PP LOCAL
// =======================================================

/*
Structure par élève (clé = prenom|nom|classe)

{
  absences,
  retards,
  observations,
  punitions,
  sanctions,
  orientation: { voie1, voie2, miniStages },
  stage: { statut, convention, livret, noteOral },
  examens: {
    dnb: { francais, maths, hg, sciences, oral },
    pix, assr2, evalang
  },
  niveaux: { sciences, litteraires, langues, arts, eps }
}
*/

const ppData = {};

// =======================================================
// OUTILS
// =======================================================

function buildEleveKey(e) {
  return `${e.prenom}|${e.nom}|${e.classe}`;
}

function ensurePPData(eleveKey) {
  if (!ppData[eleveKey]) {
    ppData[eleveKey] = {
      absences: 0,
      retards: 0,
      observations: 0,
      punitions: 0,
      sanctions: 0,
      orientation: {},
      stage: {},
      examens: { dnb: {} },
      niveaux: {}
    };
  }
  return ppData[eleveKey];
}

function parseCSV(content) {
  const lines = content.trim().split("\n");
  const headers = lines[0].split(";").map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const values = line.split(";");
    const obj = {};
    headers.forEach((h, i) => (obj[h] = values[i]?.trim() ?? ""));
    return obj;
  });
}

// =======================================================
// RENDER PAGE PP
// =======================================================

export function renderPP() {
  const eleves = getEleves();

  const rows = eleves.map(e => `
    <tr>
      <td>${e.prenom}</td>
      <td>${e.nom}</td>
      <td>${e.classe}</td>
      <td><button data-eleve="${buildEleveKey(e)}">Ouvrir suivi PP</button></td>
    </tr>
  `).join("");

  return `
    <section>
      <h1>Prof Principal — Suivi élèves</h1>

      <table border="1" cellpadding="4">
        <thead>
          <tr>
            <th>Prénom</th>
            <th>Nom</th>
            <th>Classe</th>
            <th>Suivi PP</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <!-- MODALE PP -->
      <div id="ppModal" style="display:none; border:1px solid #000; padding:1em; margin-top:1em;">
        <h2 id="ppTitle"></h2>

        <h3>Assiduité</h3>
        Absences : <input type="number" id="absences"><br>
        Retards : <input type="number" id="retards"><br>

        <h3>Comportement</h3>
        Observations : <input type="number" id="observations"><br>
        Punitions : <input type="number" id="punitions"><br>
        Sanctions : <input type="number" id="sanctions"><br>

        <h3>Examens — DNB blanc</h3>
        <input type="file" id="importDNB" accept=".csv"><br>

        <h3>Stage — Oral</h3>
        <input type="file" id="importStage" accept=".csv"><br>

        <button id="closePP">Fermer</button>
      </div>
    </section>
  `;
}

// =======================================================
// EVENTS
// =======================================================

export function bindPPEvents() {
  const modal = document.getElementById("ppModal");
  const title = document.getElementById("ppTitle");

  document.querySelectorAll("button[data-eleve]").forEach(btn => {
    btn.addEventListener("click", () => {
      const eleveKey = btn.dataset.eleve;
      const data = ensurePPData(eleveKey);

      title.textContent = `Suivi PP — ${eleveKey.replaceAll("|", " ")}`;

      document.getElementById("absences").value = data.absences;
      document.getElementById("retards").value = data.retards;
      document.getElementById("observations").value = data.observations;
      document.getElementById("punitions").value = data.punitions;
      document.getElementById("sanctions").value = data.sanctions;

      modal.style.display = "block";

      // IMPORT DNB BLANC
      document.getElementById("importDNB").onchange = e => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
          const rows = parseCSV(reader.result);
          let count = 0;

          rows.forEach(r => {
            const key = `${r.prenom}|${r.nom}|${r.classe}`;
            if (ppData[key]) {
              ppData[key].examens.dnb = {
                francais: r.francais,
                maths: r.maths,
                hg: r.hg,
                sciences: r.sciences,
                oral: r.oral
              };
              count++;
            }
          });

          alert(`${count} élèves mis à jour (DNB blanc).`);
        };
        reader.readAsText(file);
      };

      // IMPORT ORAL DE STAGE
      document.getElementById("importStage").onchange = e => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
          const rows = parseCSV(reader.result);
          let count = 0;

          rows.forEach(r => {
            const key = `${r.prenom}|${r.nom}|${r.classe}`;
            if (ppData[key]) {
              ppData[key].stage.noteOral = r.note_oral;
              count++;
            }
          });

          alert(`${count} élèves mis à jour (oral de stage).`);
        };
        reader.readAsText(file);
      };
    });
  });

  document.getElementById("closePP").addEventListener("click", () => {
    document.getElementById("ppModal").style.display = "none";
  });
}
