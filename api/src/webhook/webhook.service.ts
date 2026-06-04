import { Injectable, Inject, Logger } from '@nestjs/common';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { AWS_CLIENTS, AwsClients } from '../aws/aws.config';
import { CloudWatchLoggerService } from '../aws/cloudwatch-logger.service';

export interface WebhookSecret {
  token: string;
  webhookUrl: string;
}

export interface ProcessedSummary {
  sourceKey: string;
  bucket?: string;
  recordsCount: number;
  recordIds: string[];
  processedAt: string;
  correlationId: string;
}

/**
 * Lê credenciais do Secrets Manager e envia POST para webhook.site.
 * Apenas a API sai para a internet — a Lambda fica na rede Docker.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private cachedSecret: WebhookSecret | null = null;

  constructor(
    @Inject(AWS_CLIENTS) private readonly aws: AwsClients,
    private readonly cwLogger: CloudWatchLoggerService,
  ) {}

  /** Busca secret study/webhook (com cache simples em memória) */
  async getWebhookSecret(): Promise<WebhookSecret> {
    if (this.cachedSecret) return this.cachedSecret;

    const result = await this.aws.secretsManager.send(
      new GetSecretValueCommand({ SecretId: this.aws.config.secretName }),
    );

    if (!result.SecretString) {
      throw new Error(`Secret ${this.aws.config.secretName} sem SecretString`);
    }

    this.cachedSecret = JSON.parse(result.SecretString) as WebhookSecret;
    return this.cachedSecret;
  }

  /** POST no webhook com Authorization Bearer */
  async notify(summary: ProcessedSummary): Promise<void> {
    const { token, webhookUrl } = await this.getWebhookSecret();

    const body = {
      ...summary,
      notifiedAt: new Date().toISOString(),
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Webhook HTTP ${response.status}: ${await response.text()}`);
      }

      await this.cwLogger.log('webhook_sent', {
        correlationId: summary.correlationId,
        sourceKey: summary.sourceKey,
        recordsCount: summary.recordsCount,
        webhookStatus: response.status,
      });
    } catch (err) {
      await this.cwLogger.log('webhook_failed', {
        correlationId: summary.correlationId,
        sourceKey: summary.sourceKey,
        error: (err as Error).message,
      });
      throw err;
    }
  }
}
