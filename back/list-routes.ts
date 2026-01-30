import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';

async function main() {
    const app = await NestFactory.create(AppModule);

    const server = app.getHttpServer();
    const router = server._events.request._router;

    console.log('--- REGISTERED ROUTES ---');
    const stack = app.getHttpAdapter().getInstance()._router.stack;
    stack.forEach((layer: any) => {
        if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
            console.log(`${methods} ${layer.route.path}`);
        }
    });

    await app.close();
    process.exit(0);
}

main();
