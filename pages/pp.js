// =======================================================
// PAGE PROF PRINCIPAL (PP) — AGORAMOSAÏQUE
// Sources : Supabase (pp_suivi, pp_suivi_trimestre, pp_reunions)
// Flux : Classe PP → Liste élèves → Menu élève → 5 modales
// =======================================================

/* -------------------------------------------------------
   CONSTANTES MÉTIER
------------------------------------------------------- */

const LV1_OPTIONS   = ["Anglais", "Allemand", "Espagnol"];
const LV2_OPTIONS   = ["Espagnol", "Allemand", "Anglais", "Aucune"];
const OPTIONS_FAC   = ["Baroque", "Latin", "LCE Anglais", "LCE Espagnol", "Aucune"];
const AMENAGEMENTS  = ["PAP", "PPS", "PPRE", "PAI"];
const STAGE_STATUTS = ["Trouvé", "En recherche", "Aucun"];
const CONVENTIONS   = ["Signées", "Circulent", "Aucune"];
const FICHES        = ["Rendues", "Non rendues"];
const LIVRET        = ["Rendu", "Non rendu"];
const PREPA_ORAL    = ["Réalisée", "Non réalisée"];
const IFST          = ["I", "F", "S", "TS"];
const RECOMPENSES   = ["Félicitations", "Compliments", "Encouragements", "Alerte", "Rien"];
const ORIENTATIONS  = ["2nde GT", "2nde PRO", "1ère CAP", "CFA", "À définir"];
const MENTIONS_DNB  = [
  "Admis", "Admis Mention Assez Bien", "Admis Mention Bien",
  "Admis Mention Très Bien", "Admis Mention Félicitations du Jury", "Refusé"
];
const REUNIONS = ["rentrée", "octobre", "T1", "orientation", "T2", "affectation"];
const TRIMESTRES = ["T1", "T2", "T3"];

/* -------------------------------------------------------
   ÉTAT LOCAL
------------------------------------------------------- */

let anneeActiveId  = null;
let ppClasses      = [];    // [{ id, nom }]
let ppClasseActive = null;  // { id, nom }
let ppEleves       = [];    // [{ id, prenom, nom, genre, adaptations }]

let ppSuivi        = {};    // eleveId → pp_suivi row
let ppSuiviTri     = {};    // eleveId → { T1: row, T2: row, T3: row }
let ppReunions     = {};    // eleveId → { rentrée: bool, ... }

let eleveActif     = null;  // objet élève courant
let triActif       = "T1";

/* -------------------------------------------------------
   SUPABASE
------------------------------------------------------- */

function sbAgoram() {
  if (!window.sb) throw new Error("Supabase non initialisé.");
  return window.sb.schema("agoram");
}

async function getActiveAnneeId() {
  if (anneeActiveId) return anneeActiveId;
  const { data, error } = await sbAgoram()
    .from("annees").select("id").eq("active", true).maybeSingle();
  if (error) throw new Error(`Lecture annees impossible. ${error.message}`);
  anneeActiveId = data?.id || null;
  return anneeActiveId;
}

async function getPPClasses() {
  const anneeId = await getActiveAnneeId();
  if (!anneeId) return [];
  const { data, error } = await sbAgoram()
    .from("classes")
    .select("id, nom")
    .eq("annee_id", anneeId)
    .eq("is_pp", true)
    .order("nom");
  if (error) throw new Error(`Lecture classes PP impossible. ${error.message}`);
  return data || [];
}

async function getElevesPP(classeId) {
  const { data, error } = await sbAgoram()
    .from("eleves")
    .select("id, prenom, nom, genre, adaptations")
    .eq("classe_id", classeId)
    .order("nom");
  if (error) throw new Error(`Lecture élèves impossible. ${error.message}`);
  return (data || []).map(e => ({
    ...e,
    adaptations: Array.isArray(e.adaptations) ? e.adaptations : [],
  }));
}

