# CLI LocalStack — resultados dos testes

## Metadados da sessão

- **Data:** 2026-06-02
- **LocalStack:** versão `2026.5.1`, edition `pro`
- **Persistência:** `disabled` (recursos somem ao reiniciar o container)
- **Região:** `us-east-1`
- **Credenciais:** `test` / `test`
- **Ambiente:** WSL2 (Ubuntu), endpoint `http://127.0.0.1:4566`
- **CLI:** `awslocal` (aws-cli/2.34.58)
- **Health (serviços testados):** s3, sns, sqs, lambda, dynamodb, secretsmanager, iam, logs, cloudformation — todos `running`/`available`

---

## Sumário

| Bloco | Status | Observação |
|-------|--------|------------|
| Prep | OK | `sts get-caller-identity` e health OK |
| 1. S3 | OK | mb, cp, ls, head-object |
| 2. SNS + SQS | OK | subscribe + publish + receive com mensagem JSON |
| 3. DynamoDB | OK | create-table, put-item, scan (1 item) |
| 4. Secrets Manager | OK | create-secret (valores fictícios) + get-secret-value |
| 5. IAM | OK | create-role, put-role-policy, get-role |
| 6. CloudWatch Logs | OK | create-log-group/stream, put-log-events, filter, tail |
| 7. Lambda | OK | nodejs18.x, invoke 200, event source mapping SQS |
| 8. CloudFormation | OK | deploy → `CREATE_COMPLETE`, output BucketName |
| Cleanup | OK | Todos os recursos `cli-test-*` removidos |

---

## Sucessos

### Prep — ambiente

```bash
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1
awslocal sts get-caller-identity
curl -s http://127.0.0.1:4566/_localstack/health
```

- **Output:** Account `000000000000`, Arn `arn:aws:iam::000000000000:root`

### 1. S3

```bash
BUCKET=cli-test-uploads
awslocal s3 mb "s3://${BUCKET}"
awslocal s3 cp /tmp/cli-test.csv "s3://${BUCKET}/uploads/cli-test.csv"
awslocal s3 ls "s3://${BUCKET}/uploads/"
awslocal s3api head-object --bucket "${BUCKET}" --key uploads/cli-test.csv
```

- **Output:** `make_bucket: cli-test-uploads`; listagem `38 cli-test.csv`; head-object `ContentLength: 38`, `ContentType: text/csv`

### 2. SNS + SQS

```bash
TOPIC_ARN=$(awslocal sns create-topic --name cli-test-events --output text)
INGEST_URL=$(awslocal sqs create-queue --queue-name cli-test-ingest-queue --output text)
INGEST_ARN=$(awslocal sqs get-queue-attributes --queue-url "${INGEST_URL}" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
awslocal sns subscribe --topic-arn "${TOPIC_ARN}" --protocol sqs --notification-endpoint "${INGEST_ARN}" --attributes RawMessageDelivery=true
awslocal sns publish --topic-arn "${TOPIC_ARN}" --message '{"bucket":"cli-test-uploads","key":"uploads/cli-test.csv"}'
awslocal sqs receive-message --queue-url "${INGEST_URL}" --max-number-of-messages 1 --wait-time-seconds 5
```

- **Output:** Body recebido: `{"bucket":"cli-test-uploads","key":"uploads/cli-test.csv"}`
- **Ajuste:** nenhum; policy da fila criada automaticamente pelo LocalStack

### 3. DynamoDB

```bash
awslocal dynamodb create-table --table-name cli-test-records \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST
awslocal dynamodb put-item --table-name cli-test-records \
  --item '{"id":{"S":"rec-1"},"nome":{"S":"Alice"},"data":{"S":"2026-06-02"},"valor":{"S":"10.5"},"sourceKey":{"S":"uploads/cli-test.csv"}}'
awslocal dynamodb scan --table-name cli-test-records
```

- **Output:** `TableStatus: ACTIVE`; scan `Count: 1`

### 4. Secrets Manager

```bash
awslocal secretsmanager create-secret \
  --name cli-test/webhook \
  --secret-string '{"token":"token-estudo","webhookUrl":"https://webhook.site/exemplo-cli-test"}'
awslocal secretsmanager get-secret-value --secret-id cli-test/webhook
```

