#!/usr/bin/env bash
# =============================================================================
# destroy.sh — Remove recursos criados pelo bootstrap.sh (imperativo)
# =============================================================================
# Ordem inversa de dependências: Lambda → IAM → filas → tópico → etc.
# Idempotente: ignora recursos que já não existem.
# =============================================================================
set -euo pipefail

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

BUCKET="csv-uploads"
TOPIC_NAME="csv-upload-events"
INGEST_QUEUE="csv-ingest-queue"
TABLE_NAME="CsvRecords"
SECRET_NAME="study/webhook"
LAMBDA_ROLE="csv-processor-lambda-role"
LAMBDA_NAME="csv-processor"
LOG_GROUP="/study/csv-pipeline"

echo "=============================================="
echo " Destroy CSV Pipeline (bootstrap/imperativo)"
echo "=============================================="

# Lambda — event source mappings primeiro
echo "[1] Lambda ${LAMBDA_NAME}"
if awslocal lambda get-function --function-name "${LAMBDA_NAME}" >/dev/null 2>&1; then
  for uuid in $(awslocal lambda list-event-source-mappings \
    --function-name "${LAMBDA_NAME}" \
    --query 'EventSourceMappings[].UUID' --output text 2>/dev/null); do
    awslocal lambda delete-event-source-mapping --uuid "${uuid}" 2>/dev/null || true
  done
  awslocal lambda delete-function --function-name "${LAMBDA_NAME}" 2>/dev/null || true
  echo "  -> Lambda removida."
else
  echo "  -> Lambda não encontrada."
fi

# Log groups
echo "[2] CloudWatch Log Groups"
for lg in "${LOG_GROUP}" "/aws/lambda/${LAMBDA_NAME}"; do
  awslocal logs delete-log-group --log-group-name "${lg}" 2>/dev/null && echo "  -> ${lg} removido." || true
done

# IAM
echo "[3] IAM role ${LAMBDA_ROLE}"
awslocal iam delete-role-policy --role-name "${LAMBDA_ROLE}" --policy-name csv-processor-policy 2>/dev/null || true
awslocal iam delete-role --role-name "${LAMBDA_ROLE}" 2>/dev/null && echo "  -> Role removida." || true

# Secret
echo "[4] Secret ${SECRET_NAME}"
awslocal secretsmanager delete-secret \
  --secret-id "${SECRET_NAME}" \
  --force-delete-without-recovery 2>/dev/null && echo "  -> Secret removido." || true

# DynamoDB
echo "[5] DynamoDB ${TABLE_NAME}"
awslocal dynamodb delete-table --table-name "${TABLE_NAME}" 2>/dev/null && echo "  -> Tabela removida." || true

# SQS
echo "[6] SQS queues"
for q in "${INGEST_QUEUE}"; do
  URL=$(awslocal sqs get-queue-url --queue-name "${q}" --query 'QueueUrl' --output text 2>/dev/null || echo "")
  if [[ -n "${URL}" && "${URL}" != "None" ]]; then
    awslocal sqs delete-queue --queue-url "${URL}" 2>/dev/null && echo "  -> ${q} removida." || true
  fi
done

# SNS
echo "[7] SNS topic ${TOPIC_NAME}"
TOPIC_ARN=$(awslocal sns list-topics \
  --query "Topics[?contains(TopicArn, '${TOPIC_NAME}')].TopicArn | [0]" --output text 2>/dev/null || echo "None")
if [[ "${TOPIC_ARN}" != "None" && -n "${TOPIC_ARN}" ]]; then
  awslocal sns delete-topic --topic-arn "${TOPIC_ARN}" 2>/dev/null && echo "  -> Tópico removido." || true
fi

# S3
echo "[8] S3 bucket ${BUCKET}"
awslocal s3 rm "s3://${BUCKET}" --recursive 2>/dev/null || true
awslocal s3 rb "s3://${BUCKET}" 2>/dev/null && echo "  -> Bucket removido." || true

echo ""
echo "Destroy concluído."
