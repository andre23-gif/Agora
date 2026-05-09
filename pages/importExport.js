export function renderImportExport() {
  return `
    <section>

      <h1>Import / Export des données</h1>

      <p>
        Cette page permet de gérer l’entrée et la sortie des données
        de l’application.
      </p>

      <h2>Import des données</h2>

      <p>
        L’import permet d’ajouter ou de mettre à jour les informations
        des élèves à partir de fichiers CSV.
      </p>

      <p>
        Les données importées concernent notamment l’identité des élèves,
        leur classe, leur groupe, leurs aides et les éléments de suivi.
      </p>

      <p>
        Lors de l’import, chaque ligne du fichier est analysée.
        Les informations sont soit mises à jour,
        soit ajoutées lorsqu’elles n’existent pas encore.
      </p>

      <p>
        Les incohérences ou erreurs de format sont signalées
        avant l’enregistrement des données.
      </p>

      <h2>Export des données</h2>

      <p>
        L’export permet de récupérer les données enregistrées
        dans l’application sous forme de fichiers exploitables.
      </p>

      <p>
        Les exports peuvent être réalisés par classe,
        par période ou pour un élève donné.
      </p>

      <p>
        Les fichiers générés peuvent être utilisés
        pour l’archivage, l’analyse ou le partage des informations.
      </p>

      <p>
        Cette page centralise également les opérations
        liées à la sauvegarde des données d’une année scolaire.
      </p>

    </section>
  `;
}
