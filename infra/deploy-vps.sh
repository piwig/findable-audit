#!/usr/bin/env bash
# Deploiement de findable.bordebat.fr sur le VPS. A lancer SUR le VPS :
#   ssh vps 'bash /opt/findable-audit/infra/deploy-vps.sh'
#
# Ce script existe parce que la procedure ne vivait nulle part : elle etait rejouee
# a la main a chaque fois, et l'etape IndexNow etait donc toujours oubliee. pb-ot.fr
# pingue IndexNow a chaque deploiement depuis juillet ; findable ne le faisait pas,
# et n'etait present dans aucun index Bing le 2026-07-27.
set -euo pipefail

ROOT=/opt/findable-audit
ORIGIN=https://findable.bordebat.fr
# Publique par construction : le protocole IndexNow exige qu'elle soit lisible a la
# racine du site, c'est cette lisibilite meme qui prouve qu'on controle le domaine.
KEY=ee645ca362f1983ad6257479b7c02a67

cd "$ROOT"
echo "== avant : $(git rev-parse --short HEAD)"
git pull --ff-only
echo "== apres : $(git rev-parse --short HEAD)"

npm ci --no-audit --no-fund
npm run build --workspaces

systemctl restart findable-web
sleep 4
systemctl is-active --quiet findable-web || { echo "!! findable-web n'est pas actif"; exit 1; }

# Verifie que le site repond avant d'annoncer ses URLs aux moteurs : soumettre des
# pages qui renvoient 5xx est le meilleur moyen de se faire deprioriser.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$ORIGIN/fr/")
[ "$code" = "200" ] || { echo "!! $ORIGIN/fr/ repond $code, pas de soumission"; exit 1; }

# Dogfooding : on notifie les moteurs avec notre propre outil.
node "$ROOT/packages/cli/dist/index.js" "$ORIGIN/" \
  --max-pages 10 --submit --indexnow-key "$KEY" --no-report \
  | tail -3

echo "== deploiement termine"
