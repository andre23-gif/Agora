import { getEleves, getClasses } from "./importExport.js";

/* =======================================================
   PAGE : Classes HG
   ======================================================= */

/* -------------------------------------------------------
   BLOC 1 — RÉFÉRENTIEL COMPÉTENCES HG
------------------------------------------------------- */

const COMPETENCES_HG = [
  "Lecture document / consignes",
  "Rédaction / Présentation",
  "Lecture image",
  "Analyse",
  "Culture générale",
  "Apprentissage connaissances",
  "Langage cartographique",
  "Usages numériques",
];

const TRIMESTRES = ["T1", "T2", "T3"];
const ADAPTATIONS = ["", "PPS", "PAP", "PPRE", "Adaptations", "Adaptations partielles"];

// Mapping compétences -> colonnes Supabase agoram.competences_hg
const COMP_COL = {
  "Lecture document / consignes": "lecture_document",
  "Rédaction / Présentation": "redaction",
  "Lecture image": "lecture_image",
  "Analyse": "analyse_competence",
  "Culture générale": "culture_generale",
  "Apprentissage connaissances": "apprentissage_connaissances",
  "Langage cartographique": "langage_cartographique",
  "Usages numériques": "usages_numeriques",
};

const IFST = ["I", "F", "S", "TS"];

/* -------------------------------------------------------
   BLOC 2 — ÉTAT LOCAL DE PAGE
------------------------------------------------------- */

let classeActive = null;
let elevesClasse = []; // [{id, nom, prenom, groupe, adaptations, place(numero)}]
let syncState = "unknown";     // "unknown" | "ok" | "dirty" | "error"
let lastSyncAt = null;         // Date

// cache places pour la classe active : numero -> place_id
let numeroToPlaceId = new Map();
// cache inverse pour affichage : place_id -> numero
let placeIdToNumero = new Map();

/* -------------------------------------------------------
   BLOC 3 — STORES (lecture/écriture)
------------------------------------------------------- */

function getEventsStore() {
  return window.AG_EVENTS || { assiduite: [], comportement: [], participation: [] };
}

/* -------------------------------------------------------
   BLOC 3B — SUPABASE (accès)
------------------------------------------------------- */

function requireSupabase() {
  if (!window.sb) throw new Error("Supabase non initialisé (window.sb absent).");
  return window.sb;
}

function sbAgoram() {
  return requireSupabase().schema("agoram");
}

/* -------------------------------------------------------
   BLOC 4 — INITIALISATION / SÉLECTION CLASSE
------------------------------------------------------- */

export function initClassesHG(nomClasse) {
  classeActive = nomClasse;
  elevesClasse = [];
}

function ensureClasseActive(classes) {
  if (!classeActive && classes.length) initClassesHG(classes[0]);
}

/* -------------------------------------------------------
   BLOC 4B — CHARGEMENTS SUPABASE
------------------------------------------------------- */

async function getActiveAnneeId() {
  const sb = sbAgoram();
  const { data, error } = await sb
    .from("annees")
    .select("id")
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(`Impossible de lire 'annees'. ${error.message}`);
  return data ? data.id : null;
}

async function getClassesSupabase() {
  const sb = sbAgoram();
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return [];

  const { data, error } = await sb
    .from("classes")
    .select("nom")
    .eq("annee_id", anneeId)
    .order("nom");

  if (error) throw new Error(`Impossible de lire 'classes'. ${error.message}`);
  return (data || []).map(c => c.nom);
}

async function getClasseIdByNom(nomClasse) {
  const sb = sbAgoram();
  const anneeId = await getActiveAnneeId();

  if (anneeId) {
    const { data, error } = await sb
      .from("classes")
      .select("id")
      .eq("annee_id", anneeId)
      .eq("nom", nomClasse)
      .maybeSingle();

    if (error) throw new Error(`Impossible de lire 'classes'. ${error.message}`);
    if (data?.id) return data.id;
  }

  const { data, error } = await sb
    .from("classes")
    .select("id")
    .eq("nom", nomClasse)
    .maybeSingle();

  if (error) throw new Error(`Impossible de lire 'classes'. ${error.message}`);
  if (!data?.id) throw new Error(`Classe introuvable en base : '${nomClasse}'`);
  return data.id;
}

