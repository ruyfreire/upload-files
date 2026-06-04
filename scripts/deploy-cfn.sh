#!/usr/bin/env bash
# =============================================================================
# deploy-cfn.sh — Provisionamento DECLARATIVO via CloudFormation
# =============================================================================
# Fluxo híbrido:
#   1. Empacota Lambda (npm run package)
#   2. Envia zip para bucket de artefatos
#   3. cloudformation deploy com template.yaml
#
# NÃO rode bootstrap.sh e deploy-cfn.sh ao mesmo tempo (mesmos nomes fixos).
# Use destroy.sh ou destroy-cfn.sh antes de trocar de método.
# =============================================================================
set -euo pipefail

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

STACK_NAME="${STACK_NAME:-csv-pipeline-study}"
ARTIFACTS_BUCKET="${ARTIFACTS_BUCKET:-csv-cfn-artifacts}"
LAMBDA_KEY="${LAMBDA_KEY:-csv-processor.zip}"

WEBHOOK_URL="${WEBHOOK_URL:-https://webhook.site/853bdadd-9ebf-42b2-b33e-7d7b6a959922}"
WEBHOOK_TOKEN="${WEBHOOK_TOKEN:-token-estudo}"
LAMBDA_ENDPOINT="${LAMBDA_ENDPOINT:-http://localhost.localstack.cloud:4566}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE="${PROJECT_DIR}/infrastructure/template.yaml"

echo "=============================================="
echo " Deploy CloudFormation — ${STACK_NAME}"
echo "=============================================="

# 1. Empacota Lambda
echo ""
echo "[1/4] Empacotando Lambda..."
cd "${PROJECT_DIR}/lambda"
npm run package
ZIP_FILE="${PROJECT_DIR}/lambda/dist/function.zip"

# 2. Bucket de artefatos (criado pelo template ou manualmente se stack parcial)
echo ""
echo "[2/4] Enviando zip para s3://${ARTIFACTS_BUCKET}/${LAMBDA_KEY}"
if ! awslocal s3api head-bucket --bucket "${ARTIFACTS_BUCKET}" 2>/dev/null; then
  awslocal s3 mb "s3://${ARTIFACTS_BUCKET}" 2>/dev/null || true
fi
awslocal s3 cp "${ZIP_FILE}" "s3://${ARTIFACTS_BUCKET}/${LAMBDA_KEY}"

# 3. Deploy da stack
echo ""
echo "[3/4] cloudformation deploy..."
awslocal cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --parameter-overrides \
    "LambdaS3Bucket=${ARTIFACTS_BUCKET}" \
    "LambdaS3Key=${LAMBDA_KEY}" \
    "WebhookUrl=${WEBHOOK_URL}" \
    "WebhookToken=${WEBHOOK_TOKEN}" \
    "LambdaEndpoint=${LAMBDA_ENDPOINT}" \
  --no-fail-on-empty-changeset \
  --capabilities CAPABILITY_NAMED_IAM

# Aguarda Lambda ativa após deploy
awslocal lambda wait function-active-v2 --function-name csv-processor 2>/dev/null || sleep 5

# 4. Outputs
echo ""
echo "[4/4] Outputs da stack:"
awslocal cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs' \
  --output table

echo ""
echo "=============================================="
echo " Copie para api/.env:"
echo "=============================================="

BUCKET=$(awslocal cloudformation describe-stacks --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)
SNS_ARN=$(awslocal cloudformation describe-stacks --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='SnsTopicArn'].OutputValue" --output text)
INGEST=$(awslocal cloudformation describe-stacks --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='IngestQueueUrl'].OutputValue" --output text)
PROCESSED=$(awslocal cloudformation describe-stacks --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='ProcessedQueueUrl'].OutputValue" --output text)
TABLE=$(awslocal cloudformation describe-stacks --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='DynamoTableName'].OutputValue" --output text)
LOG_GROUP=$(awslocal cloudformation describe-stacks --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='LogGroupName'].OutputValue" --output text)

cat <<EOF

AWS_ENDPOINT_URL=http://127.0.0.1:4566
AWS_REGION=${AWS_DEFAULT_REGION}
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

S3_BUCKET=${BUCKET}
SNS_TOPIC_ARN=${SNS_ARN}
INGEST_QUEUE_URL=${INGEST}
PROCESSED_QUEUE_URL=${PROCESSED}
DYNAMODB_TABLE=${TABLE}
SECRET_NAME=study/webhook
LOG_GROUP_NAME=${LOG_GROUP}
PORT=3000

EOF