async function chargerDonneesEleve(eleveId) {
  const anneeId = await getActiveAnneeId();

  // pp_suivi (annuel)
  const { data: suivi } = await sbAgoram()
    .from("pp_suivi")
    .select("*")
    .eq("eleve_id", eleveId)
    .eq("annee_id", anneeId)
    .maybeSingle();
  ppSuivi[eleveId] = suivi || {};

  // pp_suivi_trimestre
  const { data: tris } = await sbAgoram()
    .from("pp_suivi_trimestre")
    .select("*")
    .eq("eleve_id", eleveId)
    .eq("annee_id", anneeId);
  ppSuiviTri[eleveId] = {};
  (tris || []).forEach(t => { ppSuiviTri[eleveId][t.trimestre] = t; });

  // pp_reunions
  const { data: reuns } = await sbAgoram()
    .from("pp_reunions")
    .select("*")
    .eq("eleve_id", eleveId)
    .eq("annee_id", anneeId);
  ppReunions[eleveId] = {};
  (reuns || []).forEach(r => { ppReunions[eleveId][r.reunion] = r.present; });
}

async function upsertSuivi(eleveId, data) {
  const anneeId = await getActiveAnneeId();
  const { error } = await sbAgoram()
    .from("pp_suivi")
    .upsert({ eleve_id: eleveId, annee_id: anneeId, ...data },
             { onConflict: "eleve_id,annee_id" });
  if (error) throw new Error(`Sauvegarde pp_suivi impossible. ${error.message}`);
  ppSuivi[eleveId] = { ...(ppSuivi[eleveId] || {}), ...data };
}

async function upsertSuiviTri(eleveId, trimestre, data) {
  const anneeId = await getActiveAnneeId();
  const { error } = await sbAgoram()
    .from("pp_suivi_trimestre")
    .upsert({ eleve_id: eleveId, annee_id: anneeId, trimestre, ...data },
             { onConflict: "eleve_id,annee_id,trimestre" });
  if (error) throw new Error(`Sauvegarde pp_suivi_trimestre impossible. ${error.message}`);
  if (!ppSuiviTri[eleveId]) ppSuiviTri[eleveId] = {};
  ppSuiviTri[eleveId][trimestre] = { ...(ppSuiviTri[eleveId][trimestre] || {}), ...data };
}

async function upsertReunion(eleveId, reunion, present) {
  const anneeId = await getActiveAnneeId();
  const { error } = await sbAgoram()
    .from("pp_reunions")
    .upsert({ eleve_id: eleveId, annee_id: anneeId, reunion, present },
             { onConflict: "eleve_id,annee_id,reunion" });
  if (error) throw new Error(`Sauvegarde réunion impossible. ${error.message}`);
  if (!ppReunions[eleveId]) ppReunions[eleveId] = {};
  ppReunions[eleveId][reunion] = present;
}

/* -------------------------------------------------------
   UTILITAIRES UI
------------------------------------------------------- */

function btn(label, active, dataAttrs = "") {
  return `<button type="button" class="btn-choix ${active ? "active" : ""}" ${dataAttrs}>${label}</button>`;
}

function groupeBtns(vals, currentVal, dataKey) {
  return `<div class="choix-groupe">${vals.map(v =>
    btn(v, v === currentVal, `data-${dataKey}="${v}"`)
  ).join("")}</div>`;
}

function badgeStatut(eleveId) {
  const s = ppSuivi[eleveId] || {};
  const rentree = s.rentree_terminee ? "✅" : "⚪";
  const stage   = s.stage_terminee   ? "✅" : "⚪";
  const t1 = ppSuiviTri[eleveId]?.T1 ? "🟠" : "⚪";
  const t2 = ppSuiviTri[eleveId]?.T2 ? "🟠" : "⚪";
  const t3 = ppSuiviTri[eleveId]?.T3 ? "🟠" : "⚪";
  return `<span title="Rentrée">${rentree}</span>
          <span title="Stage">${stage}</span>
          <span title="T1">${t1}</span>
          <span title="T2">${t2}</span>
          <span title="T3">${t3}</span>`;
}

/* -------------------------------------------------------
   RENDER PRINCIPAL
------------------------------------------------------- */