async function loadPlacesForClasse(classeId) {
  const sb = sbAgoram();

  // places sont liées à la classe (agoram.places.classe_id)
  const { data, error } = await sb
    .from("places")
    .select("id, numero")
    .eq("classe_id", classeId);

  if (error) throw new Error(`Impossible de lire 'places'. ${error.message}`);

  numeroToPlaceId = new Map();
  placeIdToNumero = new Map();

  (data || []).forEach(p => {
    numeroToPlaceId.set(p.numero, p.id);
    placeIdToNumero.set(p.id, p.numero);
  });
}

async function loadClasseFromSupabase(nomClasse) {
  const sb = sbAgoram();

  const classeId = await getClasseIdByNom(nomClasse);

  // places pour cette classe
  await loadPlacesForClasse(classeId);

  // élèves
  const { data: eleves, error: errEleves } = await sb
    .from("eleves")
    .select("id, prenom, nom, genre, groupe, adaptations, classe_id")
    .eq("classe_id", classeId);

  if (errEleves) throw new Error(`Impossible de lire 'eleves'. ${errEleves.message}`);

  const list = (eleves || []).slice().sort((a, b) => {
    const n = (a.nom || "").localeCompare(b.nom || "", "fr");
    if (n !== 0) return n;
    return (a.prenom || "").localeCompare(b.prenom || "", "fr");
  });

  // affectations -> places
  const ids = list.map(e => e.id);
  let aff = [];
  if (ids.length) {
    const { data: rows, error: errAff } = await sb
      .from("affectations")
      .select("eleve_id, place_id")
      .in("eleve_id", ids);

    if (errAff) throw new Error(`Impossible de lire 'affectations'. ${errAff.message}`);
    aff = rows || [];
  }

  const eleveIdToNumero = new Map();
  aff.forEach(a => {
    const num = placeIdToNumero.get(a.place_id) ?? null;
    if (num) eleveIdToNumero.set(a.eleve_id, num);
  });

  elevesClasse = list.map(e => ({
    ...e,
    place: eleveIdToNumero.get(e.id) ?? null,
  }));
}

/* -------------------------------------------------------
   BLOC 5 — RENDU PRINCIPAL
------------------------------------------------------- */

export async function renderClassesHG() {
  const classes = await getClassesSupabase();
  ensureClasseActive(classes);

  if (!classes.length) {
    return `
      <div class="page page-classeshg">
        <h1>Classes HG</h1>
        <p>Aucune classe disponible. Importe d’abord des élèves dans Import/Export.</p>
      </div>
    `;
  }

  if (!classeActive) {
    return `
      <div class="page page-classeshg">
        <h1>Classes HG</h1>
        <p>Aucune classe sélectionnée.</p>
      </div>
    `;
  }

  // charge la classe active si nécessaire
  if (classeActive && elevesClasse.length === 0) {
    await loadClasseFromSupabase(classeActive);
  }
if (syncState === "unknown") {
  syncState = "ok";
  lastSyncAt = new Date();
}
/* === AG_CLASSeshg_INIT_SYNC_OK_V1 === */
  return `
    <div class="page page-classeshg">

      <div class="classes-tabs" id="classesTabs">
        ${classes.map(c => `
          <button class="tab ${c === classeActive ? "active" : ""}" data-classe="${c}">
            ${c}
          </button>
        `).join("")}
      </div>

      <!-- (2) Classe active -->
<h1>Classe ${classeActive}</h1>

<div class="classeshg-syncbar">
  <span id="syncState">
    ${syncState === "ok" ? "🟢 Synchronisé" :
      syncState === "dirty" ? "🟠 Modifications non synchronisées" :
      syncState === "error" ? "🔴 Erreur de synchronisation" :
      "⚪ Statut inconnu"}
  </span>
  <span id="syncTime">
    ${lastSyncAt ? `Dernière synchronisation : ${lastSyncAt.toLocaleTimeString("fr-FR")}` : ""}
  </span>
  <button id="syncBtn">Synchroniser</button>
</div>

      <div class="liste-eleves">
        ${elevesClasse.map(renderEleveRow).join("")}
      </div>

      <div id="modal"></div>

    </div>
  `;
}

