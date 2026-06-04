import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Token de injeção para o objeto com todos os clientes AWS */
export const AWS_CLIENTS = 'AWS_CLIENTS';

export interface AwsClients {
  s3: S3Client;
  sns: SNSClient;
  sqs: SQSClient;
  secretsManager: SecretsManagerClient;
  cloudWatchLogs: CloudWatchLogsClient;
  dynamo: DynamoDBDocumentClient;
  config: {
    endpoint: string | undefined;
    region: string;
    bucket: string;
    snsTopicArn: string;
    processedQueueUrl: string;
    secretName: string;
    logGroupName: string;
    dynamodbTable: string;
  };
}

/**
 * Factory que centraliza a configuração do SDK para LocalStack.
 *
 * Pontos importantes:
 * - forcePathStyle: true — necessário para S3 no LocalStack
 * - endpoint: http://127.0.0.1:4566 quando a API roda no WSL (fora do Docker)
 * - credenciais test/test — padrão LocalStack
 */
export const awsClientsFactory: FactoryProvider = {
  provide: AWS_CLIENTS,
  inject: [ConfigService],
  useFactory: (config: ConfigService): AwsClients => {
    const region = config.get<string>('AWS_REGION', 'us-east-1');
    const endpoint = config.get<string>('AWS_ENDPOINT_URL');

    const clientConfig = {
      region,
      ...(endpoint
        ? {
            endpoint,
            forcePathStyle: true,
            credentials: {
              accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID', 'test'),
              secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY', 'test'),
            },
          }
        : {}),
    };

    return {
      s3: new S3Client(clientConfig),
      sns: new SNSClient(clientConfig),
      sqs: new SQSClient(clientConfig),
      secretsManager: new SecretsManagerClient(clientConfig),
      cloudWatchLogs: new CloudWatchLogsClient(clientConfig),
      dynamo: DynamoDBDocumentClient.from(new DynamoDBClient(clientConfig)),
      config: {
        endpoint,
        region,
        bucket: config.get<string>('S3_BUCKET', 'csv-uploads'),
        snsTopicArn: config.get<string>('SNS_TOPIC_ARN', ''),
        processedQueueUrl: config.get<string>('PROCESSED_QUEUE_URL', ''),
        secretName: config.get<string>('SECRET_NAME', 'study/webhook'),
        logGroupName: config.get<string>('LOG_GROUP_NAME', '/study/csv-pipeline'),
        dynamodbTable: config.get<string>('DYNAMODB_TABLE', 'CsvRecords'),
      },
    };
  },
};
