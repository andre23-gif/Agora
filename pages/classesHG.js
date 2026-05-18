import { getEleves, getClasses } from "./importExport.js";

/* =======================================================
   PAGE : Classes HG
   RÔLE MÉTIER :
     - Cockpit de classe HG : navigation par onglets (1 onglet = 1 classe importée)
     - Paramétrage élève (ligne) : adaptation (unique) + place (facultative)
     - AU CLIC sur l’onglet de classe : recharge depuis SUPABASE (source de vérité)
     - Écriture immédiate Supabase sur changement adaptation/place
     - Profil élève (modale) inchangé :
         * Assiduité (lecture seule : saisie uniquement en Salle)
         * Comportement (lecture seule : événements Salle)
         * Compétences HG (I/F/S/TS) éditables par trimestre
         * Participation (calculée)
   LIT :
     - Import : getEleves(), getClasses() (sert seulement à fabriquer les onglets)
     - Supabase : classes, annees(active), eleves, places, affectations
     - Events (optionnel) : window.AG_EVENTS (assiduité/participation/comportement)
   ÉCRIT :
     - Supabase : eleves.adaptations ; affectations(eleve_id, place_id)
     - Mémoire : elevesClasse (cache d’affichage)
     - Store compétences : window.AG_COMP_HG
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

const COMPETENCE_PARTICIPATION = "Participation";
const TRIMESTRES = ["T1", "T2", "T3"];
const ADAPTATIONS = ["", "PPS", "PAP", "PPRE", "Adaptations", "Adaptations partielles"];


/* -------------------------------------------------------
   BLOC 2 — ÉTAT LOCAL DE PAGE
------------------------------------------------------- */

let classeActive = null;
let elevesClasse = [];

// caches places (chargés depuis Supabase)
let placeIdToNumero = new Map();   // place_id -> numero (1..30)
let numeroToPlaceId = new Map();   // numero -> place_id


/* -------------------------------------------------------
   BLOC 3 — STORES (lecture/écriture)
------------------------------------------------------- */

function getEventsStore() {
  return window.AG_EVENTS || { assiduite: [], comportement: [], participation: [] };
}

function getCompStore() {
  if (!window.AG_COMP_HG) window.AG_COMP_HG = {};
  return window.AG_COMP_HG;
}


/* -------------------------------------------------------
   BLOC 3B — SUPABASE (accès)
   Hypothèse minimale : window.sb existe déjà dans ton app
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
  elevesClasse = []; // le vrai contenu viendra de Supabase au clic
}

function ensureClasseActive() {
  const classes = getClasses();
  if (!classeActive && classes.length) {
    initClassesHG(classes[0]);
  }
}


/* -------------------------------------------------------
   BLOC 4B — CHARGEMENT SUPABASE (classe -> élèves + places)
   Objectif :
     - Au clic sur l’onglet classe, recharger elevesClasse depuis Supabase
     - Charger places + affectations pour remplir eleve.place (numero)
------------------------------------------------------- */

async function loadPlacesFromSupabase() {
  const sb = sbAgoram();

  // On prend tout (*) pour éviter de dépendre d’un nom de colonne supposé.
  const { data: rows, error } = await sb.from("places").select("*");
  if (error) throw new Error(`Impossible de lire 'places'. ${error.message}`);

  placeIdToNumero = new Map();
  numeroToPlaceId = new Map();

  if (!rows || !rows.length) return;

  // Détection robuste du champ "numero" (1..30) dans la table places
  const sample = rows[0];
  const keys = Object.keys(sample);

  // Cherche un champ numérique entre 1 et 30
  let numeroKey = null;
  for (const k of keys) {
    const v = sample[k];
    if (typeof v === "number" && v >= 1 && v <= 30) {
      numeroKey = k;
      break;
    }
  }

  if (!numeroKey) {
    throw new Error("Table 'places' : impossible d’identifier la colonne numérique (1..30).");
  }

  rows.forEach(r => {
    const pid = r.id;
    const num = r[numeroKey];
    if (pid && typeof num === "number") {
      placeIdToNumero.set(pid, num);
      numeroToPlaceId.set(num, pid);
    }
  });
}

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

  // fallback si aucune année active trouvée
  const { data, error } = await sb
    .from("classes")
    .select("id")
    .eq("nom", nomClasse)
    .maybeSingle();

  if (error) throw new Error(`Impossible de lire 'classes'. ${error.message}`);
  if (!data?.id) throw new Error(`Classe introuvable en base : '${nomClasse}'`);
  return data.id;
}