/* -------------------------------------------------------
   BLOC 6 — RENDU ÉLÈVE (ligne cockpit)
------------------------------------------------------- */

function renderEleveRow(eleve) {
  const adaptActuelle = (eleve.adaptations && eleve.adaptations.length) ? eleve.adaptations[0] : "";
  const placeActuelle = (typeof eleve.place === "number") ? eleve.place : "";
  const groupeActuel = eleve.groupe || "";

  return `
    <div class="eleve-row${groupeActuel ? "" : " missing-groupe"}" data-id="${eleve.id}">
      <div class="eleve-ident">
        <button class="eleve-open" data-open="${eleve.id}">
          ${eleve.nom} ${eleve.prenom}
        </button>
      </div>

      <div class="eleve-options">

        <div class="opt opt-groupe" data-eid="${eleve.id}">
          <button type="button" class="grp-btn ${groupeActuel === "gr 1" ? "active" : ""}" data-grp="gr 1">gr 1</button>
          <button type="button" class="grp-btn ${groupeActuel === "gr 2" ? "active" : ""}" data-grp="gr 2">gr 2</button>
        </div>

        <label class="opt">
          Adaptation
          <select class="opt-adapt" data-adapt="${eleve.id}">
            ${ADAPTATIONS.map(a => {
              const lab = a === "" ? "—" : a;
              return `<option value="${a}" ${adaptActuelle === a ? "selected" : ""}>${lab}</option>`;
            }).join("")}
          </select>
        </label>

        <label class="opt">
          Place
          <select class="opt-place" data-place="${eleve.id}">
            <option value="">—</option>
            ${renderPlaceOptions(placeActuelle)}
          </select>
        </label>

      </div>
    </div>
  `;
}

/* -------------------------------------------------------
   BLOC 7 — OPTIONS PLACES (Table 1..30)
------------------------------------------------------- */

function renderPlaceOptions(current) {
  const currentNum = current === "" ? null : Number(current);
  const nums = Array.from({ length: 30 }, (_, i) => i + 1);
  return nums.map(p => {
    const sel = (currentNum === p) ? "selected" : "";
    return `<option value="${p}" ${sel}>Table ${p}</option>`;
  }).join("");
}

/* -------------------------------------------------------
   BLOC 8 — BIND EVENTS
------------------------------------------------------- */

