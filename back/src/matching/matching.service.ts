import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HomeType } from '@prisma/client';

@Injectable()
export class MatchingService {
  constructor(private prisma: PrismaService) {}

  // The Core Matching Algorithm
  async findMatchesForUser(userId: number) {
    // 1. Get User's Search Criteria
    const userSearch = await this.prisma.search.findFirst({
      where: { userId },
    });

    if (!userSearch) {
      return []; // No criteria, no matches
    }

    // 2. Find Homes that match criteria AND are "In Flow" (via Intent)
    // We look for Intents that have a Home attached and are active (isInFlow = true)
    // And we filter those Homes based on Search criteria

    const potentialMatches = await this.prisma.intent.findMany({
      where: {
        isInFlow: true,
        home: {
          // Exclude own home if any (optional, but good practice)
          userId: { not: userId },

          // Rent Criteria
          rent: {
            gte: userSearch.minRent || 0,
            lte: userSearch.maxRent || 100000,
          },

          // Surface Criteria
          surface: {
            gte: userSearch.minRoomSurface || 0,
            lte: userSearch.maxRoomSurface || 10000,
          },

          // Room Count Criteria
          nbRooms: {
            gte: userSearch.minRoomNb || 0,
            lte: userSearch.maxRoomNb || 100,
          },

          // Type Criteria (Exact match if specified)
          ...(userSearch.homeType
            ? { homeType: userSearch.homeType as HomeType }
            : {}),
        },
      },
      include: {
        home: {
          include: {
            images: true, // Include images for the UI
          },
        },
        user: {
          select: {
            firstName: true, // Partial info
            // Do NOT select contact info here
          },
        },
      },
    });

    return potentialMatches;
  }

  // User accepts a match -> Create Chat/Match
  async acceptMatch(userId: number, intentId: number) {
    // Logic to create a 'Chat' or 'Match' record
    // For V1, we can assume immediate match or wait for mutual.
    // Spec says: "User A requests contact... User B accepts"

    // This part requires the Chat/Match entity logic which we can scaffold next.
    return { message: 'Match requested', intentId };
  }
}
