import { getEleves, getClasses } from "./importExport.js";
/* =======================================================
   PAGE : Classes HG
   RÔLE MÉTIER :
     - Onglets = classes (Supabase / année active)
     - Bouton PP par classe (persistant Supabase : classes.is_pp)
     - Liste élèves (1 ligne) : Nom / Prénom / Genre / Groupe / Adaptation / Place
     - Groupe : obligatoire (radio), écriture immédiate Supabase
     - Adaptation : écriture immédiate Supabase (eleves.adaptations)
     - Place : écriture immédiate Supabase (eleves.place) + remplacement automatique (règle A)
     - Bouton Synchroniser : relecture Supabase + preuve visuelle (syncState + horodatage)
     - Clic sur nom : modale élève HG
         * Onglets T1/T2/T3
         * Compétences HG I/F/S/TS (Supabase, dernière valeur uniquement, modifiable)
   NOTE IMPORT :
     - getEleves/getClasses importés mais non utilisés ici (historique).
   ======================================================= */

/* -------------------------------------------------------
   BLOC 1 — RÉFÉRENTIEL COMPÉTENCES HG
------------------------------------------------------- */

const COMPETENCES_HG = [
  "Lecture document",
  "Lecture consignes",
  "Rédaction de texte",
  "Présentation de document",
  "Lecture image",
  "Analyse",
  "Culture générale",
  "Apprentissage connaissances",
  "Langage cartographique",
  "Usages numériques"
];


const TRIMESTRES = ["T1", "T2", "T3"];
const ADAPTATIONS = ["", "PPS", "PAP", "PPRE", "Adaptations", "Adaptations partielles"];
const IFST = ["I", "F", "S", "TS"];

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

/* -------------------------------------------------------
   BLOC 2 — ÉTAT LOCAL DE PAGE
------------------------------------------------------- */

let classeActive = null;
let elevesClasse = []; // [{id, nom, prenom, genre, groupe, adaptations, place, classe_id}]

let syncState = "unknown"; // "unknown" | "ok" | "dirty" | "error"
let lastSyncAt = null;     // Date | null

// cache des classes pour l'année active : [{id, nom, is_pp}]
let classesMeta = [];