export async function renderPP() {
  ppClasses = await getPPClasses();

  if (!ppClasses.length) {
    return `
      <div class="page page-pp">
        <h1>Prof Principal</h1>
        <p>Aucune classe PP définie. Cochez une classe comme PP dans la page Classes HG.</p>
      </div>
    `;
  }

  if (!ppClasseActive) ppClasseActive = ppClasses[0];
  ppEleves = await getElevesPP(ppClasseActive.id);

  return `
    <div class="page page-pp">

      <div class="pp-topbar">
        <h1>Prof Principal</h1>
        <label>Classe :
          <select id="ppClasseSelect">
            ${ppClasses.map(c => `
              <option value="${c.id}" data-nom="${c.nom}"
                ${c.id === ppClasseActive.id ? "selected" : ""}>${c.nom}
              </option>`).join("")}
          </select>
        </label>
      </div>

      <div class="pp-liste" id="ppListe">
        ${renderListePP()}
      </div>

      <div id="ppMenuSheet" class="pp-sheet" style="display:none;"></div>
      <div id="ppOverlay" class="pp-overlay" style="display:none;"></div>
      <div id="ppModal" class="pp-modal-wrap" style="display:none;"></div>

    </div>
  `;
}

function renderListePP() {
  if (!ppEleves.length) return "<p>Aucun élève dans cette classe.</p>";
  return ppEleves.map(e => `
    <div class="pp-row" data-eleveid="${e.id}" role="button" tabindex="0" style="cursor:pointer;">
      <div class="pp-row-info">
        <span class="pp-nom">${e.prenom} ${e.nom}</span>
        <span class="pp-badges">${badgeStatut(e.id)}</span>
      </div>
    </div>
  `).join("");
}

/* -------------------------------------------------------
   MENU BOTTOM SHEET
------------------------------------------------------- */

function ouvrirMenu(eleve) {
  eleveActif = eleve;
  const sheet = document.getElementById("ppMenuSheet");
  const overlay = document.getElementById("ppOverlay");

  const s = ppSuivi[eleve.id] || {};

  sheet.innerHTML = `
    <div class="pp-sheet-inner">
      <div class="pp-sheet-titre">${eleve.prenom} ${eleve.nom}</div>
      <button class="pp-sheet-btn" data-modale="rentree">
        📋 Rentrée ${s.rentree_terminee ? "✅" : "⚪"}
      </button>
      <button class="pp-sheet-btn" data-modale="stage">
        🏢 Stage ${s.stage_terminee ? "✅" : "⚪"}
      </button>
      <button class="pp-sheet-btn" data-modale="suivi">
        📊 Suivi trimestre
      </button>
      <button class="pp-sheet-btn" data-modale="dnb">
        📄 DNB blanc
      </button>
      <button class="pp-sheet-btn" data-modale="bilan">
        👤 Bilan
      </button>
      <button class="pp-sheet-fermer" id="ppSheetFermer">Fermer</button>
    </div>
  `;

  sheet.style.display = "block";
  overlay.style.display = "block";

  sheet.querySelectorAll("[data-modale]").forEach(b => {
    b.addEventListener("click", () => {
      fermerMenu();
      ouvrirModale(b.dataset.modale);
    });
  });

  document.getElementById("ppSheetFermer").addEventListener("click", fermerMenu);
  overlay.addEventListener("click", fermerMenu);
}

function fermerMenu() {
  document.getElementById("ppMenuSheet").style.display = "none";
  document.getElementById("ppOverlay").style.display = "none";
}

/* -------------------------------------------------------
   DISPATCH MODALES
------------------------------------------------------- */

function ouvrirModale(type) {
  const wrap = document.getElementById("ppModal");
  wrap.style.display = "block";

  switch (type) {
    case "rentree": wrap.innerHTML = renderModaleRentree(); bindModaleRentree(); break;
    case "stage":   wrap.innerHTML = renderModaleStage();   bindModaleStage();   break;
    case "suivi":   wrap.innerHTML = renderModaleSuivi();   bindModaleSuivi();   break;
    case "dnb":     wrap.innerHTML = renderModaleDNB();     bindModaleDNB();     break;
    case "bilan":   wrap.innerHTML = renderModaleBilan();   bindModaleBilan();   break;
  }
}

function fermerModale() {
  document.getElementById("ppModal").style.display = "none";
  refreshListe();
}

function headerModale(titre) {
  return `
    <div class="pp-modal">
      <div class="pp-modal-head">
        <h2>${titre} — ${eleveActif.prenom} ${eleveActif.nom}</h2>
        <button class="pp-modal-close" id="ppModalClose">✕</button>
      </div>
      <div class="pp-modal-body">
  `;
}