export function bindClassesHGEvents() {
   // === BOUTON SYNCHRONISER ===
const syncBtn = document.getElementById("syncBtn");

if (syncBtn) {
  syncBtn.onclick = async () => {
    try {
      await loadClasseFromSupabase(classeActive);
      syncState = "ok";
      lastSyncAt = new Date();
      await rerender();
    } catch (e) {
      syncState = "error";
      await rerender();
      console.error(e);
    }
  };
}
  // onglets classe
  document.querySelectorAll("#classesTabs .tab").forEach(btn => {
    btn.addEventListener("click", async () => {
      initClassesHG(btn.dataset.classe);
      await loadClasseFromSupabase(classeActive);
      await rerender();
    });
  });

  // modale élève
  document.querySelectorAll(".eleve-open").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.open;
      const eleve = elevesClasse.find(e => String(e.id) === String(id));
      if (eleve) ouvrirProfilEleve(eleve);
    });
  });

  // groupe : écriture immédiate + relecture (source de vérité)
  document.querySelectorAll(".opt-groupe").forEach(zone => {
    const eleveId = zone.dataset.eid;

    zone.querySelectorAll(".grp-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const grp = btn.dataset.grp; // "gr 1" ou "gr 2"
        const eleve = elevesClasse.find(e => String(e.id) === String(eleveId));
        if (!eleve) return;

        const sb = sbAgoram();
        const { error } = await sb
          .from("eleves")
          .update({ groupe: grp })
          .eq("id", eleve.id);

        if (error) throw new Error(`Écriture groupe impossible. ${error.message}`);

        await loadClasseFromSupabase(classeActive);
        await rerender();
      });
    });
  });

  // adaptation : écriture immédiate + relecture
  document.querySelectorAll(".opt-adapt").forEach(sel => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.adapt;
      const eleve = elevesClasse.find(e => String(e.id) === String(id));
      if (!eleve) return;

      const newAdaptations = sel.value ? [sel.value] : [];
      const sb = sbAgoram();
      const { error } = await sb
        .from("eleves")
        .update({ adaptations: newAdaptations })
        .eq("id", eleve.id);

      if (error) throw new Error(`Écriture adaptation impossible. ${error.message}`);

      await loadClasseFromSupabase(classeActive);
      await rerender();
    });
  });

  // place : affectations (remplacement automatique) + relecture
  document.querySelectorAll(".opt-place").forEach(sel => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.place;
      const eleve = elevesClasse.find(e => String(e.id) === String(id));
      if (!eleve) return;

      const sb = sbAgoram();
      const newNumero = sel.value ? Number(sel.value) : null;

      // supprimer affectation si place vide
      if (newNumero === null) {
        const { error } = await sb
          .from("affectations")
          .delete()
          .eq("eleve_id", eleve.id);

        if (error) throw new Error(`Suppression affectation impossible. ${error.message}`);

        await loadClasseFromSupabase(classeActive);
        await rerender();
        return;
      }

      const placeId = numeroToPlaceId.get(newNumero);
      if (!placeId) throw new Error(`Place inconnue en base pour le numéro ${newNumero}.`);

      // remplacement auto : libérer la place puis libérer l'élève
      const { error: errFreePlace } = await sb
        .from("affectations")
        .delete()
        .eq("place_id", placeId);

      if (errFreePlace) throw new Error(`Libération place impossible. ${errFreePlace.message}`);

      const { error: errFreeEleve } = await sb
        .from("affectations")
        .delete()
        .eq("eleve_id", eleve.id);

      if (errFreeEleve) throw new Error(`Libération élève impossible. ${errFreeEleve.message}`);

      const { error: errIns } = await sb
        .from("affectations")
        .insert([{ eleve_id: eleve.id, place_id: placeId }]);

      if (errIns) throw new Error(`Création affectation impossible. ${errIns.message}`);

      await loadClasseFromSupabase(classeActive);
      await rerender();
    });
  });
}

/* -------------------------------------------------------
   BLOC 9 — MODALE PROFIL ÉLÈVE (Compétences HG enregistrées en Supabase)
------------------------------------------------------- */

function ouvrirProfilEleve(eleve) {
  const trimestreDefaut = "T1";

  document.getElementById("modal").innerHTML = `
    <div class="modal profil-eleve" role="dialog" aria-modal="true">

      <div class="modal-head">
        <h2>${eleve.prenom} ${eleve.nom}</h2>
        <button class="btn-close" id="closeProfil">✕</button>
      </div>

      <div class="trimestres" id="triTabs">
        ${TRIMESTRES.map(t => `
          <button class="tri ${t === trimestreDefaut ? "active" : ""}" data-tri="${t}">${t}</button>
        `).join("")}
      </div>

      <div id="profilBody"></div>

    </div>
  `;

  document.getElementById("closeProfil").onclick = () => {
    document.getElementById("modal").innerHTML = "";
  };

  renderProfilBody(eleve, trimestreDefaut);

  document.querySelectorAll("#triTabs .tri").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#triTabs .tri").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderProfilBody(eleve, btn.dataset.tri);
    });
  });
}

