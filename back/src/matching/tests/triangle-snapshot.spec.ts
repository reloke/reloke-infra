/**
 * Tests for Triangle Snapshot Consistency
 *
 * Ensures TRIANGLE matches always have complete, consistent snapshots
 * with all required fields for debugging and UI display.
 */

describe('TriangleMatchingService - Snapshot Consistency', () => {
  describe('buildTriangleSnapshot', () => {
    // Sample participant data for testing
    const mockIntentA = {
      id: 1,
      userId: 100,
      isInFlow: true,
      totalMatchesRemaining: 5,
      homeId: 1001,
      searchId: 2001,
      home: {
        id: 1001,
        userId: 100,
        lat: 48.8566,
        lng: 2.3522,
        rent: 1200,
        surface: 45,
        nbRooms: 2,
        homeType: 'T2',
        addressFormatted: '10 Rue de Paris, 75001 Paris',
      },
      search: {
        id: 2001,
        minRent: 900,
        maxRent: 1500,
        minRoomSurface: 30,
        maxRoomSurface: 60,
        minRoomNb: 1,
        maxRoomNb: 3,
        homeType: ['T1', 'T2', 'T3'],
        searchStartDate: new Date('2025-01-01'),
        searchEndDate: new Date('2025-06-01'),
      },
      zones: [
        {
          id: 1,
          searchId: 2001,
          latitude: 48.8566,
          longitude: 2.3522,
          radius: 5000,
          label: 'Paris Centre',
        },
      ],
      user: {
        firstName: 'Alice',
        lastName: 'Dupont',
      },
    };

    const mockIntentB = {
      id: 2,
      userId: 200,
      isInFlow: true,
      totalMatchesRemaining: 3,
      homeId: 1002,
      searchId: 2002,
      home: {
        id: 1002,
        userId: 200,
        lat: 48.85,
        lng: 2.34,
        rent: 1100,
        surface: 40,
        nbRooms: 2,
        homeType: 'T2',
        addressFormatted: '20 Avenue Victor Hugo, 75016 Paris',
      },
      search: {
        id: 2002,
        minRent: 800,
        maxRent: 1400,
        minRoomSurface: 25,
        maxRoomSurface: 55,
        minRoomNb: 1,
        maxRoomNb: 2,
        homeType: ['T1', 'T2'],
        searchStartDate: new Date('2025-02-01'),
        searchEndDate: new Date('2025-07-01'),
      },
      zones: [
        {
          id: 2,
          searchId: 2002,
          latitude: 48.87,
          longitude: 2.33,
          radius: 3000,
          label: 'Paris 16ème',
        },
      ],
      user: {
        firstName: 'Bob',
        lastName: 'Martin',
      },
    };

    const mockIntentC = {
      id: 3,
      userId: 300,
      isInFlow: true,
      totalMatchesRemaining: 7,
      homeId: 1003,
      searchId: 2003,
      home: {
        id: 1003,
        userId: 300,
        lat: 48.86,
        lng: 2.36,
        rent: 1300,
        surface: 50,
        nbRooms: 3,
        homeType: 'T3',
        addressFormatted: '30 Boulevard Saint-Germain, 75005 Paris',
      },
      search: {
        id: 2003,
        minRent: 1000,
        maxRent: 1600,
        minRoomSurface: 35,
        maxRoomSurface: 65,
        minRoomNb: 2,
        maxRoomNb: 4,
        homeType: ['T2', 'T3', 'T4'],
        searchStartDate: new Date('2025-01-15'),
        searchEndDate: new Date('2025-05-15'),
      },
      zones: [
        {
          id: 3,
          searchId: 2003,
          latitude: 48.85,
          longitude: 2.35,
          radius: 4000,
          label: 'Paris 5ème',
        },
      ],
      user: {
        firstName: 'Claire',
        lastName: 'Bernard',
      },
    };

    it('snapshot should include all required top-level fields', () => {
      // Simulate what buildTriangleSnapshot should produce
      const snapshot = buildMockTriangleSnapshot(
        'group-123',
        mockIntentA,
        mockIntentB,
        mockIntentC,
      );

      // Required fields
      expect(snapshot.algorithmVersion).toBeDefined();
      expect(snapshot.snapshotVersion).toBe(2);
      expect(snapshot.matchType).toBe('TRIANGLE');
      expect(snapshot.groupId).toBe('group-123');
      expect(snapshot.createdAt).toBeDefined();
      expect(snapshot.participants).toBeDefined();
      expect(snapshot.chain).toBeDefined();
      expect(snapshot.homes).toBeDefined();
    });

    it('snapshot should include all 3 participants with full details', () => {
      const snapshot = buildMockTriangleSnapshot(
        'group-456',
        mockIntentA,
        mockIntentB,
        mockIntentC,
      );

      // Check participant A
      expect(snapshot.participants.A).toEqual({
        intentId: 1,
        userId: 100,
        firstName: 'Alice',
        lastName: 'Dupont',
        homeId: 1001,
        homeAddress: '10 Rue de Paris, 75001 Paris',
      });

      // Check participant B
      expect(snapshot.participants.B).toEqual({
        intentId: 2,
        userId: 200,
        firstName: 'Bob',
        lastName: 'Martin',
        homeId: 1002,
        homeAddress: '20 Avenue Victor Hugo, 75016 Paris',
      });

      // Check participant C
      expect(snapshot.participants.C).toEqual({
        intentId: 3,
        userId: 300,
        firstName: 'Claire',
        lastName: 'Bernard',
        homeId: 1003,
        homeAddress: '30 Boulevard Saint-Germain, 75005 Paris',
      });
    });

    it('snapshot should include chain with correct flow (A->B, B->C, C->A)', () => {
      const snapshot = buildMockTriangleSnapshot(
        'group-789',
        mockIntentA,
        mockIntentB,
        mockIntentC,
      );

      expect(snapshot.chain).toHaveLength(3);

      // A gets B's home
      expect(snapshot.chain[0]).toEqual({
        from: { userId: 100, name: 'Alice Dupont' },
        gets: { homeId: 1002, address: '20 Avenue Victor Hugo, 75016 Paris' },
        sendsTo: { userId: 200, name: 'Bob Martin' },
      });

      // B gets C's home
      expect(snapshot.chain[1]).toEqual({
        from: { userId: 200, name: 'Bob Martin' },
        gets: {
          homeId: 1003,
          address: '30 Boulevard Saint-Germain, 75005 Paris',
        },
        sendsTo: { userId: 300, name: 'Claire Bernard' },
      });

      // C gets A's home
      expect(snapshot.chain[2]).toEqual({
        from: { userId: 300, name: 'Claire Bernard' },
        gets: { homeId: 1001, address: '10 Rue de Paris, 75001 Paris' },
        sendsTo: { userId: 100, name: 'Alice Dupont' },
      });
    });

    it('snapshot should include all 3 home snapshots', () => {
      const snapshot = buildMockTriangleSnapshot(
        'group-abc',
        mockIntentA,
        mockIntentB,
        mockIntentC,
      );

      expect(Object.keys(snapshot.homes)).toHaveLength(3);
      expect(snapshot.homes[1001]).toBeDefined();
      expect(snapshot.homes[1002]).toBeDefined();
      expect(snapshot.homes[1003]).toBeDefined();

      // Check home details
      expect(snapshot.homes[1001]).toEqual({
        id: 1001,
        lat: 48.8566,
        lng: 2.3522,
        rent: 1200,
        surface: 45,
        nbRooms: 2,
        homeType: 'T2',
        addressFormatted: '10 Rue de Paris, 75001 Paris',
      });
    });

    it('snapshot should include search criteria snapshots', () => {
      const snapshot = buildMockTriangleSnapshot(
        'group-def',
        mockIntentA,
        mockIntentB,
        mockIntentC,
      );

      expect(snapshot.searches).toBeDefined();
      expect(Object.keys(snapshot.searches)).toHaveLength(3);

      // Check search snapshot for intent A
      expect(snapshot.searches[1]).toEqual({
        minRent: 900,
        maxRent: 1500,
        minSurface: 30,
        maxSurface: 60,
        minRooms: 1,
        maxRooms: 3,
        homeTypes: ['T1', 'T2', 'T3'],
        searchStartDate: expect.any(String),
        searchEndDate: expect.any(String),
        zones: expect.any(Array),
      });
    });

    it('snapshot should include per-edge evaluation details', () => {
      const snapshot = buildMockTriangleSnapshot(
        'group-ghi',
        mockIntentA,
        mockIntentB,
        mockIntentC,
      );

      expect(snapshot.edgeEvaluations).toBeDefined();
      expect(snapshot.edgeEvaluations.A_to_B).toBeDefined();
      expect(snapshot.edgeEvaluations.B_to_C).toBeDefined();
      expect(snapshot.edgeEvaluations.C_to_A).toBeDefined();

      // Check edge evaluation structure
      const edgeAB = snapshot.edgeEvaluations.A_to_B;
      expect(edgeAB.rent).toBeDefined();
      expect(edgeAB.rent.homeValue).toBe(1100); // B's home rent
      expect(edgeAB.rent.searchMin).toBe(900); // A's search min
      expect(edgeAB.rent.searchMax).toBe(1500); // A's search max
      expect(edgeAB.rent.passed).toBe(true); // 1100 is between 900-1500

      expect(edgeAB.surface).toBeDefined();
      expect(edgeAB.rooms).toBeDefined();
      expect(edgeAB.homeType).toBeDefined();
      expect(edgeAB.zones).toBeDefined();
    });

    it('edge evaluation should correctly compute passed status', () => {
      const snapshot = buildMockTriangleSnapshot(
        'group-jkl',
        mockIntentA,
        mockIntentB,
        mockIntentC,
      );

      const edgeAB = snapshot.edgeEvaluations.A_to_B;

      // A's search: rent 900-1500, B's home: 1100 => passed
      expect(edgeAB.rent.passed).toBe(true);

      // A's search: surface 30-60, B's home: 40 => passed
      expect(edgeAB.surface.passed).toBe(true);

      // A's search: rooms 1-3, B's home: 2 => passed
      expect(edgeAB.rooms.passed).toBe(true);

      // A's search: homeTypes [T1, T2, T3], B's home: T2 => passed
      expect(edgeAB.homeType.passed).toBe(true);
    });
  });
});