const footerModale = (saveId) => `
      </div>
      <div class="pp-modal-foot">
        <button class="btn-save" id="${saveId}">💾 Enregistrer</button>
      </div>
    </div>
  `;

/* -------------------------------------------------------
   MODALE RENTRÉE
------------------------------------------------------- */

function renderModaleRentree() {
  const s = ppSuivi[eleveActif.id] || {};
  const amenags = Array.isArray(s.amenagements) ? s.amenagements : [];

  return headerModale("Rentrée") + `
    <div class="pp-section">
      <label class="pp-label">LV1</label>
      ${groupeBtns(LV1_OPTIONS, s.lv1, "lv1")}
    </div>
    <div class="pp-section">
      <label class="pp-label">LV2</label>
      ${groupeBtns(LV2_OPTIONS, s.lv2, "lv2")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Option facultative</label>
      ${groupeBtns(OPTIONS_FAC, s.option_facultative, "optionfac")}
    </div>
    <div class="pp-section">
      <label class="pp-label">CFG</label>
      ${groupeBtns(["Oui", "Non"], s.cfg ? "Oui" : (s.cfg === false ? "Non" : null), "cfg")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Aménagements (multi-choix)</label>
      <div class="choix-groupe" id="amenagGroupeRentree">
        ${AMENAGEMENTS.map(a =>
          `<button type="button" class="btn-choix ${amenags.includes(a) ? "active" : ""}"
            data-amenag="${a}">${a}</button>`
        ).join("")}
      </div>
    </div>
    <div class="pp-section">
      <label class="pp-label">AESH</label>
      ${groupeBtns(["Oui", "Non"], s.aesh ? "Oui" : (s.aesh === false ? "Non" : null), "aesh")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Droit image</label>
      ${groupeBtns(["Oui", "Non"], s.droit_image ? "Oui" : (s.droit_image === false ? "Non" : null), "droitimage")}
    </div>
    <div class="pp-section">
      <label class="pp-label pp-terminee">
        <input type="checkbox" id="rentreeTerminee" ${s.rentree_terminee ? "checked" : ""}>
        Rentrée terminée ✅
      </label>
    </div>
  ` + footerModale("saveRentree");
}

function bindModaleRentree() {
  document.getElementById("ppModalClose").addEventListener("click", fermerModale);

  // Multi-select aménagements
  document.querySelectorAll("[data-amenag]").forEach(b => {
    b.addEventListener("click", () => b.classList.toggle("active"));
  });

  // Boutons radio simples
  ["lv1","lv2","optionfac","cfg","aesh","droitimage"].forEach(key => {
    document.querySelectorAll(`[data-${key}]`).forEach(b => {
      b.addEventListener("click", () => {
        document.querySelectorAll(`[data-${key}]`).forEach(x => x.classList.remove("active"));
        b.classList.add("active");
      });
    });
  });

  document.getElementById("saveRentree").addEventListener("click", async () => {
    const get = (key) => document.querySelector(`[data-${key}].active`)?.dataset[key] || null;
    const amenags = [...document.querySelectorAll("[data-amenag].active")].map(b => b.dataset.amenag);
    try {
      await upsertSuivi(eleveActif.id, {
        lv1:               get("lv1"),
        lv2:               get("lv2"),
        option_facultative: get("optionfac"),
        cfg:               get("cfg") === "Oui",
        amenagements:      amenags,
        aesh:              get("aesh") === "Oui",
        droit_image:       get("droitimage") === "Oui",
        rentree_terminee:  document.getElementById("rentreeTerminee").checked,
      });
      fermerModale();
    } catch(e) { alert("Erreur : " + e.message); }
  });
}

/* -------------------------------------------------------
   MODALE STAGE
------------------------------------------------------- */

