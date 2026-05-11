import { getClassesAvecGroupes } from "./importExport.js";

/* ======================================================
   CRÉNEAUX OFFICIELS
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
   ÉTATS MÉTIER
   ====================================================== */

// Modèle EDT (la grille centrale) : { jour, creneau, classe, groupe }
let edtModele = [];

// Affectations par semaine (clé = lundi ISO) : tableau de lignes EDT appliquées
// ligne appliquée : { jour, creneau, classe, groupe }
let edtParSemaine = {};

// Meta par semaine (clé = lundi ISO) : { type, trimestre, semestre }
let metaParSemaine = {};

// Liste de toutes les semaines générées automatiquement (lundi + numéro établissement)
let semaines = [];

// Semaine de référence (bandeau) : index dans semaines
let semaineRefIndex = 0;

// Semaines cibles (colonne gauche) : Set<lundiISO>
let semainesCibles = new Set();

// Contexte choisi dans le bandeau (appliqué au moment de Valider)
let contexte = {
  type: "A",        // A / B / V
  trimestre: "T1",  // T1 / T2 / T3
  semestre: "S1",   // S1 / S2
};

/* ======================================================
   OUTILS DATES
   ====================================================== */

function mondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7; // dimanche -> 7
  if (day !== 1) d.setDate(d.getDate() - day + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function formatFR(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function anneeDebut() {
