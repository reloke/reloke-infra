
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const email = 'seed19@reloke.com';
    let user = await prisma.user.findUnique({ where: { mail: email } });
    if (user) {
        console.log('BEFORE - STATUS:' + user.status + ', IS_BANNED:' + user.isBanned);

        // Ban the user
        user = await prisma.user.update({
            where: { mail: email },
            data: { status: 'BANNED', isBanned: true }
        });

        console.log('AFTER - STATUS:' + user.status + ', IS_BANNED:' + user.isBanned);
    } else {
        console.log('USER NOT FOUND');
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
