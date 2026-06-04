/**
 * Lambda csv-processor — LocalStack/AWS
 *
 * Fluxo:
 *  1. Recebe evento SQS (mensagem veio do SNS com RawMessageDelivery)
 *  2. Baixa o CSV do S3
 *  3. Valida header (nome,data,valor) e grava cada linha no DynamoDB
 *  4. Publica resumo no tópico Kafka (csv.processed)
 */

const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { Kafka } = require("kafkajs");
const { parse } = require("csv-parse");
const { parse: parseSync } = require("csv-parse/sync");
const { randomUUID } = require("crypto");

// ---------------------------------------------------------------------------
// Configuração — endpoint Docker interno (localstack-main) via env do bootstrap
// ---------------------------------------------------------------------------
const REGION = process.env.AWS_REGION || "us-east-1";
const ENDPOINT = process.env.AWS_ENDPOINT_URL || process.env.S3_ENDPOINT;

const awsClientConfig = {
  region: REGION,
  ...(ENDPOINT
    ? {
        endpoint: ENDPOINT,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test",
        },
      }
    : {}),
};

const s3 = new S3Client(awsClientConfig);
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(awsClientConfig));

const TABLE_NAME = process.env.DYNAMODB_TABLE || "CsvRecords";
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || "host.docker.internal:19093").split(",");
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || "csv.processed";

/** Header esperado no CSV (arquivo.csv na raiz do repo) */
const EXPECTED_HEADER = ["nome", "data", "valor"];

function getBodyParsed(body) {
  try {
    if (typeof body !== "string") {
      throw new Error(`Body inválido: ${body}`);
    }

    const parsed = JSON.parse(body);

    if (typeof parsed !== "object" || parsed === null || Object.keys(parsed).length === 0) {
      throw new Error(`Body inválido: ${body}`);
    }

    const { bucket, key } = parsed;
    
    if (!bucket || !key) {
      throw new Error(`Payload SNS inválido: ${body}`);
    }

    return parsed;
  } catch (err) {
    return { bodyParseFailed: err.message };
  }
}

/**
 * Parser principal: consome o Body do S3 como stream.
 * Esta é a versão usada no fluxo real da Lambda.
 */
async function parseCsvStream(readableStream) {
  if (!readableStream || typeof readableStream.pipe !== "function") {
    throw new Error("Body do S3 inválido: stream não disponível");
  }

  const rows = [];
  // columns true faz as rows vir como objetos com o header como keys. EX: { nome: 'produto A', data: '2026-05-20', valor: '12000' }
  const parser = readableStream.pipe(parse({ columns: true, skip_empty_lines: true, trim: true }));

  for await (const row of parser) {
    rows.push(row);
  }

  return rows;
}

/**
 * Versão sync mantida apenas para referência.
 * É simples para arquivos pequenos, mas carrega todo o CSV em memória antes de parsear.
 */
function parseCsvSync(content) {
  return parseSync(content, { columns: true, skip_empty_lines: true, trim: true });
}

async function publishSummaryToKafka(summary) {
  if (!KAFKA_BROKERS.length || !KAFKA_TOPIC) {
    throw new Error("KAFKA_BROKERS ou KAFKA_TOPIC não configurados");
  }

  const kafka = new Kafka({ clientId: "csv-processor", brokers: KAFKA_BROKERS });
  const producer = kafka.producer();

  try {
    await producer.connect();
    await producer.send({
      topic: KAFKA_TOPIC,
      messages: [
        {
          key: summary.correlationId || summary.sourceKey,
          value: JSON.stringify(summary),
        },
      ],
    });
  } finally {
    await producer.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Handler principal (entrypoint Lambda)
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  console.log(JSON.stringify({ event: "lambda_invoked", recordCount: event.Records?.length }));

  for (const record of event.Records || []) {
    const payload = getBodyParsed(record.body);

    try {
      if (payload.bodyParseFailed) {
        throw new Error(payload.bodyParseFailed);
      }

      const { bucket, key, uploadedAt, correlationId } = payload;

      console.log(JSON.stringify({ event: "processing_started", bucket, key, correlationId }));
    
      // 1. Download do S3: o Body vem como stream no SDK v3.
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const rows = await parseCsvStream(object.Body);
    
      // 2. PutItem por linha no DynamoDB
      const recordIds = [];
      const now = new Date().toISOString();

      for (const row of rows) {
        const id = randomUUID();
        recordIds.push(id);

        await dynamo.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: {
              id,
              nome: row.nome,
              data: row.data,
              valor: row.valor,
              sourceKey: key,
              uploadedAt: uploadedAt || now,
            },
          }),
        );
      }

      console.log(
        JSON.stringify({
          event: "dynamodb_written",
          key,
          recordsCount: recordIds.length,
          recordIds,
          correlationId,
        }),
      );

      const summary = {
        sourceKey: key,
        bucket,
        recordsCount: recordIds.length,
        recordIds,
        processedAt: now,
        correlationId,
      };

      await publishSummaryToKafka(summary);

      console.log(JSON.stringify({ event: "kafka_produced", topic: KAFKA_TOPIC, summary, correlationId }));

      return summary;
    } catch (err) {
      // Log estruturado — aparece em /aws/lambda/csv-processor no CloudWatch
      console.error(
        JSON.stringify({
          event: "processing_failed",
          messageId: record.messageId,
          error: err.message,
          correlationId: payload.correlationId,
          bodyParseFailedError: !!payload?.bodyParseFailed,
        }),
      );
      // Re-lança para SQS retry / DLQ (se configurada)
      throw err;
    }
  }

  return { statusCode: 200, body: "ok" };
};
