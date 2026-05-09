export function renderImportExport() {
  return `
    <section>
      <h1>Import / Export des données</h1>

      <h2>Importer des données</h2>
      <p>
        Cette page permettra d’importer des fichiers CSV
        (élèves, aides, assiduité, etc.).
      </p>
      <p>
        L’import se fera en plusieurs étapes :
        aperçu du fichier, vérification des colonnes,
        puis validation.
      </p>

      <h2>Exporter des données</h2>
      <p>
        Cette page permettra d’exporter les données
        par classe, par période ou par élève,
        au format CSV ou PDF.
      </p>
    </section>
  `;
}
