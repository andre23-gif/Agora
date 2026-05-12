import { getClassesAvecGroupes } from "./importExport.js";

/* =======================================================
   PAGE : Emploi du Temps (EDT)
   RÔLE MÉTIER :
     - Calendrier scolaire basé sur les semaines ISO (numérotées depuis janvier)
     - Ordre scolaire : S35 (année N) -> ... -> S34 (année N+1)
       Exemple : 2025-2026 commence en S35 2025 (lundi 25/08/2025). [3](https://beforesandafters.com/2021/10/11/how-the-visual-effects-team-on-apple-tvs-foundation-kept-things-grounded/)[2](https://gradientshub.com/blog/6-animated-gradient-backgrounds-with-code-examples/)
     - 3 zones :
       (1) Bandeau : navigation + options (A/B/V, T1/T2/T3, S1/S2) + changement d'année scolaire
       (2) Panneau gauche : semaines (lundi) + cases à cocher pour "Valider"
       (3) Panneau droit : grille (Lun->Ven, M1..M4, PM, S1..S4) éditable par cellule
     - "Valider" applique le modèle edtModele aux semaines cochées (clone + contexte)
   LIT :
     - Import/Export : getClassesAvecGroupes() pour choisir classe/groupe par cellule
     - window.appAnneeCourante : "YYYY-YYYY" (ex "2025-2026")
     - Date courante :
         * si window.APP_SERVER_DATE_ISO = "YYYY-MM-DD" (date serveur/internet), on l'utilise
         * sinon new Date() (date du device)
   ÉCRIT :
     - edtModele[] : modèle de grille
     - edtParSemaine{} : EDT enregistré par semaine (clé = isoLundi)
   HORS-PÉRIMÈTRE :
     - Vacances détaillées (mais le type A/B/V est géré comme attribut de semaine)
     - Salle / assiduité / participation
   ======================================================= */


/* ======================================================
   BLOC 1 — CONSTANTES (créneaux + jours)
   ====================================================== */

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

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];


/* ======================================================
   BLOC 2 — ÉTAT LOCAL
   ====================================================== */

let edtModele = [];              // [{ jour, creneau, classe, groupe }]
let edtParSemaine = {};          // { isoLundi: [{...},{...}] }

let semaines = [];               // [{ isoLundi, lundi:Date, weekNo, weekYear }]
let semaineRefIndex = 0;         // index semaine "référence" (celle affichée à droite)
let semainesCibles = new Set();  // semaines cochées (isoLundi)

let contexte = {
  type: "A",         // A / B / V
  trimestre: "T1",   // T1 / T2 / T3
  semestre: "S1"     // S1 / S2
};


/* ======================================================
   BLOC 3 — OUTILS DATE (ISO week)
   ISO 8601 : semaines numérotées 1..52/53, semaine commence lundi,
   week 1 = semaine du premier jeudi (ou contenant le 4 janvier). [2](https://gradientshub.com/blog/6-animated-gradient-backgrounds-with-code-examples/)[4](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos)
   Implémentation standard JavaScript (shift vers jeudi). [1](https://home.microsoftpersonalcontent.com/:fl:/r/contentstorage/x8FNO-xtskuCRX2_fMTHLQ53EDF03465DDCC82/Document%20Library/Copilot/README%20%E2%80%94%20AgoraMosa%C3%AFque%20v1.0.page?d=w0ddd53cbeb094021a397dbdf84fdd483&csf=1&web=1&nav=cz0lMkZjb250ZW50c3RvcmFnZSUyRng4Rk5PLXh0c2t1Q1JYMl9mTVRITFE1M0VERjAzNDY1RERDQzgyJmQ9YiFRMEZ6STJ1ZVBFeTlwcW01amJxSlE3Rm1rbnpFeV9CS250dWJubTRUVzcwelBBOVZqWXBJUzRKclZhNDN2dGRXJmY9MDFJRVVGQ0NPTEtQT1EyQ1BMRUZBS0hGNjMzNkNQM1ZFRCZjPSUyRiZmbHVpZD0xJnA9JTQwZmx1aWR4JTJGbG9vcC1wYWdlLWNvbnRhaW5lcg%3D%3D)[2](https://gradientshub.com/blog/6-animated-gradient-backgrounds-with-code-examples/)
   ====================================================== */

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function formatFR(d) {
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
}

function mondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7; // dimanche=7
  if (day !== 1) d.setDate(d.getDate() - day + 1);
  d.setHours(0,0,0,0);
  return d;
}