function renderModaleStage() {
  const s = ppSuivi[eleveActif.id] || {};
  return headerModale("Stage") + `
    <div class="pp-section">
      <label class="pp-label">Statut stage</label>
      ${groupeBtns(STAGE_STATUTS, s.stage_statut, "stagestatut")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Conventions</label>
      ${groupeBtns(CONVENTIONS, s.stage_conventions, "stageconv")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Fiches tuteurs</label>
      ${groupeBtns(FICHES, s.stage_fiches_tuteurs, "stagefich")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Livret</label>
      ${groupeBtns(LIVRET, s.stage_livret, "stagelivret")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Préparation oral</label>
      ${groupeBtns(PREPA_ORAL, s.stage_preparation_oral, "stageprepa")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Note oral (0–100)</label>
      <input type="number" id="stageNoteOral" min="0" max="100"
        value="${s.stage_note_oral ?? ""}" class="pp-input-num">
    </div>
    <div class="pp-section">
      <label class="pp-label pp-terminee">
        <input type="checkbox" id="stageTerminee" ${s.stage_terminee ? "checked" : ""}>
        Stage terminé ✅
      </label>
    </div>
  ` + footerModale("saveStage");
}

function bindModaleStage() {
  document.getElementById("ppModalClose").addEventListener("click", fermerModale);

  ["stagestatut","stageconv","stagefich","stagelivret","stageprepa"].forEach(key => {
    document.querySelectorAll(`[data-${key}]`).forEach(b => {
      b.addEventListener("click", () => {
        document.querySelectorAll(`[data-${key}]`).forEach(x => x.classList.remove("active"));
        b.classList.add("active");
      });
    });
  });

  document.getElementById("saveStage").addEventListener("click", async () => {
    const get = (key) => document.querySelector(`[data-${key}].active`)?.dataset[key] || null;
    const note = parseInt(document.getElementById("stageNoteOral").value);
    try {
      await upsertSuivi(eleveActif.id, {
        stage_statut:          get("stagestatut"),
        stage_conventions:     get("stageconv"),
        stage_fiches_tuteurs:  get("stagefich"),
        stage_livret:          get("stagelivret"),
        stage_preparation_oral: get("stageprepa"),
        stage_note_oral:       isNaN(note) ? null : note,
        stage_terminee:        document.getElementById("stageTerminee").checked,
      });
      fermerModale();
    } catch(e) { alert("Erreur : " + e.message); }
  });
}

/* -------------------------------------------------------
   MODALE SUIVI TRIMESTRE
------------------------------------------------------- */

