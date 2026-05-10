// =======================================================
// PAGE ARCHIVES / CHANGEMENT D’ANNÉE — AGORAMOSAÏQUE
// Sauvegarde locale CSV + sécurités renforcées
// Version STABLE SANS SUPABASE
// =======================================================

import { getEleves } from "./importExport.js";

// =======================================================
// PARAMÈTRES DE SÉCURITÉ (À ADAPTER SI BESOIN)
// =======================================================

// Date minimale autorisant l’archivage (YYYY-MM-DD)
const ARCHIVE_MIN_DATE = "2025-06-15";

// Année scolaire courante (déjà définie ailleurs)
const ANNEE_COURANTE = window.appAnneeCourante || "2024-2025";

// =======================================================
// OUTILS GÉNÉRIQUES CSV
// =======================================================

function downloadCSV(filename, header, rows) {
  let csv = header + "\n";
  rows.forEach(r => {
    csv += r.join(";") + "\n";
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

// =======================================================
// SAUVEGARDES LOCALES
// =======================================================

function exportStructureCSV() {
  const eleves = getEleves();

  const rows = eleves.map(e => [
    e.classe,
    e.est_pp ? "oui" : "non",
    e.prenom,
    e.nom,
    e.genre,
    (e.adaptations || []).join(",")
  ]);

  downloadCSV(
    `structure_${ANNEE_COURANTE}.csv`,
    "classe;est_pp;prenom;nom;genre;adaptations",
    rows
  );
}

function exportBulletinsHGCSV() {
  const bulletins = window.bulletinsHG || [];

  const rows = bulletins.map(b => {
    const [prenom, nom, classe] = b.eleveKey.split("|");
    return [
      ANNEE_COURANTE,
      b.periode,
      classe,
      prenom,
      nom,
      `"${b.texte.replace(/"/g, '""')}"`
    ];
  });

  downloadCSV(
    `HG_bulletins_${ANNEE_COURANTE}.csv`,
    "annee;periode;classe;prenom;nom;bulletin_hg",
    rows
  );
}

function exportPPSuiviCSV() {
  const ppData = window.ppData || {};

  const rows = Object.entries(ppData).map(([key, d]) => {
    const [prenom, nom, classe] = key.split("|");
    return [
      classe,
      prenom,
      nom,
      d.absences ?? "",
      d.retards ?? "",
      d.observations ?? "",
      d.punitions ?? "",
      d.sanctions ?? "",
      d.orientation?.voie1 ?? "",
      d.orientation?.voie2 ?? "",
      d.stage?.statut ?? "",
      d.stage?.noteOral ?? "",
      d.examens?.pix ? "oui" : "non",
      d.examens?.assr2 ? "oui" : "non",
      d.examens?.evalang ? "oui" : "non",
      d.examens?.dnb ? "oui" : "non",
      d.examens?.cfg ? "oui" : "non",
      d.niveaux?.sciences ?? "",
      d.niveaux?.litteraires ?? "",
      d.niveaux?.langues ?? "",
      d.niveaux?.arts ?? "",
      d.niveaux?.eps ?? ""
    ];
  });

  downloadCSV(
    `PP_suivi_${ANNEE_COURANTE}.csv`,
    "classe;prenom;nom;absences;retards;observations;punitions;sanctions;voie1;voie2;stage_statut;stage_note_oral;pix;assr2;evalang;dnb;cfg;niveau_sciences;niveau_litteraires;niveau_langues;niveau_arts;niveau_eps",
    rows
  );
}

// =======================================================
// RENDER PAGE ARCHIVES
// =======================================================

export function renderArchives() {
  const today = new Date().toISOString().slice(0, 10);
  const allowed = today >= ARCHIVE_MIN_DATE;

  return `
    <section>
      <h1>Archives / Changement d’année</h1>

      <p>
        Année en cours : <strong>${ANNEE_COURANTE}</strong>
      </p>

      <p>
        Cette action clôt définitivement l’année scolaire.
        Toutes les données deviendront non modifiables.
      </p>

      <p><strong>Une sauvegarde complète (CSV) sera générée automatiquement.</strong></p>

      <p>
        Archivage autorisé à partir du :
        <strong>${ARCHIVE_MIN_DATE}</strong>
      </p>

      <p>
        Pour confirmer, recopiez exactement :
        <br>
        <code>ARCHIVER ${ANNEE_COURANTE}</code>
      </p>

      <input
        type="text"
        id="archiveConfirm"
        placeholder="Recopiez ici le texte exact"
        style="width:100%;"
      >

      <button
        id="archiveBtn"
        ${allowed ? "" : "disabled"}
        style="margin-top:1em; background:#b00020; color:white;"
      >
        🗄️ ARCHIVER L’ANNÉE
      </button>

      <div id="archiveStatus" style="margin-top:1em;"></div>
    </section>
  `;
}

// =======================================================
// EVENTS
// =======================================================

export function bindArchivesEvents() {
  const input = document.getElementById("archiveConfirm");
  const btn = document.getElementById("archiveBtn");
  const status = document.getElementById("archiveStatus");

  if (!btn) return;

  btn.addEventListener("click", () => {
    const expected = `ARCHIVER ${ANNEE_COURANTE}`;

    if (input.value !== expected) {
      alert("Texte de confirmation incorrect.");
      return;
    }

    // SAUVEGARDES OBLIGATOIRES
    exportBulletinsHGCSV();
    exportPPSuiviCSV();
    exportStructureCSV();

    status.innerHTML = `
      ✅ Sauvegarde complète effectuée.<br>
      L’année <strong>${ANNEE_COURANTE}</strong> est maintenant archivée.
    `;

    // Marquage archive (local)
    window.appArchivee = true;
  });
}
