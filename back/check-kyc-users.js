const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        where: {
            kycStatus: { in: ['UNVERIFIED', 'PENDING', 'REJECTED', 'REQUIRES_INPUT', 'CANCELED'] },
            deletedAt: null
        },
        select: { id: true, kycStatus: true, status: true, isActif: true, isLocked: true }
    });

    console.log('--- POTENTIAL KYC USERS ---');
    console.log(JSON.stringify(users, null, 2));
}

main().finally(() => prisma.$disconnect());