/* -------------------------------------------------------
   BLOC 3 — SUPABASE (accès)
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
  if (!classeActive && classes.length) initClassesHG(classes[0].nom ?? classes[0]);
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

/* === AG_CLASSeshg_CLASSES_META_V1 === */
async function getClassesSupabaseMeta() {
  const sb = sbAgoram();
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return [];

  const { data, error } = await sb
    .from("classes")
    .select("id, nom, is_pp")
    .eq("annee_id", anneeId)
    .order("nom");

  if (error) throw new Error(`Impossible de lire 'classes'. ${error.message}`);

  return (data || []).map(c => ({
    id: c.id,
    nom: c.nom,
    is_pp: !!c.is_pp
  }));
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

async function loadClasseFromSupabase(nomClasse) {
  const sb = sbAgoram();
  const classeId = await getClasseIdByNom(nomClasse);

  const { data: eleves, error: errEleves } = await sb
    .from("eleves")
    .select("id, prenom, nom, genre, groupe, adaptations, place, classe_id")
    .eq("classe_id", classeId);

  if (errEleves) throw new Error(`Impossible de lire 'eleves'. ${errEleves.message}`);

  const list = (eleves || []).slice().sort((a, b) => {
    const n = (a.nom || "").localeCompare(b.nom || "", "fr");
    if (n !== 0) return n;
    return (a.prenom || "").localeCompare(b.prenom || "", "fr");
  });

  elevesClasse = list.map(e => ({
    ...e,
    place: (typeof e.place === "number") ? e.place : null,
    adaptations: Array.isArray(e.adaptations) ? e.adaptations : [],
    groupe: e.groupe || null,
  }));
}

/* -------------------------------------------------------
   BLOC 5 — RENDU PRINCIPAL
------------------------------------------------------- */

export async function renderClassesHG() {

  classesMeta = await getClassesSupabaseMeta();
  ensureClasseActive(classesMeta);

  if (!classesMeta.length) {
    return `
      <div class="page page-classeshg">
        <h1>Classes HG</h1>
        <p>Aucune classe disponible. Importe d’abord des élèves.</p>
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

  if (elevesClasse.length === 0) {
    await loadClasseFromSupabase(classeActive);
  }

  if (syncState === "unknown") {
    syncState = "ok";
    lastSyncAt = new Date();
  }

  return `
    <div class="page page-classeshg">

   <div class="classes-tabs" id="classesTabs">
  ${classesMeta.map(c => `
    <div class="tab-wrap ${c.nom === classeActive ? "active" : ""}">
      <button class="tab ${c.nom === classeActive ? "active" : ""}"
              data-classe="${escapeAttr(c.nom)}">
        ${escapeHtml(c.nom)}
      </button>

      <label class="pp-radio" data-pp-id="${escapeAttr(c.id)}" title="Classe suivie en PP">
        <input
          type="radio"
          name="pp-classe"
          value="${escapeAttr(c.id)}"
          ${c.is_pp ? "checked" : ""}
        >
        PP
      </label>
    </div>
  `).join("")}
</div>

      <!-- === AG_CLASSeshg_TABS_BLOCK_FINAL === -->

      <h1>Classe ${escapeHtml(classeActive)}</h1>

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
    <div class="eleve-row${groupeActuel ? "" : " missing-groupe"}" data-id="${escapeAttr(eleve.id)}">
      <div class="eleve-ident">
        <button class="eleve-open" data-open="${escapeAttr(eleve.id)}">
          ${escapeHtml(eleve.nom)} ${escapeHtml(eleve.prenom)}
        </button>
      </div>

      <div class="eleve-options">

        <div class="opt opt-groupe" data-eid="${escapeAttr(eleve.id)}">
          <label>
            <input type="radio" name="grp-${escapeAttr(eleve.id)}" value="gr 1" ${groupeActuel === "gr 1" ? "checked" : ""}>
            gr 1
          </label>
          <label>
            <input type="radio" name="grp-${escapeAttr(eleve.id)}" value="gr 2" ${groupeActuel === "gr 2" ? "checked" : ""}>
            gr 2
          </label>
        </div>

        <div class="opt opt-genre">
          ${escapeHtml(eleve.genre || "—")}
        </div>

        <label class="opt">
          Adaptation
          <select class="opt-adapt" data-adapt="${escapeAttr(eleve.id)}">
            ${ADAPTATIONS.map(a => {
              const lab = a === "" ? "—" : a;
              return `<option value="${escapeAttr(a)}" ${adaptActuelle === a ? "selected" : ""}>${escapeHtml(lab)}</option>`;
            }).join("")}
          </select>
        </label>

        <label class="opt">
          Place
          <select class="opt-place" data-place="${escapeAttr(eleve.id)}">
            <option value="">—</option>
            ${renderPlaceOptions(placeActuelle)}
          </select>
        </label>

      </div>
    </div>
  `;
}

/* -------------------------------------------------------
   BLOC 7 — OPTIONS PLACES (1..30)
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

console.log("✅ bindClassesHGEvents exécuté");
   
  // Synchroniser : relecture Supabase + preuve
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

// Onglets classe (uniquement ceux qui ont data-classe)
document.querySelectorAll('#classesTabs .tab[data-classe]').forEach(btn => {
  btn.addEventListener("click", async () => {
    initClassesHG(btn.dataset.classe);
    await loadClasseFromSupabase(classeActive);
    syncState = "ok";
    lastSyncAt = new Date();
    await rerender();
  });
});

/* === AG_CLASSeshg_PP_RADIO_V1_BEGIN =========================
   PP par classe = radio (comme gr1/gr2)
   Écrit Supabase : classes.is_pp
   =========================================================== */

document.querySelectorAll("#classesTabs .pp-radio input[type='radio']").forEach(r => {
  r.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  r.addEventListener("change", async (e) => {
    e.stopPropagation();

    const classeId = r.value;

    try {
      const sb = sbAgoram();
      const anneeId = await getActiveAnneeId();
      if (!anneeId) throw new Error("Aucune année active.");

      // 1) Reset toutes les classes de l'année
      const { error: errReset } = await sb
        .from("classes")
        .update({ is_pp: false })
        .eq("annee_id", anneeId);

      if (errReset) throw new Error(errReset.message);

      // 2) Activer la classe choisie
      const { error: errSet } = await sb
        .from("classes")
        .update({ is_pp: true })
        .eq("id", classeId);

      if (errSet) throw new Error(errSet.message);

      syncState = "dirty";
      await rerender();

    } catch (err) {
      console.error(err);
      syncState = "error";
      await rerender();
    }
  });
});

/* === AG_CLASSeshg_PP_RADIO_V1_END =========================== */

// ✅ Clic nom élève → ouvrir modale
document.querySelectorAll(".eleve-open").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const id = btn.dataset.open;
    const eleve = elevesClasse.find(x => String(x.id) === String(id));

    if (eleve) {
      console.log("OUVERTURE MODALE", eleve); // debug
      ouvrirProfilEleve(eleve);
    } else {
      console.error("Eleve introuvable", id);
    }
  });
});

   
/* === AG_CLASSeshg_ELEVE_MODAL_BIND_V1_BEGIN ====================
   Clic nom -> ouvre modale profil élève HG

  // Groupe : écriture immédiate
  document.querySelectorAll(".opt-groupe").forEach(zone => {
    const eleveId = zone.dataset.eid;

    zone.querySelectorAll('input[type="radio"]').forEach(input => {
      input.addEventListener("change", async () => {
        const grp = input.value;
        const eleve = elevesClasse.find(e => String(e.id) === String(eleveId));
        if (!eleve) return;

        const sb = sbAgoram();
        const { error } = await sb
          .from("eleves")
          .update({ groupe: grp })
          .eq("id", eleve.id);

        if (error) throw new Error(`Écriture groupe impossible. ${error.message}`);

        syncState = "dirty";
        await rerender();
      });
    });
  });

  // Adaptation : écriture immédiate
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

      syncState = "dirty";
      await rerender();
    });
  });

  // Place : eleves.place + remplacement automatique (règle A)
  document.querySelectorAll(".opt-place").forEach(sel => {
    sel.addEventListener("change", async () => {
      const id = sel.dataset.place;
      const eleve = elevesClasse.find(e => String(e.id) === String(id));
      if (!eleve) return;

      const sb = sbAgoram();
      const newNumero = sel.value ? Number(sel.value) : null;

      // Règle A : si la place est prise dans la même classe, libérer l'autre élève
      if (newNumero !== null) {
        const { error: errFree } = await sb
          .from("eleves")
          .update({ place: null })
          .eq("classe_id", eleve.classe_id)
          .eq("place", newNumero)
          .neq("id", eleve.id);

        if (errFree) throw new Error(`Libération place impossible. ${errFree.message}`);
      }

      // Affecter la place à l'élève (ou null)
      const { error: errSet } = await sb
        .from("eleves")
        .update({ place: newNumero })
        .eq("id", eleve.id);

      if (errSet) throw new Error(`Écriture place impossible. ${errSet.message}`);

      syncState = "dirty";
      await rerender();
    });
  });
}

/* -------------------------------------------------------
   BLOC 9 — MODALE PROFIL ÉLÈVE (Compétences HG)
   Stockage : dernière valeur uniquement (modifiable)
------------------------------------------------------- */

function ouvrirProfilEleve(eleve) {
  const trimestreDefaut = "T1";

  const modal = document.getElementById("modal");
  if (!modal) {
    console.error("Bloc modale absent : <div id='modal'></div> introuvable.");
    return;
  }

  modal.innerHTML = `
    <div class="modal profil-eleve" role="dialog" aria-modal="true">

      <div class="modal-head">
        <h2>${escapeHtml(eleve.prenom)} ${escapeHtml(eleve.nom)}</h2>
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
    modal.innerHTML = "";
  };

  // rendu initial
  renderProfilBody(eleve, trimestreDefaut).catch(console.error);

  // onglets trimestre
  document.querySelectorAll("#triTabs .tri").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#triTabs .tri").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderProfilBody(eleve, btn.dataset.tri).catch(console.error);
    });
  });
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

  const sb = sbAgoram();
  const payload = {
    eleve_id: eleveId,
    annee_id: anneeId,
    periode: periode,
    [col]: val
  };

  const { error } = await sb
    .from("competences_hg")
    .upsert([payload], { onConflict: "eleve_id,annee_id,periode" });

  if (error) throw new Error(`Écriture compétence impossible. ${error.message}`);
}

