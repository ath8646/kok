#!/bin/bash
# 가짜 백엔드 환경변수로 앱을 빌드하고 3000 포트로 띄운다
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../.."
source "$HERE/env.sh"
npx next build
exec npx next start -p 3000
