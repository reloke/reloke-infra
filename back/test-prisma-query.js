const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testQuery(search, status) {
    const baseKycFilter = {
        isKycVerified: false
    };

    if (status) {
        baseKycFilter.kycStatus = status;
    }

    const whereClause = {
        deletedAt: null,
        ...baseKycFilter
    };

    if (search) {
        whereClause.AND = [
            baseKycFilter,
            {
                OR: [
                    { mail: { contains: search, mode: 'insensitive' } },
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                ]
            }
        ];
        delete whereClause.isKycVerified;
        delete whereClause.kycStatus;
    }

    console.log('QUERY FOR search:', search, 'status:', status);
    console.log('WHERE:', JSON.stringify(whereClause, null, 2));

    const items = await prisma.user.findMany({
        where: whereClause,
        select: { id: true, mail: true, isKycVerified: true, kycStatus: true, deletedAt: true }
    });

    console.log('RESULTS COUNT:', items.length);
    console.log('RESULTS:', JSON.stringify(items, null, 2));
}

async function main() {
    await testQuery(undefined, undefined);
    await testQuery('seed', undefined);
}

main().finally(() => prisma.$disconnect());