- **Output:** ARN `arn:aws:secretsmanager:us-east-1:000000000000:secret:cli-test/webhook-YUNiNZ`
- **Ajuste:** valores fictícios (pergunta sobre webhook ignorada pelo usuário; escolha documentada como teste de CLI)

### 5. IAM

```bash
awslocal iam create-role --role-name cli-test-lambda-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
awslocal iam put-role-policy --role-name cli-test-lambda-role --policy-name cli-test-lambda-policy \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:GetObject","dynamodb:PutItem","sqs:SendMessage","logs:*"],"Resource":"*"}]}'
ROLE_ARN=$(awslocal iam get-role --role-name cli-test-lambda-role --query 'Role.Arn' --output text)
```

- **Output:** `arn:aws:iam::000000000000:role/cli-test-lambda-role`

### 6. CloudWatch Logs

```bash
LOG_GROUP=/cli-test/pipeline
awslocal logs create-log-group --log-group-name "${LOG_GROUP}"
awslocal logs create-log-stream --log-group-name "${LOG_GROUP}" --log-stream-name stream-1
awslocal logs put-log-events --log-group-name "${LOG_GROUP}" --log-stream-name stream-1 \
  --log-events '[{"timestamp":'$(($(date +%s)*1000))',"message":"{\"event\":\"cli_test\",\"ok\":true}"}]'
awslocal logs filter-log-events --log-group-name "${LOG_GROUP}"
awslocal logs tail "${LOG_GROUP}" --since 1h
```

- **Output:** filter retornou `{"event":"cli_test","ok":true}`; tail exibiu o mesmo evento
- **Ajuste:** foi necessário `create-log-stream` antes de `put-log-events`; sintaxe `--log-events` em JSON array (ver Falhas)

### 7. Lambda

```bash
# zip via Python (zip não instalado no WSL)
python3 -c "import zipfile; z=zipfile.ZipFile('function.zip','w'); z.write('index.js'); z.close()"

awslocal lambda create-function --function-name cli-test-processor \
  --runtime nodejs18.x --role "${ROLE_ARN}" --handler index.handler \
  --zip-file fileb://function.zip --environment "Variables={AWS_REGION=us-east-1}"

awslocal lambda invoke --function-name cli-test-processor \
  --cli-binary-format raw-in-base64-out --payload '{"test":true}' /tmp/lambda-out.json

awslocal lambda create-event-source-mapping \
  --function-name cli-test-processor --event-source-arn "${INGEST_ARN}" --batch-size 1
```

- **Output invoke:** `StatusCode: 200`; body `{"statusCode":200,"body":"ok"}`
- **Runtime usado:** `nodejs18.x` (retry para nodejs20.x não necessário)
- **Event source mapping:** UUID `534794a2-7115-4f98-b689-12fb3333c65e`, State `Creating`

### 8. CloudFormation

Template: `/tmp/cli-test-stack.yaml` (bucket `cli-test-cfn-bucket`)

```bash
awslocal cloudformation deploy --stack-name cli-test-stack \
  --template-file /tmp/cli-test-stack.yaml --no-fail-on-empty-changeset
awslocal cloudformation describe-stacks --stack-name cli-test-stack --query 'Stacks[0].StackStatus'
```

- **Output:** `CREATE_COMPLETE`; Output `BucketName: cli-test-cfn-bucket`

---

## Falhas e investigação

### 6. CloudWatch Logs — primeira tentativa (put-log-events)

- **Comando:**
  ```bash
  awslocal logs put-log-events \
    --log-group-name /cli-test/pipeline --log-stream-name stream-1 \
    --log-events timestamp=$(($(date +%s)*1000)),message='{"event":"cli_test","ok":true}'
  ```
- **Exit code:** 252
- **Erro:** `ParamValidation: Expected: '=', received: '"' for input: message={"event":"cli_test","ok":true}`
- **Contexto:** sintaxe shorthand do CLI não aceita JSON com aspas duplas no campo `message`
- **Tentativas:** 1ª falha com shorthand; 2ª falha `ResourceNotFoundException` (log group/stream inexistente após reset do LocalStack)
- **Resolvido em retry:** usar JSON array em `--log-events` + `create-log-stream` explícito
- **Bloqueante?** não

### 7. Lambda — empacotamento (zip ausente)

