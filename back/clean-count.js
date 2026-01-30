const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        select: { id: true, kycStatus: true, status: true, deletedAt: true }
    });

    const unverified = users.filter(u => u.deletedAt === null && u.kycStatus === 'UNVERIFIED').length;
    const pending = users.filter(u => u.deletedAt === null && u.kycStatus === 'PENDING').length;
    const verified = users.filter(u => u.deletedAt === null && u.kycStatus === 'VERIFIED').length;
    const total = users.length;

    console.log(`TOTAL USERS: ${total}`);
    console.log(`UNVERIFIED: ${unverified}`);
    console.log(`PENDING: ${pending}`);
    console.log(`VERIFIED: ${verified}`);
}

main().finally(() => prisma.$disconnect());
