# 📘 AgoraMosaïque — Guide utilisateur v1.0

**AgoraMosaïque** est une application locale d’aide au suivi pédagogique et administratif en collège. Elle est conç---**AgoraMosaïque** est une application locale d’aide au suivi pédagogique et administratif en collège. Elle est conçue pour un usage réel d’enseignant, sans automatisme dangereux, avec une séparation claire des rôles (discipline / PP) et des exports directement exploitables.

## 🎯 Finalité

- Suivre les élèves **en situation de classe**
- Centraliser le **suivi disciplinaire d’Histoire‑Géographie**
- Assister la **rédaction des bulletins HG**
- Offrir un **cockpit Prof Principal (PP)**
- Produire des **exports exploitables** (Pronote, conseils de classe)
- **Clôturer une année** sans perte de données

👉 L’application **n’automatise pas le jugement** : elle **assiste** l’enseignant.

---

## 🧭 Organisation générale

AgoraMosaïque fonctionne comme une **application à page unique (SPA)**.  
Toutes les pages s’affichent dans une zone centrale accessible via la barre de navigation :

- Salle
- Classes HG
- Bulletins HG
- PP
- EDT
- Import / Export
- Archives

---

## 🟦 1. Page Salle

### Rôle

Saisie **en situation de classe**.

### Fonctions

- Marquage :
  - absences
  - retards
  - devoirs non faits
  - absences à un contrôle
- Saisie de la participation (fin d’heure)

### Règles

- ✅ Seul endroit de saisie de l’assiduité
- ❌ Aucun bulletin ici
- ❌ Aucune synthèse

---

## 🟦 2. Page Classes HG

### Rôle

Gestion pédagogique de la classe en Histoire‑Géographie.

### Fonctions

- Liste des élèves
- Gestion des places (glisser‑déposer)
- Accès au **profil élève HG**

---

## 🟦 3. Profil élève HG (modale)

### Rôle

Suivi disciplinaire **HG uniquement**, par période.

### Contenu

- Compétences HG (I / F / S / TS)
- Participation HG
- Adaptations HG spécifiques

### Règles

- ❌ Aucune assiduité
- ✅ Données utilisées pour les bulletins HG

---

## 🟦 4. Page Bulletins HG

### Rôle

Aide à la rédaction du bulletin d’Histoire‑Géographie.

### Fonctionnement

1. Sélection de l’élève et de la période
2. Génération d’une **proposition de bulletin**
3. Modification libre par l’enseignant
4. Validation du texte final

### Structure du bulletin

1. Adaptations (si présentes)
2. Niveau des acquisitions
3. Constat disciplinaire
4. Conseil (un seul axe prioritaire)

### Exports

- 📋 Copier‑coller direct vers Pronote
- 📄 CSV (une ligne par élève, bulletin finalisé)

---

## 🟦 5. Page Prof Principal (PP)

### Rôle

Suivi global de l’élève **hors HG**.

### Contenu

- Assiduité (synthèse)
- Comportement
- Orientation
- Stage (statut, oral)
- Examens (DNB blanc, PIX, ASSR2, Evalang, etc.)
- Niveaux scolaires globaux

### Imports CSV

- Notes de **DNB blanc**
- Note d’**oral de stage**

👉 Les notes ne sont **jamais saisies à la main**.

### Exports

- CSV pour conseils de classe

---

## 🟦 6. Page Import / Export

### Rôle

Entrée et sortie des données.

### Import

- Élèves (CSV)
- Mise à jour automatique des élèves existants

### Export

- Données élèves
- Bulletins
- Suivi PP

---

## 🟦 7. Page Emploi du temps (EDT)

### Rôle

Cadre temporel de l’année.

### Utilisation

- Référence pour la page Salle
- Aucune saisie pédagogique

---

## 🟦 8. Page Archives / Changement d’année

### Rôle

Clôture sécurisée de l’année scolaire.

### Sécurités

- Archivage autorisé **à partir d’une date**
- Texte à recopier obligatoirement
- Action irréversible

### Sauvegarde automatique

Avant archivage, l’application génère localement :

- CSV bulletins HG
- CSV suivi PP
- CSV structure élèves / classes

👉 Les données sont **stockées localement**, pas sur un serveur.

---

## 🎨 Interface & style

- Style **Art déco**
- Dominante **bleu roi**
- Liserés or
- Boutons rectangulaires
- Tables lisibles et sobres
- Modales homogènes

👉 Pensé pour un usage long (réunions, conseils, relectures).

---

## 🔐 Philosophie de l’outil

- Pas d’automatisme dangereux
- Pas de calculs opaques
- Pas de confusion PP / discipline
- Pas de dépendance cloud obligatoire
- Données **lisibles dans la durée**

---

## ✅ Version

**AgoraMosaïque v1.0**

- Logique métier figée
- Style figé
- Exports opérationnels
- Archivage sécurisé

Toute évolution ultérieure relève d’une **v1.1**, explicitement décidée.

