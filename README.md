# Pipeline CSV com LocalStack — projeto de estudo AWS

Projeto didático que simula um pipeline de upload e processamento de CSV usando serviços AWS locais via [LocalStack](https://localstack.cloud/). Inclui **dois métodos de provisionamento** (shell imperativo e CloudFormation declarativo) para comparar abordagens.

## Arquitetura em uma frase

```
Cliente → API NestJS → S3 + SNS → SQS ingest → Lambda → DynamoDB + SQS processed → API → webhook.site
```

Diagramas em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Pré-requisitos

| Ferramenta | Uso |
|------------|-----|
| LocalStack (porta **4566**) | Emula S3, SNS, SQS, Lambda, DynamoDB, etc. |
| `awslocal` | Wrapper da AWS CLI apontando para LocalStack |
| Node.js 18+ | API NestJS e Lambda |
| python3 | Empacotamento do zip da Lambda |

Verifique o health:

```bash
awslocal sts get-caller-identity
```

Referência de comandos CLI: [`docs/CLI-LOCALSTACK.md`](docs/CLI-LOCALSTACK.md).

## Estrutura do projeto

```
upload-files/
├── arquivo.csv              # CSV de exemplo (nome,data,valor)
├── api/                     # API NestJS (upload, GET records, consumer SQS, webhook)
├── web/                     # Frontend Vite + React + shadcn (upload + tabela)
├── lambda/                  # Lambda Node.js (processa CSV)
├── infrastructure/          # template.yaml CloudFormation
├── scripts/                 # bootstrap, destroy, deploy-cfn, destroy-cfn
└── docs/
    ├── CLI-LOCALSTACK.md    # referência awslocal
    └── ARQUITETURA.md       # fluxo detalhado
```

## Escolha UM método de provisionamento

**Não rode `bootstrap.sh` e `deploy-cfn.sh` ao mesmo tempo** — usam os mesmos nomes de recursos (`csv-uploads`, `csv-processor`, etc.). Antes de trocar:

```bash
bash scripts/destroy.sh        # se usou bootstrap
bash scripts/destroy-cfn.sh    # se usou CloudFormation
```

### Caminho A — Imperativo (`bootstrap.sh`)

Cria recursos passo a passo via CLI (ideal para entender cada serviço):

```bash
# Opcional: configure webhook real antes do bootstrap
export WEBHOOK_URL=https://webhook.site/SEU-UUID
export WEBHOOK_TOKEN=token-estudo

bash scripts/bootstrap.sh
```

### Caminho B — Declarativo (`deploy-cfn.sh`)

Mesmos recursos via CloudFormation YAML:

```bash
export WEBHOOK_URL=https://webhook.site/SEU-UUID

bash scripts/deploy-cfn.sh
```

## Subir a API

```bash
# Copie os outputs impressos pelo script para api/.env
cp api/.env.example api/.env
# Edite api/.env com os valores corretos (filas, SNS ARN, etc.)

cd api
npm install
npm run start:dev
```

A API sobe em **http://localhost:3000**.

Endpoints principais:

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/upload` | Upload CSV (multipart, campo `file`) |
| GET | `/records?limit=100` | Lista registros do DynamoDB |

## Frontend (tela única)

Interface web com upload de CSV e tabela de registros (TanStack React Query para cache e refresh automático após upload).

```bash
cd web
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:3000
npm run dev
```

Abra **http://localhost:5173** — upload e listagem na mesma página. Após enviar um CSV, a tabela faz polling por até 30s enquanto a Lambda processa.

**Stack:** Vite, React, TypeScript, shadcn/ui, TanStack React Query.

## Testar o fluxo

```bash
# Upload do CSV de exemplo
curl -F "file=@arquivo.csv" http://localhost:3000/upload

# Listar registros (mesmo dado exibido no frontend)
curl http://localhost:3000/records

# Verificar S3
awslocal s3 ls s3://csv-uploads/uploads/

# Verificar DynamoDB (2 linhas do arquivo.csv)
awslocal dynamodb scan --table-name CsvRecords

# Logs da Lambda
awslocal logs tail /aws/lambda/csv-processor --since 10m

# Logs da API
awslocal logs tail /study/csv-pipeline --since 10m
```

### Webhook

1. Abra [webhook.site](https://webhook.site) e copie sua URL única.
2. Atualize o secret:

```bash
awslocal secretsmanager put-secret-value \
  --secret-id study/webhook \
  --secret-string '{"token":"token-estudo","webhookUrl":"https://webhook.site/SEU-UUID"}'
```

3. Reinicie a API (para limpar cache do secret) e faça novo upload.
4. Confira a requisição POST no painel do webhook.site.

## Endpoints e rede (WSL2 + Docker)

| Quem roda | Endpoint SDK |
|-----------|--------------|
| API NestJS (WSL/host) | `http://127.0.0.1:4566` |
| Lambda (container Docker) | `http://localhost.localstack.cloud:4566` |

Credenciais LocalStack: `test` / `test`, região **`us-east-1`**.

### Troubleshooting Lambda (rede Docker)

Se a Lambda falhar com `ENOTFOUND localstack-main` ou `ECONNREFUSED`:

1. **Padrão do projeto:** `http://localhost.localstack.cloud:4566`
2. **Fallback:** IP do container LocalStack:

```bash
docker inspect localstack-main --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
# Ex.: http://172.17.0.2:4566
export LAMBDA_ENDPOINT=http://172.17.0.2:4566
bash scripts/bootstrap.sh   # ou redeploy CFN
```

Para problemas genéricos de CLI/LocalStack, consulte [`docs/CLI-LOCALSTACK.md`](docs/CLI-LOCALSTACK.md).

## Limpeza

```bash
bash scripts/destroy.sh        # recursos do bootstrap
bash scripts/destroy-cfn.sh    # stack CloudFormation
```

## Serviços AWS utilizados

| Serviço | Recurso | Papel |
|---------|---------|-------|
| S3 | `csv-uploads` | Armazena CSVs enviados |
| SNS | `csv-upload-events` | Fan-out após upload |
| SQS | `csv-ingest-queue` | Dispara Lambda |
| SQS | `csv-processed-queue` | Resumo para a API |
| Lambda | `csv-processor` | Parse CSV → DynamoDB |
| DynamoDB | `CsvRecords` | Uma linha = um item |
| Secrets Manager | `study/webhook` | URL/token do webhook |
| CloudWatch Logs | `/study/csv-pipeline` | Rastreio da API |
| IAM | `csv-processor-lambda-role` | Permissões da Lambda |
| CloudFormation | `csv-pipeline-study` | Provisionamento declarativo |

## Upload via curl (alternativa ao frontend)
