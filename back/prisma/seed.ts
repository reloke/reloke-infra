import { PrismaClient, Role, HomeType, KycStatus, MatchType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Seed goals:
 * - Keep existing data (NO delete)
 * - Idempotent: re-run safely using upsert on unique fields
 * - Create 20 phantom users + Home + Search(+SearchAdress) + Intent + Payment
 * - Data shaped so matching can find:
 *    - 7 STANDARD reciprocal pairs (14 users)
 *    - 2 TRIANGLE cycles (6 users)
 * - Do NOT create Match rows (matching algorithm will create them).
 *
 * IMPORTANT: Each Intent with credits MUST have a corresponding Payment SUCCEEDED
 * to avoid INSUFFICIENT_PAYMENT_CREDITS errors during matching.
 */

const ADMIN_EMAIL = 'admin@reloke.com';
const ADMIN_PASSWORD = 'admin123';

// Phantom users password (same for all)
const PHANTOM_PASSWORD = 'phantom123';

// Payment configuration
const SEED_MATCHES_PER_USER = 10;
const SEED_PACK_TYPE = 'PACK_STANDARD';
const SEED_AMOUNT_BASE = 40.0; // €40 for 10 matches
const SEED_AMOUNT_FEES = 1.5;
const SEED_AMOUNT_TOTAL = 41.5;
const SEED_PRICE_PER_MATCH = 4.0;

// Small deterministic jitter to avoid same coordinates
function jitter(base: number, seed: number, amplitude = 0.01) {
  // deterministic pseudo-random in [-amplitude, +amplitude]
  const x = Math.sin(seed * 9999) * 10000;
  const frac = x - Math.floor(x);
  return base + (frac * 2 - 1) * amplitude;
}

type City = { name: string; lat: number; lng: number };

const CITIES: City[] = [
  { name: 'Lyon', lat: 45.764043, lng: 4.835659 },
  { name: 'Paris', lat: 48.8575475, lng: 2.3513765 },
  { name: 'Nantes', lat: 47.218371, lng: -1.553621 },
  { name: 'Marseille', lat: 43.3025742, lng: 5.3690743 },
  { name: 'Nice', lat: 43.7101728, lng: 7.2619532 },
  { name: 'Toulouse', lat: 43.604652, lng: 1.444209 },
  { name: 'Bordeaux', lat: 44.837789, lng: -0.57918 },
  { name: 'Lille', lat: 50.62925, lng: 3.057256 },
];

function phantomUser(i: number) {
  const n = String(i).padStart(2, '0');
  return {
    email: `seed${n}@reloke.com`,
    firstName: `Seed${n}`,
    lastName: `User`,
  };
}

function homeTypeByIndex(i: number): HomeType {
  const types: HomeType[] = [
    HomeType.STUDIO,
    HomeType.T1,
    HomeType.T1_BIS,
    HomeType.T2,
    HomeType.T2_BIS,
    HomeType.CHAMBRE,
  ];
  return types[i % types.length];
}

function baseHomeNumbers(type: HomeType) {
  switch (type) {
    case HomeType.STUDIO: return { rooms: 1, surface: 18, rent: 550 };
    case HomeType.T1: return { rooms: 2, surface: 25, rent: 650 };
    case HomeType.T1_BIS: return { rooms: 2, surface: 28, rent: 680 };
    case HomeType.T2: return { rooms: 2, surface: 35, rent: 850 };
    case HomeType.T2_BIS: return { rooms: 3, surface: 45, rent: 950 };
    case HomeType.CHAMBRE: return { rooms: 1, surface: 14, rent: 450 };
    default: return { rooms: 2, surface: 30, rent: 700 };
  }
}

/**
 * Generate a stable, unique Stripe-like session ID for seeding
 * Format: cs_seed_{userIndex}_{packIndex}
 */
function generateSeedSessionId(userIndex: number, packIndex: number = 1): string {
  return `cs_seed_user${String(userIndex).padStart(2, '0')}_pack${packIndex}`;
}

async function ensureAdmin() {
  const existingAdmin = await prisma.user.findUnique({ where: { mail: ADMIN_EMAIL } });
  if (existingAdmin) {
    console.log('ℹ️ Admin user already exists');
    return;
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await prisma.user.create({
    data: {
      firstName: 'Admin',
      lastName: 'Reloke',
      mail: ADMIN_EMAIL,
      password: hashedPassword,
      role: Role.ADMIN,
      status: 'VERIFIED',
      isActif: true,
      isKycVerified: true,
      kycStatus: 'VERIFIED',
      isEmailVerified: true,
      dateLastConnection: new Date(),
    },
  });

  console.log('✅ Admin user created');
}

async function upsertUser(email: string, firstName: string, lastName: string, hashedPassword: string) {
  return prisma.user.upsert({
    where: { mail: email },
    update: {
      firstName,
      lastName,
      // Do NOT overwrite password/role if you want; here we keep them stable
      status: 'VERIFIED',
      isActif: true,
      isKycVerified: true,
      kycStatus: 'VERIFIED',
      isEmailVerified: true,
      dateLastConnection: new Date(),
    },
    create: {
      firstName,
      lastName,
      mail: email,
      password: hashedPassword,
      role: Role.USER,
      status: 'VERIFIED',
      isActif: true,
      isKycVerified: true,
      kycStatus: 'VERIFIED',
      isEmailVerified: true,
      dateLastConnection: new Date(),
    },
  });
}

async function ensureHomeForUser(params: {
  userId: number;
  email: string;
  city: City;
  idxSeed: number;
  homeType: HomeType;
  rent: number;
  surface: number;
  nbRooms: number;
}) {
  const existingHome = await prisma.home.findUnique({ where: { userId: params.userId } });
  if (existingHome) return existingHome;

  const lat = jitter(params.city.lat, params.idxSeed, 0.02);
  const lng = jitter(params.city.lng, params.idxSeed + 1, 0.02);

  return prisma.home.create({
    data: {
      userId: params.userId,
      addressFormatted: `${params.idxSeed} ${params.city.name}, France (seed)`,
      addressPlaceId: `seed_place_${params.email}`,
      lat,
      lng,
      homeType: params.homeType,
      nbRooms: params.nbRooms,
      surface: params.surface,
      rent: params.rent,
      description: `Seed home for ${params.email}`,
    },
  });
}

async function ensureSearchForUser(params: {
  userId: number;
  seedTag: string; // unique marker stored in SearchAdress.label
  city: City;
  idxSeed: number;
  // Criteria
  minRent?: number | null;
  maxRent?: number | null;
  minRooms?: number | null;
  maxRooms?: number | null;
  minSurface?: number | null;
  maxSurface?: number | null;
  homeTypes: HomeType[];
}) {
  // Find by unique seedTag in SearchAdress.label
  const existing = await prisma.searchAdress.findFirst({
    where: { label: params.seedTag },
    include: { search: true },
  });
  if (existing?.search) return existing.search;

  const centerLat = params.city.lat;
  const centerLng = params.city.lng;

  return prisma.search.create({
    data: {
      userId: params.userId,
      minRent: params.minRent ?? null,
      maxRent: params.maxRent ?? null,
      minRoomNb: params.minRooms ?? null,
      maxRoomNb: params.maxRooms ?? null,
      minRoomSurface: params.minSurface ?? null,
      maxRoomSurface: params.maxSurface ?? null,
      homeType: params.homeTypes, // Json in your schema
      searchStartDate: new Date(Date.now() - 2 * 24 * 3600 * 1000), // started 2 days ago
      searchEndDate: new Date(Date.now() + 90 * 24 * 3600 * 1000),   // 90 days window
      searchAdresses: {
        create: [
          {
            label: params.seedTag, // UNIQUE marker
            latitude: centerLat,
            longitude: centerLng,
            radius: 12000, // 12km
          },
        ],
      },
    },
  });
}

async function ensureIntentForUser(params: {
  userId: number;
  homeId: number;
  searchId: number;
  matchesCredit: number;
}) {
  const existing = await prisma.intent.findFirst({
    where: {
      userId: params.userId,
      searchId: params.searchId,
    },
  });

  if (existing) {
    // Ensure links are set and credits are coherent
    return prisma.intent.update({
      where: { id: existing.id },
      data: {
        homeId: existing.homeId ?? params.homeId,
        searchId: existing.searchId ?? params.searchId,
        isInFlow: true,
        isActivelySearching: true,
        totalMatchesPurchased: Math.max(existing.totalMatchesPurchased ?? 0, params.matchesCredit),
        totalMatchesRemaining: Math.max(existing.totalMatchesRemaining ?? 0, params.matchesCredit),
      },
    });
  }

  return prisma.intent.create({
    data: {
      userId: params.userId,
      homeId: params.homeId,
      searchId: params.searchId,
      isInFlow: true,
      isActivelySearching: true,
      totalMatchesPurchased: params.matchesCredit,
      totalMatchesUsed: 0,
      totalMatchesRemaining: params.matchesCredit,
      numberOfMatch: 0,
    },
  });
}

/**
 * Ensure a Payment exists for the user's Intent.
 * Uses stripeCheckoutSessionId as the unique key for idempotency.
 */
async function ensurePaymentForIntent(params: {
  userId: number;
  intentId: number;
  userIndex: number;
  matchesInitial: number;
}) {
  const sessionId = generateSeedSessionId(params.userIndex);

  const existingPayment = await prisma.payment.findUnique({
    where: { stripeCheckoutSessionId: sessionId },
  });

  if (existingPayment) {
    // Ensure it's in SUCCEEDED status with correct data
    if (existingPayment.status !== 'SUCCEEDED') {
      await prisma.payment.update({
        where: { id: existingPayment.id },
        data: {
          status: 'SUCCEEDED',
          matchesUsed: 0,
          matchesRefunded: 0,
          succeededAt: new Date(),
        },
      });
    }
    return existingPayment;
  }

  // Create new payment
  return prisma.payment.create({
    data: {
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: `pi_seed_${params.userIndex}`,
      stripeChargeId: `ch_seed_${params.userIndex}`,
      planType: SEED_PACK_TYPE,
      matchesInitial: params.matchesInitial,
      matchesUsed: 0,
      matchesRefunded: 0,
      amountBase: SEED_AMOUNT_BASE,
      amountFees: SEED_AMOUNT_FEES,
      amountTotal: SEED_AMOUNT_TOTAL,
      pricePerMatch: SEED_PRICE_PER_MATCH,
      currency: 'eur',
      status: 'SUCCEEDED',
      succeededAt: new Date(),
      userId: params.userId,
      intentId: params.intentId,
    },
  });
}

async function main() {
  await ensureAdmin();

  const hashedPhantom = await bcrypt.hash(PHANTOM_PASSWORD, 10);

  // --- Build 20 users plan ---
  // 7 pairs => 14 users (1..14)
  // 2 triangles => 6 users (15..20)
  const users = Array.from({ length: 20 }, (_, k) => phantomUser(k + 1));

  // Pre-assign groups/cities
  const pairCities = [CITIES[0], CITIES[1], CITIES[2], CITIES[3], CITIES[4], CITIES[5], CITIES[6]]; // 7 distinct
  const triCities = [CITIES[7], CITIES[0]]; // two triangles in Lille + Lyon (example)

  // Create users + home/search/intent/payment
  for (let i = 0; i < users.length; i++) {
    const idx = i + 1;
    const u = users[i];

    const user = await upsertUser(u.email, u.firstName, u.lastName, hashedPhantom);

    // Decide if user is in PAIR or TRIANGLE
    const isPair = idx <= 14;
    const seedTag = `SEED:${u.email}`;

    let home: Awaited<ReturnType<typeof ensureHomeForUser>>;
    let search: Awaited<ReturnType<typeof ensureSearchForUser>>;

    if (isPair) {
      // Pair index 0..6, each has two users
      const pairIndex = Math.floor((idx - 1) / 2);
      const city = pairCities[pairIndex];

      const ht = homeTypeByIndex(idx);
      const base = baseHomeNumbers(ht);

      home = await ensureHomeForUser({
        userId: user.id,
        email: u.email,
        city,
        idxSeed: idx,
        homeType: ht,
        rent: base.rent,
        surface: base.surface,
        nbRooms: base.rooms,
      });

      // Reciprocal-friendly criteria:
      // - wide enough to accept both sides within that city
      const maxRent = base.rent + 400;
      const maxSurface = base.surface + 30;
      const maxRooms = Math.max(base.rooms, 3);

      search = await ensureSearchForUser({
        userId: user.id,
        seedTag,
        city,
        idxSeed: idx,
        minRent: null,
        maxRent,
        minRooms: null,
        maxRooms,
        minSurface: null,
        maxSurface,
        homeTypes: [
          HomeType.STUDIO,
          HomeType.T1,
          HomeType.T1_BIS,
          HomeType.T2,
          HomeType.T2_BIS,
          HomeType.CHAMBRE,
        ],
      });
    } else {
      // Triangle users: idx 15..17 => triangle 0, idx 18..20 => triangle 1
      const triIndex = idx <= 17 ? 0 : 1;
      const city = triCities[triIndex];

      // role in triangle group: A, B, C
      const pos = (idx - (triIndex === 0 ? 15 : 18)) % 3; // 0,1,2

      // Force a directed cycle by homeType + maxRent:
      // A wants B(T2), B wants C(T1), C wants A(STUDIO)
      const triHomes = [
        { homeType: HomeType.STUDIO, rent: 520, surface: 18, rooms: 1 }, // A
        { homeType: HomeType.T2, rent: 740, surface: 35, rooms: 2 },     // B
        { homeType: HomeType.T1, rent: 630, surface: 25, rooms: 2 },     // C
      ];
      const meHome = triHomes[pos];

      home = await ensureHomeForUser({
        userId: user.id,
        email: u.email,
        city,
        idxSeed: idx,
        homeType: meHome.homeType,
        rent: meHome.rent,
        surface: meHome.surface,
        nbRooms: meHome.rooms,
      });

      // Search each node wants the "next" node:
      // A(pos0) wants T2; B(pos1) wants T1; C(pos2) wants STUDIO
      const wanted = pos === 0
        ? { types: [HomeType.T2], maxRent: 800, maxSurface: 40, maxRooms: 3 }
        : pos === 1
          ? { types: [HomeType.T1], maxRent: 680, maxSurface: 35, maxRooms: 3 }
          : { types: [HomeType.STUDIO], maxRent: 580, maxSurface: 25, maxRooms: 2 };

      search = await ensureSearchForUser({
        userId: user.id,
        seedTag,
        city,
        idxSeed: idx,
        minRent: null,
        maxRent: wanted.maxRent,
        minRooms: null,
        maxRooms: wanted.maxRooms,
        minSurface: null,
        maxSurface: wanted.maxSurface,
        homeTypes: wanted.types,
      });
    }

    // Create Intent with credits
    const intent = await ensureIntentForUser({
      userId: user.id,
      homeId: home.id,
      searchId: search.id,
      matchesCredit: SEED_MATCHES_PER_USER,
    });

    // Create Payment SUCCEEDED for this Intent (CRITICAL for matching to work)
    await ensurePaymentForIntent({
      userId: user.id,
      intentId: intent.id,
      userIndex: idx,
      matchesInitial: SEED_MATCHES_PER_USER,
    });

    console.log(`✅ Seed user ready: ${u.email} (Intent=${intent.id}, Credits=${SEED_MATCHES_PER_USER})`);
  }

  console.log('');
  console.log('✅ Seed completed: 20 phantom users + Home/Search/Intent/Payment created.');
  console.log('   - Users 1-14: 7 STANDARD reciprocal pairs');
  console.log('   - Users 15-20: 2 TRIANGLE cycles (A->B->C->A)');
  console.log('   - Each user has 10 credits with SUCCEEDED payment');
  console.log('   - No matches created (matching algorithm will create them)');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
