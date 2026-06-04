import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { awsClientsFactory, AWS_CLIENTS } from './aws.config';
import { CloudWatchLoggerService } from './cloudwatch-logger.service';

/**
 * Módulo global com clientes AWS SDK v3 configurados para LocalStack.
 */
@Global()
@Module({
  providers: [awsClientsFactory, CloudWatchLoggerService],
  exports: [AWS_CLIENTS, CloudWatchLoggerService],
})
export class AwsModule {}