function getNowDate() {
  // Date “internet” si fournie par ton système (ex: Supabase), sinon date device
  if (window.APP_SERVER_DATE_ISO) {
    const [y, m, dd] = window.APP_SERVER_DATE_ISO.split("-").map(Number);
    return new Date(y, m - 1, dd);
  }
  return new Date();
}

/**
 * Renvoie { weekYear, weekNo } ISO pour une date.
 * Règle : le jeudi décide l’année de semaine. [2](https://gradientshub.com/blog/6-animated-gradient-backgrounds-with-code-examples/)[1](https://home.microsoftpersonalcontent.com/:fl:/r/contentstorage/x8FNO-xtskuCRX2_fMTHLQ53EDF03465DDCC82/Document%20Library/Copilot/README%20%E2%80%94%20AgoraMosa%C3%AFque%20v1.0.page?d=w0ddd53cbeb094021a397dbdf84fdd483&csf=1&web=1&nav=cz0lMkZjb250ZW50c3RvcmFnZSUyRng4Rk5PLXh0c2t1Q1JYMl9mTVRITFE1M0VERjAzNDY1RERDQzgyJmQ9YiFRMEZ6STJ1ZVBFeTlwcW01amJxSlE3Rm1rbnpFeV9CS250dWJubTRUVzcwelBBOVZqWXBJUzRKclZhNDN2dGRXJmY9MDFJRVVGQ0NPTEtQT1EyQ1BMRUZBS0hGNjMzNkNQM1ZFRCZjPSUyRiZmbHVpZD0xJnA9JTQwZmx1aWR4JTJGbG9vcC1wYWdlLWNvbnRhaW5lcg%3D%3D)
 */
function getISOWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // 1..7
  d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
  const weekYear = d.getUTCFullYear();

  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

  return { weekYear, weekNo };
}

/**
 * Retourne le lundi (Date locale) de la semaine ISO (weekYear, weekNo).
 * On part du 4 janvier (toujours dans la semaine 1), puis on remonte au lundi. [2](https://gradientshub.com/blog/6-animated-gradient-backgrounds-with-code-examples/)
 */
function mondayOfISOWeek(weekYear, weekNo) {
  const jan4 = new Date(Date.UTC(weekYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));

  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (weekNo - 1) * 7);

  return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 0,0,0,0);
}

/**
 * Nombre de semaines ISO dans une année ISO : 52 ou 53.
 * Le 28 décembre est toujours dans la dernière semaine ISO. [4](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos)[2](https://gradientshub.com/blog/6-animated-gradient-backgrounds-with-code-examples/)
 */
function isoWeeksInYear(weekYear) {
  const dec28 = new Date(Date.UTC(weekYear, 11, 28));
  return getISOWeekInfo(new Date(dec28.getUTCFullYear(), dec28.getUTCMonth(), dec28.getUTCDate())).weekNo;
}


/* ======================================================
   BLOC 4 — ANNÉE SCOLAIRE & GÉNÉRATION DES SEMAINES (S35→S34)
   Exemple : 2025-2026 => S35 2025 ... S34 2026. [3](https://beforesandafters.com/2021/10/11/how-the-visual-effects-team-on-apple-tvs-foundation-kept-things-grounded/)[2](https://gradientshub.com/blog/6-animated-gradient-backgrounds-with-code-examples/)
   ====================================================== */

