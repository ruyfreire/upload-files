import { Injectable, Inject } from '@nestjs/common';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { AWS_CLIENTS, AwsClients } from '../aws/aws.config';

export interface CsvRecord {
  id: string;
  nome: string;
  data: string;
  valor: string;
  sourceKey: string;
  uploadedAt: string;
}

export interface RecordsResponse {
  items: CsvRecord[];
  count: number;
}

@Injectable()
export class RecordsService {
  constructor(@Inject(AWS_CLIENTS) private readonly aws: AwsClients) {}

  async findAll(limitParam?: string): Promise<RecordsResponse> {
    const parsed = limitParam ? parseInt(limitParam, 10) : 100;
    const limit = Number.isNaN(parsed) ? 100 : Math.min(Math.max(parsed, 1), 500);

    const result = await this.aws.dynamo.send(
      new ScanCommand({
        TableName: this.aws.config.dynamodbTable,
        Limit: limit,
      }),
    );

    const items = ((result.Items as CsvRecord[]) ?? []).sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );

    return { items, count: items.length };
  }
}