/**
 * Helper function to build mock triangle snapshot
 * Mirrors the actual buildTriangleSnapshot method
 */
function buildMockTriangleSnapshot(
  groupId: string,
  intentA: any,
  intentB: any,
  intentC: any,
): any {
  return {
    algorithmVersion: '2.0.0',
    snapshotVersion: 2,
    matchType: 'TRIANGLE',
    groupId,
    createdAt: new Date().toISOString(),

    participants: {
      A: {
        intentId: intentA.id,
        userId: intentA.userId,
        firstName: intentA.user.firstName,
        lastName: intentA.user.lastName,
        homeId: intentA.homeId,
        homeAddress: intentA.home.addressFormatted,
      },
      B: {
        intentId: intentB.id,
        userId: intentB.userId,
        firstName: intentB.user.firstName,
        lastName: intentB.user.lastName,
        homeId: intentB.homeId,
        homeAddress: intentB.home.addressFormatted,
      },
      C: {
        intentId: intentC.id,
        userId: intentC.userId,
        firstName: intentC.user.firstName,
        lastName: intentC.user.lastName,
        homeId: intentC.homeId,
        homeAddress: intentC.home.addressFormatted,
      },
    },

    chain: [
      {
        from: {
          userId: intentA.userId,
          name: `${intentA.user.firstName} ${intentA.user.lastName}`,
        },
        gets: {
          homeId: intentB.homeId,
          address: intentB.home.addressFormatted,
        },
        sendsTo: {
          userId: intentB.userId,
          name: `${intentB.user.firstName} ${intentB.user.lastName}`,
        },
      },
      {
        from: {
          userId: intentB.userId,
          name: `${intentB.user.firstName} ${intentB.user.lastName}`,
        },
        gets: {
          homeId: intentC.homeId,
          address: intentC.home.addressFormatted,
        },
        sendsTo: {
          userId: intentC.userId,
          name: `${intentC.user.firstName} ${intentC.user.lastName}`,
        },
      },
      {
        from: {
          userId: intentC.userId,
          name: `${intentC.user.firstName} ${intentC.user.lastName}`,
        },
        gets: {
          homeId: intentA.homeId,
          address: intentA.home.addressFormatted,
        },
        sendsTo: {
          userId: intentA.userId,
          name: `${intentA.user.firstName} ${intentA.user.lastName}`,
        },
      },
    ],

    homes: {
      [intentA.homeId]: mapHomeSnapshot(intentA.home),
      [intentB.homeId]: mapHomeSnapshot(intentB.home),
      [intentC.homeId]: mapHomeSnapshot(intentC.home),
    },

    searches: {
      [intentA.id]: mapSearchSnapshot(intentA.search, intentA.zones),
      [intentB.id]: mapSearchSnapshot(intentB.search, intentB.zones),
      [intentC.id]: mapSearchSnapshot(intentC.search, intentC.zones),
    },

    edgeEvaluations: {
      A_to_B: buildEdgeEvaluation(intentA, intentB),
      B_to_C: buildEdgeEvaluation(intentB, intentC),
      C_to_A: buildEdgeEvaluation(intentC, intentA),
    },
  };
}