async function loadClasseFromSupabase(nomClasse) {
  const sb = sbAgoram();

  // 1) places (pour traduire place_id -> numero)
  await loadPlacesFromSupabase();

  // 2) classe_id
  const classeId = await getClasseIdByNom(nomClasse);

  // 3) élèves de la classe
  const { data: eleves, error: errEleves } = await sb
    .from("eleves")
    .select("id, prenom, nom, genre, adaptations, classe_id")
    .eq("classe_id", classeId);

  if (errEleves) throw new Error(`Impossible de lire 'eleves'. ${errEleves.message}`);

  const list = (eleves || []).slice().sort((a, b) => {
    const n = (a.nom || "").localeCompare(b.nom || "", "fr");
    if (n !== 0) return n;
    return (a.prenom || "").localeCompare(b.prenom || "", "fr");
  });

  // 4) affectations pour ces élèves
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

  // 5) enrichir la vue locale
  elevesClasse = list.map(e => ({
    ...e,
    place: eleveIdToNumero.get(e.id) ?? null, // numero 1..30 ou null
  }));
}


/* -------------------------------------------------------
   BLOC 5 — RENDU PRINCIPAL
------------------------------------------------------- */

export function renderClassesHG() {
  const classes = getClasses();
  ensureClasseActive();

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

  return `
    <div class="page page-classeshg">

      <!-- (1) Onglets classes -->
      <div class="classes-tabs" id="classesTabs">
        ${classes.map(c => `
          <button class="tab ${c === classeActive ? "active" : ""}" data-classe="${c}">
            ${c}
          </button>
        `).join("")}
      </div>

      <!-- (2) Classe active -->
      <h1>Classe ${classeActive}</h1>

      <!-- (3) Liste élèves + 2 menus -->
      <div class="liste-eleves">
        ${elevesClasse.map(renderEleveRow).join("")}
      </div>

      <!-- (4) Modale -->
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

  return `
    <div class="eleve-row" data-id="${eleve.id}">
      <div class="eleve-ident">
        <button class="eleve-open" data-open="${eleve.id}">
          ${eleve.nom} ${eleve.prenom}
        </button>
      </div>

      <div class="eleve-options">

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
   BLOC 8 — BIND EVENTS (interaction page)
------------------------------------------------------- */

export function bindClassesHGEvents() {
  // Onglets classes -> charge depuis Supabase
  document.querySelectorAll("#classesTabs .tab").forEach(btn => {
    btn.addEventListener("click", async () => {
      initClassesHG(btn.dataset.classe);

      await loadClasseFromSupabase(classeActive);
      rerender();
    });
  });

  // Auto-chargement initial (classe active au premier affichage)
  if (classeActive && elevesClasse.length === 0) {
    loadClasseFromSupabase(classeActive)
      .then(() => rerender())
      .catch(e => { console.error(e); });
  }

  // Ouvrir profil élève
  document.querySelectorAll(".eleve-open").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.open;
      const eleve = elevesClasse.find(e => String(e.id) === String(id));
      if (eleve) ouvrirProfilEleve(eleve);
    });
  });

  // Adaptation -> update Supabase.eleves.adaptations
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

      if (error) {
        // on reste cohérent : pas de mise à jour locale si DB échoue
        rerender();
        throw new Error(`Écriture adaptation impossible. ${error.message}`);
      }

      eleve.adaptations = newAdaptations;
      rerender();
    });
  });

  // Place -> update Supabase via agoram.affectations (remplacement automatique)
  document.querySelectorAll(".opt-place").forEach(sel => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.place;
      const eleve = elevesClasse.find(e => String(e.id) === String(id));
      if (!eleve) return;

      const sb = sbAgoram();
      const newNumero = sel.value ? Number(sel.value) : null;

      // suppression (place vide)
      if (newNumero === null) {
        const { error } = await sb
          .from("affectations")
          .delete()
          .eq("eleve_id", eleve.id);

        if (error) {
          rerender();
          throw new Error(`Suppression affectation impossible. ${error.message}`);
        }

        eleve.place = null;
        rerender();
        return;
      }

      // numero -> place_id
      const placeId = numeroToPlaceId.get(newNumero);
      if (!placeId) {
        rerender();
        throw new Error(`Place inconnue en base pour le numéro ${newNumero}.`);
      }

      // Règle A : remplacement automatique
      // 1) libérer la place (si occupée)
      const { error: errFreePlace } = await sb
        .from("affectations")
        .delete()
        .eq("place_id", placeId);

      if (errFreePlace) {
        rerender();
        throw new Error(`Libération place impossible. ${errFreePlace.message}`);
      }

      // 2) libérer l’élève (s’il avait déjà une place)
      const { error: errFreeEleve } = await sb
        .from("affectations")
        .delete()
        .eq("eleve_id", eleve.id);

      if (errFreeEleve) {
        rerender();
        throw new Error(`Libération élève impossible. ${errFreeEleve.message}`);
      }

      // 3) créer la nouvelle affectation
      const { error: errIns } = await sb
        .from("affectations")
        .insert([{ eleve_id: eleve.id, place_id: placeId }]);

      if (errIns) {
        rerender();
        throw new Error(`Création affectation impossible. ${errIns.message}`);
      }

      // mettre à jour la vue locale (libérer l’occupant local aussi)
      elevesClasse.forEach(e => { if (e.place === newNumero) e.place = null; });
      eleve.place = newNumero;

      rerender();
    });
  });
}


