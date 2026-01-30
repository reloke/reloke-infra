const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const allUsers = await prisma.user.findMany({
        select: { id: true, mail: true, isKycVerified: true, kycStatus: true }
    });

    console.log('--- ALL USERS (NULL CHECK) ---');
    allUsers.forEach(u => {
        console.log(`ID: ${u.id} | mail: ${u.mail} | isKycVerified: ${u.isKycVerified} (${typeof u.isKycVerified}) | kycStatus: ${u.kycStatus}`);
    });
}

main().finally(() => prisma.$disconnect());