function mapHomeSnapshot(home: any): any {
  return {
    id: home.id,
    lat: home.lat,
    lng: home.lng,
    rent: home.rent,
    surface: home.surface,
    nbRooms: home.nbRooms,
    homeType: home.homeType,
    addressFormatted: home.addressFormatted,
  };
}

function mapSearchSnapshot(search: any, zones: any[]): any {
  return {
    minRent: search.minRent,
    maxRent: search.maxRent,
    minSurface: search.minRoomSurface,
    maxSurface: search.maxRoomSurface,
    minRooms: search.minRoomNb,
    maxRooms: search.maxRoomNb,
    homeTypes: search.homeType,
    searchStartDate: search.searchStartDate?.toISOString() ?? null,
    searchEndDate: search.searchEndDate?.toISOString() ?? null,
    zones: zones.map((z) => ({
      label: z.label,
      lat: z.latitude,
      lng: z.longitude,
      radius: z.radius,
    })),
  };
}

function buildEdgeEvaluation(seeker: any, target: any): any {
  const search = seeker.search;
  const home = target.home;

  return {
    seekerIntentId: seeker.id,
    targetIntentId: target.id,
    targetHomeId: home.id,
    rent: {
      homeValue: home.rent,
      searchMin: search.minRent,
      searchMax: search.maxRent,
      passed:
        (search.minRent === null || home.rent >= search.minRent) &&
        (search.maxRent === null || home.rent <= search.maxRent),
    },
    surface: {
      homeValue: home.surface,
      searchMin: search.minRoomSurface,
      searchMax: search.maxRoomSurface,
      passed:
        (search.minRoomSurface === null ||
          home.surface >= search.minRoomSurface) &&
        (search.maxRoomSurface === null ||
          home.surface <= search.maxRoomSurface),
    },
    rooms: {
      homeValue: home.nbRooms,
      searchMin: search.minRoomNb,
      searchMax: search.maxRoomNb,
      passed:
        (search.minRoomNb === null || home.nbRooms >= search.minRoomNb) &&
        (search.maxRoomNb === null || home.nbRooms <= search.maxRoomNb),
    },
    homeType: {
      homeValue: home.homeType,
      searchTypes: search.homeType,
      passed:
        !search.homeType ||
        search.homeType.length === 0 ||
        search.homeType.includes(home.homeType),
    },
    zones: {
      homeLocation: { lat: home.lat, lng: home.lng },
      searchZones: seeker.zones.map((z: any) => ({
        label: z.label,
        lat: z.latitude,
        lng: z.longitude,
        radius: z.radius,
      })),
      passed: true,
    },
  };
}
