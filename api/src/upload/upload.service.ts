import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PublishCommand } from '@aws-sdk/client-sns';
import { parse } from 'csv-parse/sync';
import { AWS_CLIENTS, AwsClients } from '../aws/aws.config';
import { CloudWatchLoggerService } from '../aws/cloudwatch-logger.service';
import { randomUUID } from 'crypto';

const EXPECTED_COLUMNS = ['nome', 'data', 'valor'];

async function validateCsvFile(file: Express.Multer.File) {
  try {
    const parser = parse<Record<string, unknown>>(file.buffer, { columns: true });
    for await (const row of parser) {
      const columns = Object.keys(row)
      if (columns.length !== EXPECTED_COLUMNS.length) {
        throw new BadRequestException(`colunas inválidas. Esperado: ${EXPECTED_COLUMNS.length} - Recebido: ${columns.length}`);
      }
      if (columns.some(column => !EXPECTED_COLUMNS.includes(column))) {
        throw new BadRequestException(`colunas inválidas. Esperado: ${EXPECTED_COLUMNS.join(', ')} - Recebido: ${columns.join(', ')}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido no parser CSV';
    throw new BadRequestException(`CSV inválido: ${message}`);
  }
}

/**
 * Orquestra o upload:
 *  1. PutObject no S3
 *  2. Publish no SNS (dispara pipeline: SNS → SQS ingest → Lambda)
 *
 * Não usamos S3 Event Notification — a API publica no SNS explicitamente
 * (mais estável no LocalStack e mesmo aprendizado de mensageria).
 */
@Injectable()
export class UploadService {
  constructor(
    @Inject(AWS_CLIENTS) private readonly aws: AwsClients,
    private readonly cwLogger: CloudWatchLoggerService,
  ) {}

  async handleUpload(file: Express.Multer.File): Promise<{ s3Key: string; messageId: string }> {
    const correlationId = randomUUID();
    const timestamp = Date.now();
    const s3Key = `uploads/${timestamp}-${file.originalname}`;

    await validateCsvFile(file);

    await this.cwLogger.log('upload_started', {
      correlationId,
      fileName: file.originalname,
      size: file.size,
      s3Key,
    });

    // 1. Envia CSV para o S3
    await this.aws.s3.send(
      new PutObjectCommand({
        Bucket: this.aws.config.bucket,
        Key: s3Key,
        Body: file.buffer,
        ContentType: 'text/csv',
      }),
    );

    await this.cwLogger.log('file_uploaded_to_s3', {
      correlationId,
      bucket: `s3://${this.aws.config.bucket}/${s3Key}`,
    });

    // 2. Publica evento no SNS — payload consumido pela Lambda via SQS
    const snsPayload = {
      bucket: this.aws.config.bucket,
      key: s3Key,
      uploadedAt: new Date().toISOString(),
      correlationId,
    };

    // Podia publicar direto no SQS, ou deixar o S3 publicar no SQS, ou até o S3 disparar a lambda. Tudo depende do que vai atender o cenário de uso.
    // Para este cenário, foi utilizado o fluxo completo, SNS > SQS > Lambda para aprendizado.
    const publishResult = await this.aws.sns.send(
      new PublishCommand({
        TopicArn: this.aws.config.snsTopicArn,
        Message: JSON.stringify(snsPayload),
      }),
    );

    const messageId = publishResult.MessageId || 'unknown';

    await this.cwLogger.log('sns_published', {
      correlationId,
      s3Key,
      messageId,
      topicArn: this.aws.config.snsTopicArn,
    });

    return { s3Key, messageId };
  }
}
