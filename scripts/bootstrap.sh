#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — Provisionamento IMPERATIVO dos recursos AWS no LocalStack
# =============================================================================
# Este script cria o ambiente de estudo passo a passo via awslocal (AWS CLI).
# É idempotente: recursos já existentes são reutilizados em vez de falhar.
#
# Pré-requisitos:
#   - LocalStack rodando em http://127.0.0.1:4566
#   - awslocal instalado
#   - python3 (empacotamento da Lambda)
#
# Referência de comandos: docs/CLI-LOCALSTACK.md
# =============================================================================
set -euo pipefail

# --- Variáveis fixas do projeto de estudo ------------------------------------
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

BUCKET="csv-uploads"
TOPIC_NAME="csv-upload-events"
INGEST_QUEUE="csv-ingest-queue"
PROCESSED_QUEUE="csv-processed-queue"
TABLE_NAME="CsvRecords"
SECRET_NAME="study/webhook"
LAMBDA_ROLE="csv-processor-lambda-role"
LAMBDA_NAME="csv-processor"
LOG_GROUP="/study/csv-pipeline"

# Endpoint interno Docker — Lambda roda em container filho do LocalStack.
# localstack-main nem sempre resolve via DNS; localhost.localstack.cloud é estável.
# Fallback documentado no README: IP do container (docker inspect localstack-main).
LAMBDA_ENDPOINT="${LAMBDA_ENDPOINT:-http://localhost.localstack.cloud:4566}"

# Secret padrão (troque webhookUrl pelo UUID real do webhook.site antes do teste)
WEBHOOK_TOKEN="${WEBHOOK_TOKEN:-token-estudo}"
WEBHOOK_URL="${WEBHOOK_URL:-https://webhook.site/853bdadd-9ebf-42b2-b33e-7d7b6a959922}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=============================================="
echo " Bootstrap CSV Pipeline — LocalStack (imperativo)"
echo " Região: ${AWS_DEFAULT_REGION}"
echo "=============================================="

# =============================================================================
# 1. S3 — bucket para uploads CSV
# =============================================================================
echo ""
echo "[1/9] S3 bucket: ${BUCKET}"
if awslocal s3api head-bucket --bucket "${BUCKET}" 2>/dev/null; then
  echo "  -> Bucket já existe, reutilizando."
else
  awslocal s3 mb "s3://${BUCKET}"
  echo "  -> Bucket criado."
fi

# =============================================================================
# 2. SNS — tópico de eventos de upload
# =============================================================================
echo ""
echo "[2/9] SNS topic: ${TOPIC_NAME}"
TOPIC_ARN=$(awslocal sns create-topic --name "${TOPIC_NAME}" --output text 2>/dev/null || true)
if [[ -z "${TOPIC_ARN}" ]]; then
  TOPIC_ARN=$(awslocal sns list-topics --query "Topics[?contains(TopicArn, '${TOPIC_NAME}')].TopicArn | [0]" --output text)
fi
echo "  -> Topic ARN: ${TOPIC_ARN}"

# =============================================================================
# 3. SQS — filas de ingestão e processamento
# =============================================================================
echo ""
echo "[3/9] SQS queues: ${INGEST_QUEUE}, ${PROCESSED_QUEUE}"

INGEST_URL=$(awslocal sqs get-queue-url --queue-name "${INGEST_QUEUE}" --query 'QueueUrl' --output text 2>/dev/null || true)
if [[ -z "${INGEST_URL}" || "${INGEST_URL}" == "None" ]]; then
  INGEST_URL=$(awslocal sqs create-queue --queue-name "${INGEST_QUEUE}" --output text)
fi

PROCESSED_URL=$(awslocal sqs get-queue-url --queue-name "${PROCESSED_QUEUE}" --query 'QueueUrl' --output text 2>/dev/null || true)
if [[ -z "${PROCESSED_URL}" || "${PROCESSED_URL}" == "None" ]]; then
  PROCESSED_URL=$(awslocal sqs create-queue --queue-name "${PROCESSED_QUEUE}" --output text)
fi

INGEST_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "${INGEST_URL}" \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' --output text)

echo "  -> Ingest URL:    ${INGEST_URL}"
echo "  -> Processed URL: ${PROCESSED_URL}"

# =============================================================================
# 4. SNS → SQS — subscription com RawMessageDelivery
#    RawMessageDelivery=true entrega o JSON do SNS direto no body da fila
#    (sem envelope SNS), facilitando o parse na Lambda.
# =============================================================================
echo ""
echo "[4/9] SNS → SQS subscription (RawMessageDelivery)"

