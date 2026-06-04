#!/usr/bin/env bash
# Empacota a Lambda em dist/function.zip para upload ao LocalStack/AWS.
# Usa Python zipfile (mesmo padrão documentado em docs/CLI-LOCALSTACK.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAMBDA_DIR="$(dirname "$SCRIPT_DIR")"

cd "$LAMBDA_DIR"

echo ">> Instalando dependências da Lambda..."
npm install --omit=dev

echo ">> Gerando dist/function.zip..."
rm -rf dist
mkdir -p dist

python3 << 'PY'
import os
import zipfile

lambda_dir = os.getcwd()
dist_zip = os.path.join(lambda_dir, "dist", "function.zip")

def add_to_zip(zf, base_path, arc_prefix=""):
    for root, _, files in os.walk(base_path):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, base_path)
            arc = os.path.join(arc_prefix, rel).replace("\\", "/")
            zf.write(full, arc)

with zipfile.ZipFile(dist_zip, "w", zipfile.ZIP_DEFLATED) as zf:
    # handler na raiz do zip (create-function usa handler.handler)
    handler_path = os.path.join(lambda_dir, "src", "handler.js")
    zf.write(handler_path, "handler.js")
    add_to_zip(zf, os.path.join(lambda_dir, "node_modules"), "node_modules")

print(f"Pacote criado: {dist_zip} ({os.path.getsize(dist_zip)} bytes)")
PY
