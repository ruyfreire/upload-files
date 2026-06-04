#!/usr/bin/env bash
# Remove a stack CloudFormation e aguarda conclusão
set -euo pipefail

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

STACK_NAME="${STACK_NAME:-csv-pipeline-study}"

echo "Deletando stack ${STACK_NAME}..."
awslocal cloudformation delete-stack --stack-name "${STACK_NAME}" 2>/dev/null || true

if awslocal cloudformation describe-stacks --stack-name "${STACK_NAME}" >/dev/null 2>&1; then
  echo "Aguardando stack-delete-complete..."
  awslocal cloudformation wait stack-delete-complete --stack-name "${STACK_NAME}" || true
fi

# Log group da Lambda (não gerenciado pelo template)
awslocal logs delete-log-group --log-group-name /aws/lambda/csv-processor 2>/dev/null || true

echo "Stack ${STACK_NAME} removida."
