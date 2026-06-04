import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Entrypoint da API.
 * Porta 3000; CORS liberado para testes com curl/browser.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`API CSV Upload rodando em http://localhost:${port}`);
}

bootstrap();
