import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from '@aws-sdk/client-cloudwatch-logs';
import { AWS_CLIENTS, AwsClients } from './aws.config';
import { randomUUID } from 'crypto';

/**
 * Envia eventos estruturados para CloudWatch Logs (/study/csv-pipeline).
 *
 * LocalStack exige log stream criado antes de put-log-events
 * (ver docs/CLI-LOCALSTACK.md).
 */
@Injectable()
export class CloudWatchLoggerService {
  private readonly logger = new Logger(CloudWatchLoggerService.name);
  private readonly cwClient: CloudWatchLogsClient;
  private readonly logGroupName: string;
  private readonly streamName: string;
  private sequenceToken: string | undefined;
  private streamReady = false;

  constructor(@Inject(AWS_CLIENTS) aws: AwsClients) {
    this.cwClient = aws.cloudWatchLogs;
    this.logGroupName = aws.config.logGroupName;
    // Um stream por instância da API (facilita rastrear sessão de estudo)
    this.streamName = `api-${randomUUID().slice(0, 8)}`;
  }

  /** Garante que o log stream existe (idempotente) */
  private async ensureStream(): Promise<void> {
    if (this.streamReady) return;

    try {
      await this.cwClient.send(
        new CreateLogStreamCommand({
          logGroupName: this.logGroupName,
          logStreamName: this.streamName,
        }),
      );
    } catch (err) {
      if (!(err instanceof ResourceAlreadyExistsException)) {
        this.logger.warn(`Falha ao criar log stream: ${(err as Error).message}`);
      }
    }
    this.streamReady = true;
  }

  /** Registra evento JSON no CloudWatch (upload, webhook, etc.) */
  async log(event: string, data: Record<string, unknown> = {}): Promise<void> {
    const message = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...data,
    });

    // Sempre loga no stdout também (útil durante desenvolvimento)
    this.logger.log(message);

    try {
      await this.ensureStream();

      const result = await this.cwClient.send(
        new PutLogEventsCommand({
          logGroupName: this.logGroupName,
          logStreamName: this.streamName,
          sequenceToken: this.sequenceToken,
          logEvents: [
            {
              timestamp: Date.now(),
              message,
            },
          ],
        }),
      );

      this.sequenceToken = result.nextSequenceToken; // nextSequenceToken foi descontinuado na AWS
    } catch (err) {
      this.logger.warn(`CloudWatch PutLogEvents falhou: ${(err as Error).message}`);
    }
  }
}
