import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';

import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common/pipes/validation.pipe';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  console.time('🚀 Total bootstrap');
  console.time('📦 NestFactory.create');

  const app = await NestFactory.create(AppModule, {
    // Enable raw body parsing for Stripe webhooks
    rawBody: true,
  });
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    (app as any).set('trust proxy', 1);// Indispensable pour la gestion des cookies derrière un proxy
  }
  console.timeEnd('📦 NestFactory.create');

  app.use(cookieParser());

  const configService = app.get(ConfigService);
  const frontendUrl =
    configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';

  // Enable CORS
  app.enableCors({
    origin: [
      /localhost:\d+$/,
      /127\.0\.0\.1:\d+$/,
      frontendUrl,
      'https://reloke.com', // Ajoute ton domaine final
      'https://www.reloke.com',
      /\.run\.app$/ // Autorise les URL de test Cloud Run
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Supprime les champs non autorisés envoyés par l'utilisateur
      forbidNonWhitelisted: true, // Renvoie une erreur si des champs inconnus sont présents
      transform: true, // Convertit automatiquement les types (ex: string vers number)
    }),
  );

  console.time('🔌 Redis adapter');
  const redisIoAdapter = new RedisIoAdapter(app);
  //await redisIoAdapter.connectToRedis();
  redisIoAdapter.connectToRedis().catch(err => console.error("Redis Error:", err));
  app.useWebSocketAdapter(redisIoAdapter);
  console.timeEnd('🔌 Redis adapter');


  console.time('👂 app.listen');
  //const port = process.env.PORT || 3000;
  const port = 3000;
  await app.listen(port, '0.0.0.0');
  console.timeEnd('👂 app.listen');


  console.timeEnd('🚀 Total bootstrap');

  console.log(
    `Application is running on: http://localhost:${port}`,
  );
}
bootstrap();