/* -------------------------------------------------------
   BLOC 9 — MODALE PROFIL ÉLÈVE
   (inchangé dans son principe)
------------------------------------------------------- */

function ouvrirProfilEleve(eleve) {
  const events = getEventsStore();
  const compStore = getCompStore();

  if (!compStore[eleve.id]) compStore[eleve.id] = {};
  TRIMESTRES.forEach(t => {
    if (!compStore[eleve.id][t]) compStore[eleve.id][t] = {};
  });

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

function renderProfilBody(eleve, tri) {
  const events = getEventsStore();
  const compStore = getCompStore();

  const filterTri = (arr) =>
    arr.filter(e => e.eleveId === eleve.id).filter(e => !e.trimestre || e.trimestre === tri);

  const ass = filterTri(events.assiduite);
  const comp = filterTri(events.comportement);
  const part = filterTri(events.participation);

  const participationIFST = syntheseParticipationIFST(part);
  const evals = compStore[eleve.id][tri];

  document.getElementById("profilBody").innerHTML = `
    <div class="bloc">
      <h3>Assiduité (lecture)</h3>
      ${ass.length ? `
        <div class="liste-mini">
          ${ass
            .slice()
            .sort((a,b) => (a.date||"").localeCompare(b.date||""))
            .map(x => `<div class="mini-ligne">${x.date ?? "—"} · ${x.creneau ?? "—"} · ${x.type ?? "—"}</div>`)
            .join("")}
        </div>
      ` : `<div class="hint">Aucune donnée enregistrée.</div>`}
    </div>

    <div class="bloc">
      <h3>Comportement (lecture)</h3>
      ${comp.length ? `
        <div class="liste-mini">
          ${comp
            .slice()
            .sort((a,b) => (a.date||"").localeCompare(b.date||""))
            .map(x => `<div class="mini-ligne">${x.date ?? "—"} · ${x.creneau ?? "—"} · ${escapeHtml(x.texte ?? "")}</div>`)
            .join("")}
        </div>
      ` : `<div class="hint">Aucune donnée enregistrée.</div>`}
    </div>

    <div class="bloc">
      <h3>Participation (calculée)</h3>
      <div class="hint">Niveau : <b>${participationIFST}</b></div>
    </div>

    <div class="bloc">
      <h3>Compétences HG (I / F / S / TS)</h3>
      <div class="competences">
        ${COMPETENCES_HG.map(label => renderCompetenceRow(eleve.id, tri, label, evals[label] ?? "I")).join("")}
      </div>
    </div>
  `;

  document.querySelectorAll(".btn-comp").forEach(btn => {
    btn.addEventListener("click", () => {
      const eleveId = btn.dataset.eleveid;
      const tri = btn.dataset.tri;
      const label = btn.dataset.label;
      const val = btn.dataset.val;

      const store = getCompStore();
      if (!store[eleveId]) store[eleveId] = {};
      if (!store[eleveId][tri]) store[eleveId][tri] = {};
      store[eleveId][tri][label] = val;

      document.querySelectorAll(`.comp-row[data-label="${cssAttr(label)}"] .btn-comp`).forEach(b => {
        b.classList.toggle("active", b.dataset.val === val);
      });
    });
  });
}

function renderCompetenceRow(eleveId, tri, label, current) {
  const vals = ["I","F","S","TS"];
  return `
    <div class="comp-row" data-label="${escapeAttr(label)}">
      <div class="comp-label">${escapeHtml(label)}</div>
      <div class="comp-btns">
        ${vals.map(v => `
          <button class="btn-comp ${v === current ? "active" : ""}"
                  data-eleveid="${eleveId}"
                  data-tri="${tri}"
                  data-label="${escapeAttr(label)}"
                  data-val="${v}">
            ${v}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function syntheseParticipationIFST(events) {
  if (!events || !events.length) return "—";
  const score = (v) => {
    switch (v) {
      case "perturbateur": return 0;
      case "passif": return 1;
      case "participe": return 2;
      case "moteur": return 3;
      default: return 1;
    }
  };
  const total = events.reduce((acc, e) => acc + score(e.valeur), 0);
  const avg = total / events.length;
  const flo = Math.floor(avg);
  if (flo === 0) return "I";
  if (flo === 1) return "F";
  if (flo === 2) return "S";
  return "TS";
}


/* -------------------------------------------------------
   BLOC 12 — RERENDER PAGE
------------------------------------------------------- */

function rerender() {
  document.getElementById("app").innerHTML = renderClassesHG();
  bindClassesHGEvents();
}


/* -------------------------------------------------------
   BLOC 13 — UTILITAIRES
------------------------------------------------------- */

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[m]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function cssAttr(s) {
  return s;
}


/* -------------------------------------------------------
   BLOC 14 — ACCÈS MÉTIER (lecture)
------------------------------------------------------- */

export function getElevesClasseHG() {
  return elevesClasse;
}
