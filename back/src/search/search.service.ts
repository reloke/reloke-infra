import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateSearchDto,
  UpdateSearchDto,
  SearchResponseDto,
  SearchZoneResponseDto,
  UpdateSearchPeriodDto,
  StopSearchResponseDto,
  UpdatePeriodResponseDto,
} from './dto/search.dto';
import { HomeType } from '../home/dto/home-type.enum';
import { SearchMaintenanceService } from './search-maintenance.service';
import {
  assertValidTimeZone,
  assertValidYmd,
  dateToUtcYmd,
  formatTodayYmd,
  ymdToKey,
  ymdToUtcDate,
} from './date-utils';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private prisma: PrismaService,
    private readonly maintenanceService: SearchMaintenanceService,
  ) { }

  /**
   * Creates a new search profile for a user
   */
  async create(
    userId: number,
    dto: CreateSearchDto,
  ): Promise<SearchResponseDto> {
    // Validate business rules
    const { startYmd, endYmd } = this.validateSearchData(dto);

    // Check if user already has a search
    const existingSearch = await this.prisma.search.findFirst({
      where: { userId },
    });

    if (existingSearch) {
      // Update existing search instead of creating new one
      return this.update(existingSearch.id, userId, dto);
    }

    // Create search with zones in a transaction
    const search = await this.prisma.safeTransaction(async (tx) => {
      const newSearch = await tx.search.create({
        data: {
          userId,
          minRent: dto.minRent ?? null,
          maxRent: dto.maxRent,
          minRoomSurface: dto.minRoomSurface ?? null,
          maxRoomSurface: dto.maxRoomSurface ?? null,
          minRoomNb: dto.minRoomNb ?? null,
          maxRoomNb: dto.maxRoomNb ?? null,
          homeType:
            dto.homeTypes && dto.homeTypes.length > 0
              ? dto.homeTypes
              : Prisma.JsonNull,
          searchStartDate: ymdToUtcDate(startYmd),
          searchEndDate: ymdToUtcDate(endYmd),
        },
      });

      // Create zones
      await tx.searchAdress.createMany({
        data: dto.zones.map((zone) => ({
          searchId: newSearch.id,
          latitude: zone.latitude,
          longitude: zone.longitude,
          radius: zone.radius,
          label: zone.label,
        })),
      });

      await this.ensureIntentLinks(tx, userId, null, newSearch.id);

      const fullSearch = await tx.search.findUnique({
        where: { id: newSearch.id },
        include: {
          searchAdresses: true,
          intents: {
            select: {
              isActivelySearching: true,
              searchStoppedAt: true,
            },
          },
        },
      });

      return fullSearch;
    });

    this.logger.log(`Search created for user ${userId}`);
    return this.mapToResponseDto(search);
  }

  /**
   * Finds the search profile for a user
   */
  async findOneByUserId(userId: number): Promise<SearchResponseDto | null> {
    const search = await this.prisma.search.findFirst({
      where: { userId },
      include: {
        searchAdresses: true,
        intents: {
          select: {
            isActivelySearching: true,
            searchStoppedAt: true,
          },
        },
      },
    });

    if (!search) {
      return null;
    }

    return this.mapToResponseDto(search);
  }

  /**
   * Updates an existing search profile
   */
  async update(
    id: number,
    userId: number,
    dto: UpdateSearchDto,
  ): Promise<SearchResponseDto> {
    // Validate business rules
    const { startYmd, endYmd } = this.validateSearchData(dto);

    // Check ownership
    const existingSearch = await this.prisma.search.findFirst({
      where: { id, userId },
    });

    if (!existingSearch) {
      throw new NotFoundException(
        'Recherche introuvable ou accès non autorisé',
      );
    }

    // Update search and zones in a transaction
    const search = await this.prisma.safeTransaction(async (tx) => {
      // Update search
      await tx.search.update({
        where: { id },
        data: {
          minRent: dto.minRent ?? null,
          maxRent: dto.maxRent,
          minRoomSurface: dto.minRoomSurface ?? null,
          maxRoomSurface: dto.maxRoomSurface ?? null,
          minRoomNb: dto.minRoomNb ?? null,
          maxRoomNb: dto.maxRoomNb ?? null,
          homeType:
            dto.homeTypes && dto.homeTypes.length > 0
              ? dto.homeTypes
              : Prisma.JsonNull,
          searchStartDate: ymdToUtcDate(startYmd),
          searchEndDate: ymdToUtcDate(endYmd),
        },
      });

      // Delete old zones and create new ones
      await tx.searchAdress.deleteMany({
        where: { searchId: id },
      });

      await tx.searchAdress.createMany({
        data: dto.zones.map((zone) => ({
          searchId: id,
          latitude: zone.latitude,
          longitude: zone.longitude,
          radius: zone.radius,
          label: zone.label,
        })),
      });

      await this.ensureIntentLinks(tx, userId, null, id);

      const updated = await tx.search.findUnique({
        where: { id },
        include: {
          searchAdresses: true,
          intents: {
            select: {
              isActivelySearching: true,
              searchStoppedAt: true,
            },
          },
        },
      });

      return updated;
    });

    this.logger.log(`Search ${id} updated for user ${userId}`);
    return this.mapToResponseDto(search);
  }


  /**
   * Validates search data according to business rules
   */
  private validateSearchData(
    dto: CreateSearchDto | UpdateSearchDto | UpdateSearchPeriodDto,
  ): { startYmd: string; endYmd: string; timeZone: string; todayYmd: string } {
    console.log(dto, 'before');
    const timeZone = assertValidTimeZone(dto.clientTimeZone);
    console.log(dto, 'after');

    let startYmd: string;
    let endYmd: string;
    try {
      startYmd = assertValidYmd(dto.searchStartDate, 'searchStartDate');
      endYmd = assertValidYmd(dto.searchEndDate, 'searchEndDate');
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const todayYmd = formatTodayYmd(timeZone);
    const todayKey = ymdToKey(todayYmd);
    const startKey = ymdToKey(startYmd);
    const endKey = ymdToKey(endYmd);

    // Validate dates (date-only)
    if (startKey < todayKey) {
      throw new BadRequestException(
        "La date de début ne peut pas être antérieure à aujourd'hui",
      );
    }

    if (endKey < todayKey) {
      throw new BadRequestException(
        "La date de fin ne peut pas être antérieure à aujourd'hui",
      );
    }

    if (endKey < startKey) {
      throw new BadRequestException(
        'La date de fin doit être postérieure ou égale à la date de début',
      );
    }

    // Validate budget min/max
    if (
      'minRent' in dto &&
      'maxRent' in dto &&
      dto.minRent !== undefined &&
      dto.minRent !== null &&
      dto.maxRent !== undefined
    ) {
      if (dto.minRent > dto.maxRent) {
        throw new BadRequestException(
          'Le loyer minimum ne peut pas être supérieur au loyer maximum',
        );
      }
    }

    // Validate surface min/max
    if (
      'minRoomSurface' in dto &&
      'maxRoomSurface' in dto &&
      dto.minRoomSurface !== undefined &&
      dto.minRoomSurface !== null &&
      dto.maxRoomSurface !== undefined &&
      dto.maxRoomSurface !== null
    ) {
      if (dto.minRoomSurface > dto.maxRoomSurface) {
        throw new BadRequestException(
          'La surface minimum ne peut pas être supérieure à la surface maximum',
        );
      }
    }

    // Validate rooms min/max
    if (
      'minRoomNb' in dto &&
      'maxRoomNb' in dto &&
      dto.minRoomNb !== undefined &&
      dto.minRoomNb !== null &&
      dto.maxRoomNb !== undefined &&
      dto.maxRoomNb !== null
    ) {
      if (dto.minRoomNb > dto.maxRoomNb) {
        throw new BadRequestException(
          'Le nombre de pièces minimum ne peut pas être supérieur au maximum',
        );
      }
    }

    // Validate zones
    if ('zones' in dto && Array.isArray(dto.zones)) {
      for (const zone of dto.zones) {
        if (
          zone.latitude < -90 ||
          zone.latitude > 90 ||
          zone.longitude < -180 ||
          zone.longitude > 180
        ) {
          throw new BadRequestException('Coordonnées géographiques invalides');
        }
      }
    }

    return { startYmd, endYmd, timeZone, todayYmd };
  }

  /**
   * Maps Prisma search to response DTO
   */
  private mapToResponseDto(search: any): SearchResponseDto {
    const zones: SearchZoneResponseDto[] = search.searchAdresses.map(
      (addr: any) => ({
        id: addr.id,
        latitude: addr.latitude,
        longitude: addr.longitude,
        radius: addr.radius,
        label: addr.label,
      }),
    );

    return {
      id: search.id,
      minRent: search.minRent,
      maxRent: search.maxRent,
      minRoomSurface: search.minRoomSurface,
      maxRoomSurface: search.maxRoomSurface,
      minRoomNb: search.minRoomNb,
      maxRoomNb: search.maxRoomNb,
      homeTypes: search.homeType as HomeType[] | null,
      searchStartDate: dateToUtcYmd(search.searchStartDate),
      searchEndDate: dateToUtcYmd(search.searchEndDate),
      zones,
      isActivelySearching: search.intents?.isActivelySearching ?? true,
      searchStoppedAt: search.intents?.searchStoppedAt?.toISOString() ?? null,
    };
  }

  private async ensureIntentLinks(
    tx: any,
    userId: number,
    homeId: number | null,
    searchId: number | null,
  ): Promise<void> {
    const intent = await tx.intent.findFirst({
      where: { userId },
      select: {
        id: true,
        homeId: true,
        searchId: true,
        numberOfMatch: true,
        totalMatchesPurchased: true,
        totalMatchesUsed: true,
        totalMatchesRemaining: true,
        isInFlow: true,
      },
    });

    if (intent) {
      await tx.intent.update({
        where: { id: intent.id },
        data: {
          homeId: intent.homeId ?? homeId,
          searchId: searchId ?? intent.searchId,
          isActivelySearching: true,
          searchStoppedAt: null,
        },
      });
      return;
    }

    await tx.intent.create({
      data: {
        userId,
        homeId,
        searchId,
        numberOfMatch: 0,
        isInFlow: false,
        totalMatchesPurchased: 0,
        totalMatchesUsed: 0,
        totalMatchesRemaining: 0,
      },
    });
  }

  // ============================================================
  // Search Activity Control
  // ============================================================

  /**
   * Stop search - user no longer wants to receive matches/emails
   * Sets isActivelySearching=false and isInFlow=false
   */
  async stopSearch(userId: number): Promise<StopSearchResponseDto> {
    const intent = await this.prisma.intent.findFirst({
      where: { userId },
      select: { id: true },
    });

    if (!intent) {
      throw new NotFoundException(
        'Aucune intention trouvée pour cet utilisateur',
      );
    }

    const metrics = await this.maintenanceService.stopAndCleanupUsers(
      [userId],
      {
        archiveMatches: true,
        stopIntents: true,
        now: new Date(),
      },
    );

    this.logger.log(
      `User ${userId} stopped search - matchesArchived=${metrics.matchesArchived} searchAdressesDeleted=${metrics.searchAdressesDeleted} homeImagesDeleted=${metrics.homeImgsDeleted} s3Keys=${metrics.s3KeysAttempted}`,
    );

    return {
      success: true,
      message:
        'Votre recherche a été arrêtée et vos informations ont été effacées.',
      cleared: {
        intentStopped: true,
        searchCleared: true,
        homeCleared: true,
        searchAdressesDeleted: metrics.searchAdressesDeleted,
        homeImgsDeleted: metrics.homeImgsDeleted,
        s3KeysAttempted: metrics.s3KeysAttempted,
      },
    };
  }

  /**
   * Restart search - user wants to receive matches/emails again
   * Clears searchStoppedAt and re-enables activity flags
   */
  async restartSearch(userId: number): Promise<StopSearchResponseDto> {
    const intent = await this.prisma.intent.findFirst({
      where: { userId },
    });

    if (!intent) {
      throw new NotFoundException(
        'Aucune intention trouvée pour cet utilisateur',
      );
    }

    await this.prisma.intent.update({
      where: { id: intent.id },
      data: {
        isActivelySearching: true,
        isInFlow: true,
        searchStoppedAt: null,
      },
    });

    this.logger.log(`User ${userId} restarted search (intent ${intent.id})`);

    return {
      success: true,
      message: 'Votre recherche a été relancée.',
    };
  }

  /**
   * Update only the search period dates
   * Also re-enables isActivelySearching if it was disabled
   */
  async updatePeriod(
    userId: number,
    dto: UpdateSearchPeriodDto,
  ): Promise<UpdatePeriodResponseDto> {
    const { startYmd, endYmd } = this.validateSearchData(dto);
    const startDate = ymdToUtcDate(startYmd);
    const endDate = ymdToUtcDate(endYmd);

    // Find user's search and intent
    const search = await this.prisma.search.findFirst({
      where: { userId },
    });

    if (!search) {
      throw new NotFoundException(
        'Aucune recherche trouvée pour cet utilisateur',
      );
    }

    // Update search dates and re-enable isActivelySearching in transaction
    await this.prisma.safeTransaction(async (tx) => {
      await tx.search.update({
        where: { id: search.id },
        data: {
          searchStartDate: startDate,
          searchEndDate: endDate,
        },
      });

      // Re-enable isActivelySearching when user updates their period
      await tx.intent.updateMany({
        where: { userId },
        data: { isActivelySearching: true, searchStoppedAt: null },
      });
    });

    this.logger.log(
      `User ${userId} updated search period: ${startYmd} to ${endYmd}`,
    );

    return {
      success: true,
      searchStartDate: startYmd,
      searchEndDate: endYmd,
    };
  }
}
