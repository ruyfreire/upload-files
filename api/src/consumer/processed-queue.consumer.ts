import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Consumer } from 'sqs-consumer';
import { AWS_CLIENTS, AwsClients } from '../aws/aws.config';
import { WebhookService, ProcessedSummary } from '../webhook/webhook.service';
import { CloudWatchLoggerService } from '../aws/cloudwatch-logger.service';

const VISIBILITY_TIMEOUT = 60;
const HANDLE_MESSAGE_TIMEOUT_MS = 55_000;

/**
 * Consumer em background da fila csv-processed-queue.
 *
 * Usa sqs-consumer (long polling, delete após sucesso, retry via visibility timeout).
 * A Lambda envia o resumo após gravar linhas no DynamoDB.
 */
@Injectable()
export class ProcessedQueueConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessedQueueConsumer.name);
  private consumer: Consumer | null = null;

  constructor(
    @Inject(AWS_CLIENTS) private readonly aws: AwsClients,
    private readonly webhookService: WebhookService,
    private readonly cwLogger: CloudWatchLoggerService,
  ) {}

  onModuleInit() {
    const queueUrl = this.aws.config.processedQueueUrl;
    if (!queueUrl) {
      this.logger.warn('PROCESSED_QUEUE_URL não configurada — consumer desabilitado');
      return;
    }

    this.consumer = Consumer.create({
      queueUrl,
      sqs: this.aws.sqs,
      batchSize: 1,
      visibilityTimeout: VISIBILITY_TIMEOUT,
      handleMessageTimeout: HANDLE_MESSAGE_TIMEOUT_MS,
      handleMessage: async (message) => {
        const summary = JSON.parse(message.Body || '{}') as ProcessedSummary;

        await this.cwLogger.log('message_received', {
          correlationId: summary.correlationId,
          sourceKey: summary.sourceKey,
          recordsCount: summary.recordsCount,
        });

        this.logger.log(
          `Mensagem processada recebida: ${summary.sourceKey} (${summary.recordsCount} registros)`,
        );

        await this.webhookService.notify(summary);
        return message;
      },
    });

    this.wireConsumerEvents(this.consumer);

    this.consumer.start();
    this.logger.log(`Consumer iniciado (sqs-consumer) — fila: ${queueUrl}`);
  }

  async onModuleDestroy() {
    if (!this.consumer) return;

    this.logger.log('Encerrando consumer SQS...');
    this.consumer.stop();
    this.consumer = null;
  }

  private wireConsumerEvents(consumer: Consumer): void {
    consumer.on('error', (err) => {
      this.logger.error(`Consumer SQS error: ${err.message}`);
    });

    consumer.on('processing_error', async (err, message) => {
      const summary = this.tryParseSummary(message?.Body);
      await this.cwLogger.log('message_processing_failed', {
        correlationId: summary?.correlationId,
        sourceKey: summary?.sourceKey,
        messageId: message?.MessageId,
        error: err.message,
      });
      this.logger.error(
        `Falha ao processar mensagem ${message?.MessageId ?? 'unknown'}: ${err.message}`,
      );
    });

    consumer.on('timeout_error', (err, message) => {
      this.logger.error(
        `Timeout ao processar mensagem ${message?.MessageId ?? 'unknown'}: ${err.message}`,
      );
    });

    consumer.on('stopped', () => {
      this.logger.log('Consumer SQS parado');
    });
  }

  private tryParseSummary(body: string | undefined): ProcessedSummary | null {
    if (!body) return null;
    try {
      return JSON.parse(body) as ProcessedSummary;
    } catch {
      return null;
    }
  }
}
