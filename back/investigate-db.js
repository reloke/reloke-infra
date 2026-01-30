const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        select: {
            id: true,
            mail: true,
            status: true,
            kycStatus: true,
            deletedAt: true
        }
    });
    console.log('--- ALL USERS ---');
    users.forEach(u => {
        console.log(`${u.id} | ${u.mail} | S:${u.status} | K:${u.kycStatus} | DAt:${u.deletedAt}`);
    });

    const count = await prisma.user.count({
        where: {
            deletedAt: null,
            kycStatus: {
                in: ['UNVERIFIED', 'PENDING', 'REJECTED', 'REQUIRES_INPUT', 'CANCELED']
            }
        }
    });
    console.log('--- COUNT QUERY ---');
    console.log('Count:', count);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
