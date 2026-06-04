import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer } from 'kafkajs';
import { WebhookService, ProcessedSummary } from '../webhook/webhook.service';
import { CloudWatchLoggerService } from '../aws/cloudwatch-logger.service';

/**
 * Consumer em background do tópico Kafka csv.processed.
 *
 * Commit de offset após webhook OK (falha relança → retry do consumer group).
 */
@Injectable()
export class ProcessedKafkaConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessedKafkaConsumer.name);
  private consumer: Consumer | null = null;
  private kafka: Kafka | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly webhookService: WebhookService,
    private readonly cwLogger: CloudWatchLoggerService,
  ) {}

  async onModuleInit() {
    const brokers = this.config.get<string>('KAFKA_BROKERS', '');
    const topic = this.config.get<string>('KAFKA_TOPIC', 'csv.processed');
    const groupId = this.config.get<string>('KAFKA_GROUP_ID', 'csv-processed-api');

    if (!brokers) {
      this.logger.warn('KAFKA_BROKERS não configurado — consumer Kafka desabilitado');
      return;
    }

    this.kafka = new Kafka({
      clientId: 'csv-upload-api',
      brokers: brokers.split(',').map((b) => b.trim()),
    });

    this.consumer = this.kafka.consumer({ groupId });

    try {
      await this.consumer.connect();
      await this.consumer.subscribe({ topic, fromBeginning: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao conectar Kafka (${brokers}): ${msg} — API HTTP continua`);
      this.consumer = null;
      return;
    }

    this.logger.log(`Consumer Kafka iniciado — tópico: ${topic}, group: ${groupId}`);

    await this.consumer.run({
      eachMessage: async ({ message, partition, topic: msgTopic }) => {
        const raw = message.value?.toString() ?? '';
        let summary: ProcessedSummary;

        try {
          summary = JSON.parse(raw) as ProcessedSummary;
        } catch {
          throw new Error(`Payload Kafka inválido: ${raw.slice(0, 200)}`);
        }

        await this.cwLogger.log('message_received', {
          correlationId: summary.correlationId,
          sourceKey: summary.sourceKey,
          recordsCount: summary.recordsCount,
          partition,
          offset: message.offset,
        });

        this.logger.log(
          `Mensagem Kafka recebida: ${summary.sourceKey} (${summary.recordsCount} registros)`,
        );

        try {
          await this.webhookService.notify(summary);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          await this.cwLogger.log('message_processing_failed', {
            correlationId: summary?.correlationId,
            sourceKey: summary?.sourceKey,
            topic: msgTopic,
            offset: message.offset,
            error,
          });
          this.logger.error(`Falha ao processar mensagem Kafka: ${error}`);
          throw err;
        }
      },
    });
  }

  async onModuleDestroy() {
    if (this.consumer) {
      this.logger.log('Encerrando consumer Kafka...');
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }
}