function renderModaleSuivi() {
  const tri = ppSuiviTri[eleveActif.id]?.[triActif] || {};
  const reuns = ppReunions[eleveActif.id] || {};
  const s = ppSuivi[eleveActif.id] || {};

  const numChamp = (label, val) =>
    `<div class="pp-stat"><span class="pp-stat-label">${label}</span>
     <span class="pp-stat-val">${val ?? "—"}</span></div>`;

  const moyChamp = (label, val) =>
    `<div class="pp-stat"><span class="pp-stat-label">${label}</span>
     <span class="pp-stat-val">${val != null ? Number(val).toFixed(2) : "—"}</span></div>`;

  return headerModale("Suivi") + `
    <div class="pp-tri-tabs" id="ppTriTabs">
      ${TRIMESTRES.map(t =>
        `<button class="pp-tri-tab ${t === triActif ? "active" : ""}" data-tri="${t}">${t}</button>`
      ).join("")}
    </div>

    <div class="pp-section">
      <label class="pp-label">Assiduité et comportement (données importées)</label>
      <div class="pp-stats-row">
        ${numChamp("Absences", tri.absences)}
        ${numChamp("Retards", tri.retards)}
        ${numChamp("Punitions", tri.punitions)}
        ${numChamp("Sanctions", tri.sanctions)}
      </div>
    </div>

    <div class="pp-section">
      <label class="pp-label">Moyennes (données importées)</label>
      <div class="pp-stats-row">
        ${moyChamp("Générale", tri.moyenne)}
        ${moyChamp("Français", tri.moy_francais)}
        ${moyChamp("Maths", tri.moy_maths)}
        ${moyChamp("HG", tri.moy_hg)}
        ${moyChamp("SVT", tri.moy_svt)}
        ${moyChamp("PC", tri.moy_pc)}
        ${moyChamp("Techno", tri.moy_techno)}
        ${moyChamp("EPS", tri.moy_eps)}
        ${moyChamp("LV1", tri.moy_lv1)}
        ${moyChamp("LV2", tri.moy_lv2)}
        ${moyChamp("LCEE", tri.moy_lcee)}
        ${moyChamp("LCEA", tri.moy_lcea)}
        ${moyChamp("Arts", tri.moy_arts)}
        ${moyChamp("Musique", tri.moy_musique)}
      </div>
    </div>

    <div class="pp-section">
      <label class="pp-label">Niveau Sciences</label>
      ${groupeBtns(IFST, tri.niveau_sc, "niveausc")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Niveau Littéraire</label>
      ${groupeBtns(IFST, tri.niveau_litt, "niveaulitt")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Niveau Langues</label>
      ${groupeBtns(IFST, tri.niveau_lang, "niveaulang")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Niveau Arts</label>
      ${groupeBtns(IFST, tri.niveau_art, "niveauart")}
    </div>
    <div class="pp-section">
      <label class="pp-label">Niveau EPS</label>
      ${groupeBtns(IFST, tri.niveau_eps, "niveaueps")}
    </div>

    <div class="pp-section">
      <label class="pp-label">Récompense / Alerte</label>
      ${groupeBtns(RECOMPENSES, tri.recompense, "recompense")}
    </div>

    <div class="pp-section">
      <label class="pp-label">Orientation</label>
      ${groupeBtns(ORIENTATIONS, tri.orientation, "orientation")}
    </div>

    ${triActif === "T2" ? `
    <div class="pp-section">
      <label class="pp-label">Mention DNB blanc</label>
      <div class="choix-groupe">
        ${MENTIONS_DNB.map(m =>
          btn(m, tri.mention_dnb_blanc === m, `data-mentionDnb="${m}"`)
        ).join("")}
      </div>
    </div>
    ` : ""}

    <div class="pp-section">
      <label class="pp-label">Présence parents aux réunions</label>
      <div class="pp-reunions-grid">
        ${REUNIONS.map(r => `
          <div class="pp-reunion-row">
            <span class="pp-reunion-label">${r.charAt(0).toUpperCase() + r.slice(1)}</span>
            <button type="button"
              class="btn-choix ${reuns[r] === true ? "active" : ""}"
              data-reunion="${r}" data-val="present">Présent</button>
            <button type="button"
              class="btn-choix ${reuns[r] === false ? "active" : ""}"
              data-reunion="${r}" data-val="absent">Absent</button>
          </div>
        `).join("")}
      </div>
    </div>
  ` + footerModale("saveSuivi");
}

