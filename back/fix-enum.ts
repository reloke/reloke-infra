
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Attempting to add "User" to AuditEntityType enum...');
    try {
        // We use executeRawUnsafe because 'User' might not be in the client's enum definition yet
        // and we want to bypass client validation to hit the DB directly.
        await prisma.$executeRawUnsafe(`ALTER TYPE "AuditEntityType" ADD VALUE 'User';`);
        console.log('Successfully added "User" to AuditEntityType enum.');
    } catch (e: any) {
        if (e.message.includes('already exists')) {
            console.log('"User" already exists in AuditEntityType enum.');
        } else {
            console.log('Error adding enum value (it might already exist or DB is not reachable):');
            console.log(e.message);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main();