EXISTING_SUB=$(awslocal sns list-subscriptions-by-topic \
  --topic-arn "${TOPIC_ARN}" \
  --query "Subscriptions[?Endpoint=='${INGEST_ARN}'].SubscriptionArn | [0]" \
  --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_SUB}" != "None" && -n "${EXISTING_SUB}" ]]; then
  echo "  -> Subscription já existe: ${EXISTING_SUB}"
else
  SUB_ARN=$(awslocal sns subscribe \
    --topic-arn "${TOPIC_ARN}" \
    --protocol sqs \
    --notification-endpoint "${INGEST_ARN}" \
    --attributes RawMessageDelivery=true \
    --output text)
  echo "  -> Subscription criada: ${SUB_ARN}"
fi

# Policy na fila (boa prática AWS real; LocalStack costuma funcionar sem)
POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "sns.amazonaws.com"},
    "Action": "sqs:SendMessage",
    "Resource": "${INGEST_ARN}",
    "Condition": {"ArnEquals": {"aws:SourceArn": "${TOPIC_ARN}"}}
  }]
}
EOF
)
awslocal sqs set-queue-attributes \
  --queue-url "${INGEST_URL}" \
  --attributes Policy="${POLICY}" 2>/dev/null || true

# =============================================================================
# 5. DynamoDB — tabela CsvRecords
# =============================================================================
echo ""
echo "[5/9] DynamoDB table: ${TABLE_NAME}"

if awslocal dynamodb describe-table --table-name "${TABLE_NAME}" >/dev/null 2>&1; then
  echo "  -> Tabela já existe, reutilizando."
else
  awslocal dynamodb create-table \
    --table-name "${TABLE_NAME}" \
    --attribute-definitions AttributeName=id,AttributeType=S \
    --key-schema AttributeName=id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST
  echo "  -> Tabela criada."
fi

# =============================================================================
# 6. Secrets Manager — credenciais do webhook
# =============================================================================
echo ""
echo "[6/9] Secrets Manager: ${SECRET_NAME}"

SECRET_JSON=$(cat <<EOF
{"token":"${WEBHOOK_TOKEN}","webhookUrl":"${WEBHOOK_URL}"}
EOF
)

if awslocal secretsmanager describe-secret --secret-id "${SECRET_NAME}" >/dev/null 2>&1; then
  awslocal secretsmanager put-secret-value \
    --secret-id "${SECRET_NAME}" \
    --secret-string "${SECRET_JSON}" >/dev/null
  echo "  -> Secret atualizado."
else
  awslocal secretsmanager create-secret \
    --name "${SECRET_NAME}" \
    --secret-string "${SECRET_JSON}" >/dev/null
  echo "  -> Secret criado."
fi

SECRET_ARN=$(awslocal secretsmanager describe-secret \
  --secret-id "${SECRET_NAME}" \
  --query 'ARN' --output text)

# =============================================================================
# 7. IAM — role da Lambda (estudo; LocalStack não aplica enforcement forte)
# =============================================================================
echo ""
echo "[7/9] IAM role: ${LAMBDA_ROLE}"

TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}'

if awslocal iam get-role --role-name "${LAMBDA_ROLE}" >/dev/null 2>&1; then
  echo "  -> Role já existe, reutilizando."
else
  awslocal iam create-role \
    --role-name "${LAMBDA_ROLE}" \
    --assume-role-policy-document "${TRUST_POLICY}" >/dev/null
  echo "  -> Role criada."
fi

ROLE_ARN=$(awslocal iam get-role --role-name "${LAMBDA_ROLE}" --query 'Role.Arn' --output text)