function parseAnneeScolaire(str) {
  const m = String(str || "").match(/^(\d{4})-(\d{4})$/);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

function getAnneeScolaireCourante() {
  return parseAnneeScolaire(window.appAnneeCourante || "2025-2026")
    || { start: 2025, end: 2026 };
}

/**
 * Génère la liste des semaines ISO dans l’ordre scolaire :
 * - de S35..S(52/53) de startYear
 * - puis S01..S34 de endYear
 */
function genererSemainesScolaires() {
  const { start, end } = getAnneeScolaireCourante();
  const startWeek = 35;
  const endWeek = 34;

  const lastWeekStartYear = isoWeeksInYear(start);
  const out = [];

  for (let w = startWeek; w <= lastWeekStartYear; w++) {
    const lundi = mondayOfISOWeek(start, w);
    out.push(makeWeekItem(lundi));
  }

  for (let w = 1; w <= endWeek; w++) {
    const lundi = mondayOfISOWeek(end, w);
    out.push(makeWeekItem(lundi));
  }

  return out;
}

function makeWeekItem(lundi) {
  const { weekYear, weekNo } = getISOWeekInfo(lundi);
  return {
    isoLundi: toISODate(lundi),
    lundi,
    weekYear,
    weekNo
  };
}

/**
 * Positionne semaineRefIndex sur la semaine ISO courante si elle existe dans le calendrier scolaire.
 */
function positionnerSemaineCourante() {
  const now = getNowDate();
  const lundiCourant = mondayOfWeek(now);
  const isoCourant = toISODate(lundiCourant);

  const idx = semaines.findIndex(s => s.isoLundi === isoCourant);
  semaineRefIndex = idx >= 0 ? idx : 0;
}


/* ======================================================
   BLOC 5 — INITIALISATION / RE-GÉNÉRATION CALENDRIER
   ====================================================== */

export function initEmploiDuTemps() {
  semaines = genererSemainesScolaires();
  positionnerSemaineCourante();
}

/**
 * Change l’année scolaire puis regénère le calendrier.
 * Format attendu : "YYYY-YYYY"
 */
function setAnneeScolaire(nouvelleAnnee) {
  const parsed = parseAnneeScolaire(nouvelleAnnee);
  if (!parsed) return;

  window.appAnneeCourante = nouvelleAnnee;

  // Re-génération
  semaines = genererSemainesScolaires();

  // Repositionner sur semaine courante si présente, sinon première semaine S35
  positionnerSemaineCourante();

  // Nettoyer les sélections de semaines (optionnel mais logique)
  semainesCibles.clear();
}


/* ======================================================
   BLOC 6 — RENDU PRINCIPAL (3 zones)
   ====================================================== */

export function renderEmploiDuTemps() {
  if (semaines.length === 0) initEmploiDuTemps();

  const sem = semaines[semaineRefIndex];
  const annee = window.appAnneeCourante || `${getAnneeScolaireCourante().start}-${getAnneeScolaireCourante().end}`;

  // Suggestions d’années scolaires (simple) : année courante, -1, +1
  const { start, end } = getAnneeScolaireCourante();
  const optionsAnnee = [
    `${start-1}-${end-1}`,
    `${start}-${end}`,
    `${start+1}-${end+1}`
  ];

  return `
    <section class="page page-edt">

      <!-- (1) BANDEAU -->
      <div class="topbar">

        <button id="prev">◀</button>

        <strong>
          S${String(sem.weekNo).padStart(2,"0")} (${sem.weekYear})
          — ${formatFR(sem.lundi)}
        </strong>

        <button id="next">▶</button>

        <select id="weekSelect">
          ${semaines.map((s, i) => `
            <option value="${i}" ${i === semaineRefIndex ? "selected" : ""}>
              S${String(s.weekNo).padStart(2,"0")} (${s.weekYear}) — ${formatFR(s.lundi)}
            </option>
          `).join("")}
        </select>

        <!-- Changement d’année scolaire (re-génération calendrier) -->
        <span>Année</span>
        <select id="anneeSelect">
          ${optionsAnnee.map(a => `
            <option value="${a}" ${a === annee ? "selected" : ""}>${a}</option>
          `).join("")}
        </select>

        <span>Type</span>
        ${choix("type", ["A","B","V"], contexte.type)}

        <span>T</span>
        ${choix("trimestre", ["T1","T2","T3"], contexte.trimestre)}

        <span>S</span>
        ${choix("semestre", ["S1","S2"], contexte.semestre)}

        <button id="valider">Valider</button>
      </div>

      <!-- (2) CORPS : 2 panneaux -->
      <div class="edt-body">

        <!-- (2a) Semaines (lundi) + coche -->
        <div class="edt-leftpanel">
          <div class="edt-weeklist">
            ${semaines.map(s => {
              const checked = semainesCibles.has(s.isoLundi) ? "checked" : "";
              return `
                <label class="edt-weekrow">
                  <input type="checkbox" data-iso="${s.isoLundi}" ${checked}>
                  <span>
                    S${String(s.weekNo).padStart(2,"0")} (${s.weekYear})
                    — ${formatFR(s.lundi)}
                  </span>
                </label>
              `;
            }).join("")}
          </div>
        </div>

        <!-- (2b) Grille semaine -->
        <div class="edt-rightpanel">
          <div class="edt-gridwrap">
            <table class="edt-grid" border="1" style="width:100%; text-align:center">
              <tr>
                <th></th>
                ${JOURS.map(j => `<th>${capitalize(j)}</th>`).join("")}
              </tr>

              ${CRENEAUX.map(cr => `
                <tr>
                  <th>${cr.code}<br><small>${cr.debut}-${cr.fin}</small></th>

                  ${JOURS.map(j => {
                    if (cr.code === "PM") return `<td class="edt-off">—</td>`;

                    const e = edtModele.find(l => l.jour === j && l.creneau === cr.code);
                    const txt = e ? (e.groupe ? `${e.classe} ${e.groupe}` : e.classe) : "&nbsp;";

                    return `<td class="edt-cell" data-j="${j}" data-c="${cr.code}">${txt}</td>`;
                  }).join("")}

                </tr>
              `).join("")}

            </table>
          </div>
        </div>

      </div>

      <!-- (3) Modale -->
      <div id="modal"></div>

    </section>
  `;
}


/* ======================================================
   BLOC 7 — UI : boutons de choix (type / trimestre / semestre)
   ====================================================== */

function choix(k, vals, act) {
  return vals.map(v => `
    <button data-k="${k}" data-v="${v}" ${v === act ? "style='background:#ccc'" : ""}>
      ${v}
    </button>
  `).join("");
}


/* ======================================================
   BLOC 8 — EVENTS
   ====================================================== */

export function bindEmploiDuTempsEvents() {

  document.getElementById("prev").onclick = () => {
    semaineRefIndex = Math.max(0, semaineRefIndex - 1);
    refresh();
  };

  document.getElementById("next").onclick = () => {
    semaineRefIndex = Math.min(semaines.length - 1, semaineRefIndex + 1);
    refresh();
  };

  document.getElementById("weekSelect").onchange = e => {
    semaineRefIndex = Number(e.target.value);
    refresh();
  };

  // Changement d'année scolaire -> regénération calendrier
  document.getElementById("anneeSelect").onchange = e => {
    setAnneeScolaire(e.target.value);
    refresh();
  };

  document.querySelectorAll("[data-k]").forEach(b => {
    b.onclick = () => {
      contexte[b.dataset.k] = b.dataset.v;
      refresh();
    };
  });

  // Clic cellule -> modale choix classe/groupe
  document.querySelectorAll(".edt-cell").forEach(td => {
    td.onclick = () => {
      ouvrirModal(td.dataset.j, td.dataset.c);
    };
  });

  // Coche semaines cibles
  document.querySelectorAll("input[type=checkbox][data-iso]").forEach(cb => {
    cb.onchange = () => {
      cb.checked ? semainesCibles.add(cb.dataset.iso) : semainesCibles.delete(cb.dataset.iso);
    };
  });

  // Valider : applique le modèle aux semaines cochées
  document.getElementById("valider").onclick = () => {
    semainesCibles.forEach(iso => {
      edtParSemaine[iso] = edtModele.map(x => ({ ...x, ...contexte }));
    });
    semainesCibles.clear();
    refresh();
  };
}


/* ======================================================
   BLOC 9 — MODALE : choix classe/groupe sur une case
   ====================================================== */

function ouvrirModal(j, c) {
  const classes = getClassesAvecGroupes();

  document.getElementById("modal").innerHTML = `
    <div style="background:white; padding:10px; border:1px solid black">
      <div style="margin-bottom:8px;"><strong>${capitalize(j)} — ${c}</strong></div>

      <select id="sel">
        ${classes.map(x =>
          `<option value="${x.classe}|${x.groupe || ""}">${x.label}</option>`
        ).join("")}
      </select>

      <div style="margin-top:10px; display:flex; gap:10px;">
        <button id="ok">OK</button>
        <button id="cancel">Annuler</button>
      </div>
    </div>
  `;

  document.getElementById("cancel").onclick = () => {
    document.getElementById("modal").innerHTML = "";
  };

  document.getElementById("ok").onclick = () => {
    const [classe, g] = document.getElementById("sel").value.split("|");
    const i = edtModele.findIndex(x => x.jour === j && x.creneau === c);

    const obj = { jour: j, creneau: c, classe, groupe: g || null };

    if (i === -1) edtModele.push(obj);
    else edtModele[i] = obj;

    document.getElementById("modal").innerHTML = "";
    refresh();
  };
}


/* ======================================================
   BLOC 10 — REFRESH SPA
   ====================================================== */

function refresh() {
  document.getElementById("app").innerHTML = renderEmploiDuTemps();
  bindEmploiDuTempsEvents();
}


/* ======================================================
   BLOC 11 — ACCÈS MÉTIER (export/import EDT)
   ====================================================== */

export function getEDT() {
  return edtParSemaine;
}

export function setEDT(e) {
  edtParSemaine = e || {};
}
