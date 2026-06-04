import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AwsModule } from './aws/aws.module';
import { UploadModule } from './upload/upload.module';
import { RecordsModule } from './records/records.module';
import { WebhookModule } from './webhook/webhook.module';
import { ProcessedQueueConsumer } from './consumer/processed-queue.consumer';

@Module({
  imports: [
    // Carrega variáveis de .env (AWS_ENDPOINT_URL, filas, etc.)
    ConfigModule.forRoot({ isGlobal: true }),
    AwsModule,
    UploadModule,
    RecordsModule,
    WebhookModule,
  ],
  providers: [ProcessedQueueConsumer],
})
export class AppModule {}