function bindModaleSuivi() {
  document.getElementById("ppModalClose").addEventListener("click", fermerModale);

  // Onglets trimestre
  document.querySelectorAll(".pp-tri-tab").forEach(b => {
    b.addEventListener("click", () => {
      triActif = b.dataset.tri;
      document.getElementById("ppModal").innerHTML = renderModaleSuivi();
      bindModaleSuivi();
    });
  });

  // Boutons radio simples
  ["niveausc","niveaulitt","niveaulang","niveauart","niveaueps","recompense","orientation"].forEach(key => {
    document.querySelectorAll(`[data-${key}]`).forEach(b => {
      b.addEventListener("click", () => {
        document.querySelectorAll(`[data-${key}]`).forEach(x => x.classList.remove("active"));
        b.classList.add("active");
      });
    });
  });

  // Mention DNB (T2)
  document.querySelectorAll("[data-mentionDnb]").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-mentionDnb]").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
  });

  // Réunions (présent/absent par réunion)
  document.querySelectorAll("[data-reunion]").forEach(b => {
    b.addEventListener("click", () => {
      const r = b.dataset.reunion;
      document.querySelectorAll(`[data-reunion="${r}"]`).forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
  });

  document.getElementById("saveSuivi").addEventListener("click", async () => {
    const get = (key) => document.querySelector(`[data-${key}].active`)?.dataset[key] || null;

    try {
      // Sauvegarder données trimestre
      const triData = {
        niveau_sc:   get("niveausc"),
        niveau_litt: get("niveaulitt"),
        niveau_lang: get("niveaulang"),
        niveau_art:  get("niveauart"),
        niveau_eps:  get("niveaueps"),
        recompense:  get("recompense"),
        orientation: get("orientation"),
      };
      if (triActif === "T2") {
        triData.mention_dnb_blanc = get("mentionDnb");
      }
      await upsertSuiviTri(eleveActif.id, triActif, triData);

      // Sauvegarder réunions
      for (const r of REUNIONS) {
        const actif = document.querySelector(`[data-reunion="${r}"].active`);
        if (actif) {
          await upsertReunion(eleveActif.id, r, actif.dataset.val === "present");
        }
      }

      fermerModale();
    } catch(e) { alert("Erreur : " + e.message); }
  });
}

/* -------------------------------------------------------
   MODALE DNB BLANC
------------------------------------------------------- */

function renderModaleDNB() {
  const s = ppSuivi[eleveActif.id] || {};
  const moy = (v) => v != null ? Number(v).toFixed(2) : "—";

  return headerModale("DNB blanc") + `
    <p class="pp-hint">Les notes sont importées via la page Import/Export.</p>
    <div class="pp-stats-row">
      <div class="pp-stat"><span class="pp-stat-label">Français</span>
        <span class="pp-stat-val">${moy(s.dnb_francais)}</span></div>
      <div class="pp-stat"><span class="pp-stat-label">Maths</span>
        <span class="pp-stat-val">${moy(s.dnb_maths)}</span></div>
      <div class="pp-stat"><span class="pp-stat-label">HG</span>
        <span class="pp-stat-val">${moy(s.dnb_hg)}</span></div>
      <div class="pp-stat"><span class="pp-stat-label">Sciences</span>
        <span class="pp-stat-val">${moy(s.dnb_sciences)}</span></div>
    </div>
    <div class="pp-section">
      <label class="pp-label">Résultat</label>
      <div class="pp-stat-val pp-resultat">${s.dnb_resultat || "—"}</div>
    </div>
    <div class="pp-modal-foot">
      <button class="btn-save" id="ppModalClose2">Fermer</button>
    </div>
  </div></div>
  `;
}

function bindModaleDNB() {
  document.getElementById("ppModalClose").addEventListener("click", fermerModale);
  document.getElementById("ppModalClose2")?.addEventListener("click", fermerModale);
}

/* -------------------------------------------------------
   MODALE BILAN
------------------------------------------------------- */

function renderModaleBilan() {
  const s  = ppSuivi[eleveActif.id] || {};
  const tr = ppSuiviTri[eleveActif.id] || {};
  const re = ppReunions[eleveActif.id] || {};
  const e  = eleveActif;

  const moy = (v) => v != null ? Number(v).toFixed(2) : "—";
  const bool = (v) => v === true ? "Oui" : v === false ? "Non" : "—";
  const val  = (v) => v || "—";

  const ligneNiveaux = (t) => {
    const d = tr[t] || {};
    return `<tr>
      <td>${t}</td>
      <td>${val(d.niveau_sc)}</td><td>${val(d.niveau_litt)}</td>
      <td>${val(d.niveau_lang)}</td><td>${val(d.niveau_art)}</td>
      <td>${val(d.niveau_eps)}</td><td>${val(d.recompense)}</td>
      <td>${val(d.orientation)}</td>
    </tr>`;
  };

  const ligneMoyennes = (t) => {
    const d = tr[t] || {};
    return `<tr>
      <td>${t}</td>
      <td>${moy(d.moyenne)}</td>
      <td>${moy(d.moy_francais)}</td><td>${moy(d.moy_maths)}</td>
      <td>${moy(d.moy_hg)}</td><td>${moy(d.moy_svt)}</td>
      <td>${moy(d.moy_eps)}</td><td>${moy(d.absences)}</td>
      <td>${moy(d.retards)}</td>
    </tr>`;
  };

  return headerModale("Bilan") + `

    <div class="pp-bilan-section">
      <h3>Rentrée</h3>
      <div class="pp-bilan-grid">
        <div><b>LV1</b> ${val(s.lv1)}</div>
        <div><b>LV2</b> ${val(s.lv2)}</div>
        <div><b>Option</b> ${val(s.option_facultative)}</div>
        <div><b>CFG</b> ${bool(s.cfg)}</div>
        <div><b>Aménagements</b> ${(s.amenagements || []).join(", ") || "Aucun"}</div>
        <div><b>AESH</b> ${bool(s.aesh)}</div>
        <div><b>Droit image</b> ${bool(s.droit_image)}</div>
      </div>
    </div>

    <div class="pp-bilan-section">
      <h3>Stage</h3>
      <div class="pp-bilan-grid">
        <div><b>Statut</b> ${val(s.stage_statut)}</div>
        <div><b>Conventions</b> ${val(s.stage_conventions)}</div>
        <div><b>Fiches tuteurs</b> ${val(s.stage_fiches_tuteurs)}</div>
        <div><b>Livret</b> ${val(s.stage_livret)}</div>
        <div><b>Prépa oral</b> ${val(s.stage_preparation_oral)}</div>
        <div><b>Note oral</b> ${s.stage_note_oral ?? "—"}</div>
      </div>
    </div>

    <div class="pp-bilan-section">
      <h3>Moyennes et assiduité</h3>
      <table class="pp-bilan-table">
        <thead>
          <tr><th>Tri</th><th>Moy</th><th>Fr</th><th>Ma</th><th>HG</th>
              <th>SVT</th><th>EPS</th><th>Abs</th><th>Ret</th></tr>
        </thead>
        <tbody>
          ${["T1","T2","T3"].map(ligneMoyennes).join("")}
        </tbody>
      </table>
    </div>

    <div class="pp-bilan-section">
      <h3>Niveaux et orientation</h3>
      <table class="pp-bilan-table">
        <thead>
          <tr><th>Tri</th><th>SC</th><th>Litt</th><th>Lang</th>
              <th>Art</th><th>EPS</th><th>Récomp.</th><th>Orientation</th></tr>
        </thead>
        <tbody>
          ${["T1","T2","T3"].map(ligneNiveaux).join("")}
        </tbody>
      </table>
    </div>

    <div class="pp-bilan-section">
      <h3>DNB blanc</h3>
      <div class="pp-bilan-grid">
        <div><b>Français</b> ${moy(s.dnb_francais)}</div>
        <div><b>Maths</b> ${moy(s.dnb_maths)}</div>
        <div><b>HG</b> ${moy(s.dnb_hg)}</div>
        <div><b>Sciences</b> ${moy(s.dnb_sciences)}</div>
        <div><b>Résultat</b> ${val(s.dnb_resultat)}</div>
      </div>
    </div>

    <div class="pp-bilan-section">
      <h3>Réunions parents</h3>
      <div class="pp-reunions-bilan">
        ${REUNIONS.map(r => `
          <div class="pp-reunion-bilan">
            <span>${r.charAt(0).toUpperCase() + r.slice(1)}</span>
            <span>${re[r] === true ? "✅" : re[r] === false ? "❌" : "—"}</span>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="pp-modal-foot">
      <button class="btn-save" id="ppBilanClose">Fermer</button>
    </div>
  </div></div>
  `;
}

function bindModaleBilan() {
  document.getElementById("ppModalClose").addEventListener("click", fermerModale);
  document.getElementById("ppBilanClose")?.addEventListener("click", fermerModale);
}

/* -------------------------------------------------------
   REFRESH LISTE
------------------------------------------------------- */

function refreshListe() {
  const liste = document.getElementById("ppListe");
  if (liste) {
    liste.innerHTML = renderListePP();
    bindListeEvents();
  }
}

/* -------------------------------------------------------
   EVENTS PRINCIPAUX
------------------------------------------------------- */

export function bindPPEvents() {
  document.getElementById("ppClasseSelect")?.addEventListener("change", async e => {
    const opt = e.target.selectedOptions[0];
    ppClasseActive = { id: opt.value, nom: opt.dataset.nom };
    ppEleves = await getElevesPP(ppClasseActive.id);
    ppSuivi = {}; ppSuiviTri = {}; ppReunions = {};
    refreshListe();
  });

  bindListeEvents();
}

function bindListeEvents() {
  document.querySelectorAll(".pp-row[data-eleveid]").forEach(row => {
    row.addEventListener("click", async () => {
      const eleveId = row.dataset.eleveid;
      const eleve = ppEleves.find(e => e.id === eleveId);
      if (!eleve) return;

      if (!ppSuivi[eleveId]) {
        await chargerDonneesEleve(eleveId);
      }

      ouvrirMenu(eleve);
    });
  });
}
