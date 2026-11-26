#!/data/data/com.termux/files/usr/bin/bash
# BANA user site + admin -> GitHub (GitHub Actions then builds and publishes both).
# Usage: bash deploy-site-termux.sh
set -e
cd "$(dirname "$0")"
command -v git >/dev/null || pkg install -y git
if [ ! -d .git ]; then
  git init -b main
  echo "Repo URL (e.g. https://github.com/movilover/Bana.git):"; read -r URL
  git remote add origin "$URL"
fi
git add -A
git commit -m "Deploy BANA user site + admin" || true
git push -u origin main
echo "Done. GitHub > Settings > Pages > Source = GitHub Actions. Watch the Actions tab."
