const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/src/app.module');

async function main() {
    const app = await NestFactory.create(AppModule);
    const server = app.getHttpServer();
    const router = server._events.request._router;

    const availableRoutes = router.stack
        .filter(r => r.route)
        .map(r => {
            return {
                method: Object.keys(r.route.methods)[0].toUpperCase(),
                path: r.route.path
            };
        });

    console.log(JSON.stringify(availableRoutes, null, 2));
    await app.close();
}

main().catch(err => console.error(err));
