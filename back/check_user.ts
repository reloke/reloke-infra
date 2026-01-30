
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const user = await prisma.user.findUnique({ where: { mail: 'seed19@reloke.com' } });
    if (user) {
        console.log('STATUS:' + user.status);
        console.log('IS_BANNED:' + user.isBanned);
        console.log('ID:' + user.id);
    } else {
        console.log('USER NOT FOUND');
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
