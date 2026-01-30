
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const user = await prisma.user.findUnique({ where: { mail: 'seed19@reloke.com' } });
    if (user) {
        console.log('LOCKED:' + user.isLocked);
        console.log('ACTIF:' + user.isActif);
        console.log('STATUS:' + user.status);
        console.log('BANNED:' + user.isBanned);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
