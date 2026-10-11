#!/usr/bin/env bash
set -euo pipefail
npm ci --prefix ghostgrid-backend --include=dev --omit=optional
npm run build --prefix ghostgrid-backend
npm ci --prefix ghostgrid-frontend/frontend --include=dev
npm run build --prefix ghostgrid-frontend/frontend