# Policy inline com permissões mínimas para o fluxo
INLINE_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::${BUCKET}/*"
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:${AWS_DEFAULT_REGION}:000000000000:table/${TABLE_NAME}"
    },
    {
      "Effect": "Allow",
      "Action": ["sqs:SendMessage"],
      "Resource": "arn:aws:sqs:${AWS_DEFAULT_REGION}:000000000000:${PROCESSED_QUEUE}"
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:${AWS_DEFAULT_REGION}:000000000000:*"
    }
  ]
}
EOF
)

awslocal iam put-role-policy \
  --role-name "${LAMBDA_ROLE}" \
  --policy-name csv-processor-policy \
  --policy-document "${INLINE_POLICY}" >/dev/null
echo "  -> Policy inline aplicada."

# =============================================================================
# 8. Lambda — empacota, cria função e conecta fila ingest → Lambda
# =============================================================================
echo ""
echo "[8/9] Lambda: ${LAMBDA_NAME}"

cd "${PROJECT_DIR}/lambda"
npm run package
ZIP_FILE="${PROJECT_DIR}/lambda/dist/function.zip"

if awslocal lambda get-function --function-name "${LAMBDA_NAME}" >/dev/null 2>&1; then
  awslocal lambda update-function-code \
    --function-name "${LAMBDA_NAME}" \
    --zip-file "fileb://${ZIP_FILE}" >/dev/null
  awslocal lambda update-function-configuration \
    --function-name "${LAMBDA_NAME}" \
    --environment "Variables={AWS_ENDPOINT_URL=${LAMBDA_ENDPOINT},DYNAMODB_TABLE=${TABLE_NAME},PROCESSED_QUEUE_URL=${PROCESSED_URL},AWS_REGION=${AWS_DEFAULT_REGION}}" >/dev/null
  echo "  -> Função atualizada."
else
  awslocal lambda create-function \
    --function-name "${LAMBDA_NAME}" \
    --runtime nodejs18.x \
    --role "${ROLE_ARN}" \
    --handler handler.handler \
    --zip-file "fileb://${ZIP_FILE}" \
    --timeout 30 \
    --environment "Variables={AWS_ENDPOINT_URL=${LAMBDA_ENDPOINT},DYNAMODB_TABLE=${TABLE_NAME},PROCESSED_QUEUE_URL=${PROCESSED_URL},AWS_REGION=${AWS_DEFAULT_REGION}}" >/dev/null
  echo "  -> Função criada."
fi

# Aguarda função sair de Pending (necessário no LocalStack)
awslocal lambda wait function-active-v2 --function-name "${LAMBDA_NAME}" 2>/dev/null || sleep 3

# Event source mapping: fila ingest dispara a Lambda automaticamente
EXISTING_ESM=$(awslocal lambda list-event-source-mappings \
  --function-name "${LAMBDA_NAME}" \
  --query "EventSourceMappings[?EventSourceArn=='${INGEST_ARN}'].UUID | [0]" \
  --output text 2>/dev/null || echo "None")

if [[ "${EXISTING_ESM}" != "None" && -n "${EXISTING_ESM}" ]]; then
  echo "  -> Event source mapping já existe: ${EXISTING_ESM}"
else
  ESM_UUID=$(awslocal lambda create-event-source-mapping \
    --function-name "${LAMBDA_NAME}" \
    --event-source-arn "${INGEST_ARN}" \
    --batch-size 1 \
    --enabled \
    --query 'UUID' --output text)
  echo "  -> Event source mapping criado: ${ESM_UUID}"
fi

# =============================================================================
# 9. CloudWatch Logs — log group da API (Lambda cria /aws/lambda/ automaticamente)
# =============================================================================
echo ""
echo "[9/9] CloudWatch Log Group: ${LOG_GROUP}"

if awslocal logs describe-log-groups --log-group-name-prefix "${LOG_GROUP}" \
  --query "logGroups[?logGroupName=='${LOG_GROUP}']" --output text | grep -q "${LOG_GROUP}"; then
  echo "  -> Log group já existe."
else
  awslocal logs create-log-group --log-group-name "${LOG_GROUP}"
  echo "  -> Log group criado."
fi

# =============================================================================
# Outputs — copie para api/.env
# =============================================================================
echo ""
echo "=============================================="
echo " Bootstrap concluído! Copie para api/.env:"
echo "=============================================="
cat <<EOF

AWS_ENDPOINT_URL=http://127.0.0.1:4566
AWS_REGION=${AWS_DEFAULT_REGION}
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

S3_BUCKET=${BUCKET}
SNS_TOPIC_ARN=${TOPIC_ARN}
INGEST_QUEUE_URL=${INGEST_URL}
PROCESSED_QUEUE_URL=${PROCESSED_URL}
DYNAMODB_TABLE=${TABLE_NAME}
SECRET_NAME=${SECRET_NAME}
LOG_GROUP_NAME=${LOG_GROUP}
PORT=3000

EOF

echo "Dica: defina WEBHOOK_URL=https://webhook.site/SEU-UUID antes de rodar o bootstrap"
echo "      ou atualize o secret manualmente com awslocal secretsmanager put-secret-value"
