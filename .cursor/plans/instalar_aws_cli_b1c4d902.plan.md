---
name: Instalar e testar AWS CLI
overview: Instalar AWS CLI v2 e awscli-local no WSL e confirmar no terminal que os comandos existem.
todos:
  - id: install-aws-cli-v2
    content: Instalar AWS CLI v2 (instalador oficial)
    status: completed
  - id: install-awscli-local
    content: Instalar awscli-local (pip) e garantir awslocal no PATH
    status: completed
  - id: test-cli
    content: Rodar aws --version e awslocal --version no terminal
    status: completed
isProject: false
---

# Plano: instalar AWS CLI

## Objetivo

Instalar **AWS CLI v2** e **`awslocal`** no WSL e ver se os comandos respondem no terminal.

---

## 1. AWS CLI v2

```bash
cd /tmp
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip -q awscliv2.zip
sudo ./aws/install
aws --version
```

Esperado: saída com `aws-cli/2`.

---

## 2. awscli-local

```bash
pip install --user awscli-local
```

Se `awslocal` não for encontrado, incluir `~/.local/bin` no PATH e abrir um terminal novo:

```bash
export PATH="$HOME/.local/bin:$PATH"
awslocal --version
```

Esperado: versão do `awslocal` / AWS CLI, sem `command not found`.

---

## Pronto

Com `aws --version` e `awslocal --version` OK, a instalação está feita.
