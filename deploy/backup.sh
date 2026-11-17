#!/usr/bin/env bash
# Sauvegarde de Lamio : la base (comptes, conversations, messages) et les fichiers joints.
#   ./backup.sh [dossier de destination]
# À lancer chaque nuit avec cron, puis à copier hors du VPS.
set -euo pipefail
cd "$(dirname "$0")"

dest="${1:-$HOME/lamio-backups}"
stamp="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$dest"

# Copie cohérente de la base, même pendant que l'app écrit, puis archive avec les fichiers joints.
docker compose exec -T app sh -c '
  set -e
  cd /app
  node -e "const db = require(\"better-sqlite3\")(\"/data/app.db\", { readonly: true }); db.backup(\"/data/backup.db\").then(() => db.close())"
  cd /data
  tar -czf - backup.db files
  rm -f backup.db
' > "$dest/lamio-$stamp.tar.gz"

# Garde les 14 dernières sauvegardes.
ls -1t "$dest"/lamio-*.tar.gz | tail -n +15 | xargs -r rm --
echo "Sauvegarde : $dest/lamio-$stamp.tar.gz"
