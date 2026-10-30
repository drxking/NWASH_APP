#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source scripts/env.sh
node --version
java -version
npm ci
printf '\nDependencies installed. Run npm start, then npm run android in another terminal.\n'