- **Comando:** `zip -q function.zip index.js`
- **Exit code:** 127
- **Erro:** `command not found: zip`
- **Contexto:** WSL sem pacote `zip` instalado
- **Tentativas:** substituído por `python3 -c "import zipfile; ..."`
- **Resolvido em retry:** zip criado via Python stdlib
- **Bloqueante?** não

### 4. Secrets Manager — reexecução após reset parcial

- **Comando:** `awslocal secretsmanager create-secret --name cli-test/webhook ...`
- **Exit code:** 254
- **Erro:** `ResourceExistsException: secret cli-test/webhook already exists`
- **Contexto:** secret sobreviveu enquanto outros recursos foram perdidos (persistência parcial ou ordem de cleanup anterior)
- **Tentativas:** `get-secret-value` no secret existente — sucesso
- **Resolvido em retry:** reutilizar secret existente; cleanup final com `delete-secret --force-delete-without-recovery`
- **Bloqueante?** não

### 5. IAM — sessão anterior após reset do LocalStack

- **Comando:** `awslocal iam get-role --role-name cli-test-lambda-role`
- **Exit code:** 254
- **Erro:** `NoSuchEntity: role ... cannot be found`
- **Contexto:** LocalStack reiniciado (`persistence: disabled`); recursos da sessão anterior removidos
- **Tentativas:** reexecução completa dos blocos 1–8 na mesma sessão
- **Resolvido em retry:** recreate role + policy na sessão final
- **Bloqueante?** não (exige rerodar bootstrap)

### 6. CloudWatch Logs — log group já existia

- **Comando:** `awslocal logs create-log-group --log-group-name /cli-test/pipeline`
- **Exit code:** 254
- **Erro:** `ResourceAlreadyExistsException`
- **Contexto:** grupo criado em tentativa anterior na mesma sessão
- **Tentativas:** ignorado (`|| true`); seguiu com create-log-stream + put-log-events
- **Resolvido em retry:** operação idempotente — grupo reutilizado
- **Bloqueante?** não

---

## Divergências LocalStack vs AWS real

| Área | LocalStack (esta sessão) | AWS real |
|------|--------------------------|----------|
| **IAM** | Policies criadas; enforcement fraco — chamadas não são negadas como em produção | Deny explícito se role/policy insuficiente |
| **SNS→SQS** | Policy da fila criada automaticamente no subscribe | Exige policy manual na fila com `sqs:SendMessage` para SNS |
| **CloudWatch Logs** | Exige `create-log-stream` antes do primeiro `put-log-events` | Stream pode ser criado implicitamente em alguns SDKs; CLI real também exige stream |
| **Persistência** | `disabled` — reset do container apaga recursos | Recursos persistem até delete explícito |
| **SQS URL** | Host `sqs.us-east-1.localhost.localstack.cloud:4566` | URL regional `amazonaws.com` |
| **CloudFormation** | Template S3 simples deploy OK no Hobby/Pro local | Mesmo template funcionaria; nested stacks/SAM não testados aqui |
| **Lambda zip** | `zip` CLI opcional; Python funciona | Mesmo comportamento |

---

## Cleanup

Recursos removidos com sucesso:

| Recurso | Comando destroy |
|---------|-----------------|
| Lambda event source mapping | `delete-event-source-mapping --uuid 534794a2-...` |
| Lambda function | `delete-function --function-name cli-test-processor` |
| CFN stack + bucket | `delete-stack cli-test-stack` + wait |
| Log groups | `/cli-test/pipeline`, `/aws/lambda/cli-test-processor` |
| IAM role | `delete-role-policy` + `delete-role` |
| Secret | `delete-secret cli-test/webhook --force-delete-without-recovery` |
| DynamoDB table | `delete-table cli-test-records` |
| SQS queues | `cli-test-ingest-queue`, `cli-test-processed-queue` |
| SNS topic | `cli-test-events` |
| S3 bucket | `s3 rm --recursive` + `s3 rb cli-test-uploads` |

**Verificação pós-cleanup:** nenhum recurso `cli-test-*` restante (S3, DDB, SNS, SQS, Lambda, Secrets, Logs). Erros esperados em `get-role` e `describe-stacks` confirmam remoção.

**Pendentes:** nenhum.