async function getOrCreateCompetencesRow(eleveId, anneeId, periode) {
  const sb = sbAgoram();

  // chercher une ligne existante
  const { data: existing, error: e1 } = await sb
    .from("competences_hg")
    .select("id")
    .eq("eleve_id", eleveId)
    .eq("annee_id", anneeId)
    .eq("periode", periode)
    .maybeSingle();

  if (e1) throw new Error(`Lecture competences_hg impossible. ${e1.message}`);
  if (existing?.id) return existing.id;

  // créer une ligne vide
  const { data: inserted, error: e2 } = await sb
    .from("competences_hg")
    .insert([{ eleve_id: eleveId, annee_id: anneeId, periode }])
    .select("id")
    .maybeSingle();

  if (e2) throw new Error(`Création competences_hg impossible. ${e2.message}`);
  return inserted.id;
}

async function readCompetences(eleveId, anneeId, periode) {
  const sb = sbAgoram();

  const { data, error } = await sb
    .from("competences_hg")
    .select("*")
    .eq("eleve_id", eleveId)
    .eq("annee_id", anneeId)
    .eq("periode", periode)
    .maybeSingle();

  if (error) throw new Error(`Lecture competences_hg impossible. ${error.message}`);
  return data || null;
}

async function writeCompetence(eleveId, periode, competenceLabel, val) {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) throw new Error("Aucune année active.");

  const col = COMP_COL[competenceLabel];
  if (!col) throw new Error(`Colonne inconnue pour compétence: ${competenceLabel}`);

  const rowId = await getOrCreateCompetencesRow(eleveId, anneeId, periode);

  const sb = sbAgoram();
  const payload = {};
  payload[col] = val;

  const { error } = await sb
    .from("competences_hg")
    .update(payload)
    .eq("id", rowId);

  if (error) throw new Error(`Écriture compétence impossible. ${error.message}`);
}

async function renderProfilBody(eleve, tri) {
  const anneeId = await getActiveAnneeId();
  const row = anneeId ? await readCompetences(eleve.id, anneeId, tri) : null;

  // valeurs actuelles (par défaut I)
  const current = {};
  COMPETENCES_HG.forEach(label => {
    const col = COMP_COL[label];
    current[label] = row && row[col] ? row[col] : "I";
  });

  document.getElementById("profilBody").innerHTML = `
    <div class="bloc">
      <h3>Compétences HG (I / F / S / TS)</h3>
      <div class="competences">
        ${COMPETENCES_HG.map(label => renderCompetenceRow(eleve.id, tri, label, current[label])).join("")}
      </div>
    </div>
  `;

  // bind boutons IFST
  document.querySelectorAll(".btn-comp").forEach(btn => {
    btn.addEventListener("click", async () => {
      const eleveId = btn.dataset.eleveid;
      const periode = btn.dataset.tri;
      const label = btn.dataset.label;
      const val = btn.dataset.val;

      await writeCompetence(eleveId, periode, label, val);

      // MAJ visuelle locale
      document.querySelectorAll(`.comp-row[data-label="${escapeAttr(label)}"] .btn-comp`).forEach(b => {
        b.classList.toggle("active", b.dataset.val === val);
      });
    });
  });
}

function renderCompetenceRow(eleveId, tri, label, current) {
  return `
    <div class="comp-row" data-label="${escapeAttr(label)}">
      <div class="comp-label">${escapeHtml(label)}</div>
      <div class="comp-btns">
        ${IFST.map(v => `
          <button class="btn-comp ${v === current ? "active" : ""}"
                  data-eleveid="${eleveId}"
                  data-tri="${tri}"
                  data-label="${label}"
                  data-val="${v}">
            ${v}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

/* -------------------------------------------------------
   BLOC 12 — RERENDER PAGE
------------------------------------------------------- */

async function rerender() {
  if (classeActive) {
    await loadClasseFromSupabase(classeActive);
  }

  document.getElementById("app").innerHTML = await renderClassesHG();
  bindClassesHGEvents();
}


/* -------------------------------------------------------
   BLOC 13 — UTILITAIRES
------------------------------------------------------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/* -------------------------------------------------------
   BLOC 14 — ACCÈS MÉTIER (lecture)
------------------------------------------------------- */

export function getElevesClasseHG() {
  return elevesClasse;
}
