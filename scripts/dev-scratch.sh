#!/bin/sh
export NEPAL_SAVES_DIR="/tmp/nepal-sprint7-scratch"
export NEPAL_E2E_ROLE_FIXTURE="1"
exec pnpm --filter @nepal-football-sim/desktop dev