async function renderProfilBody(eleve, tri) {
  const anneeId = await getActiveAnneeId();
  const row = anneeId ? await readCompetences(eleve.id, anneeId, tri) : null;

  const current = {};
  COMPETENCES_HG.forEach(label => {
    const col = COMP_COL[label];
    current[label] = (row && row[col]) ? row[col] : "I";
  });

  const body = document.getElementById("profilBody");
  if (!body) return;

  body.innerHTML = `
    <div class="bloc">
      <h3>Compétences HG </h3>
      <div class="competences">
        ${COMPETENCES_HG.map(label => renderCompetenceRow(eleve.id, tri, label, current[label])).join("")}
      </div>
    </div>
  `;

  // bind des boutons IFST
  document.querySelectorAll(".btn-comp").forEach(btn => {
    btn.addEventListener("click", async () => {
      const eleveId = btn.dataset.eleveid;
      const periode = btn.dataset.tri;
      const label = btn.dataset.label;
      const val = btn.dataset.val;

      await writeCompetence(eleveId, periode, label, val);
       current[label] = val;

      // update visuel de la ligne
      document.querySelectorAll(`.comp-row[data-label="${escapeAttr(label)}"] .btn-comp`).forEach(b => {
        b.classList.toggle("active", b.dataset.val === val);
      });

      syncState = "dirty";
    });
  });
}

function renderCompetenceRow(eleveId, tri, label, currentVal) {
  return `
    <div class="comp-row" data-label="${escapeAttr(label)}">

      <div class="comp-label">
        ${escapeHtml(label)}
      </div>

      <div class="comp-btns">
        ${IFST.map(v => `
          <button class="btn-comp ${v === currentVal ? "active" : ""}"
                  data-eleveid="${escapeAttr(eleveId)}"
                  data-tri="${escapeAttr(tri)}"
                  data-label="${escapeAttr(label)}"
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
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
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

/* -------------------------------------------------------
   BLOC 15 — POUR LA PAGE PP : classes cochées PP
   Usage (dans page PP) :
     const classesPP = await getPPClasses();
------------------------------------------------------- */

export async function getPPClasses() {
  const sb = sbAgoram();
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return [];

  const { data, error } = await sb
    .from("classes")
    .select("nom")
    .eq("annee_id", anneeId)
    .eq("is_pp", true)
    .order("nom");

  if (error) throw new Error(`Lecture classes PP impossible. ${error.message}`);
  return (data || []).map(x => x.nom);
}
