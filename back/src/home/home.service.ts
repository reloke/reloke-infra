import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GooglePlacesService } from './services/google-places.service';
import { S3Service } from './services/s3.service';
import {
  CreateHomeDto,
  HomeResponseDto,
  HomeImageResponseDto,
  HomeType,
} from './dto/home.dto';

@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private prisma: PrismaService,
    private googlePlacesService: GooglePlacesService,
    private s3Service: S3Service,
  ) { }

  /**
   * Récupère le Home de l'utilisateur connecté (s'il existe)
   */
  async getHomeForUser(userId: number): Promise<HomeResponseDto | null> {
    const home = await this.prisma.home.findUnique({
      where: { userId },
      include: {
        images: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!home) {
      return null;
    }

    if (home.addressPlaceId === null) {
      // Home has been reset/cleared
      return null;
    }

    return await this.mapHomeToResponseDto(home);
  }

  /**
   * Crée ou met à jour le Home de l'utilisateur
   */
  async createOrUpdateHome(
    userId: number,
    dto: CreateHomeDto,
  ): Promise<HomeResponseDto> {
    // 3. Préparer les données
    const homeData = {
      addressFormatted: dto.addressFormatted,
      addressPlaceId: dto.addressPlaceId,
      lat: dto.lat,
      lng: dto.lng,
      homeType: dto.homeType,
      nbRooms: dto.nbRooms,
      surface: dto.surface,
      rent: dto.rent,
      description: dto.description,
    };

    // 4. Vérifier si un home existe déjà
    const existingHome = await this.prisma.home.findUnique({
      where: { userId },
    });

    const home = await this.prisma.safeTransaction(async (tx) => {
      let updatedHome;
      if (existingHome) {
        updatedHome = await tx.home.update({
          where: { userId },
          data: homeData,
          include: {
            images: {
              orderBy: { order: 'asc' },
            },
          },
        });
        this.logger.log(`Home updated for user ${userId}`);
      } else {
        updatedHome = await tx.home.create({
          data: {
            ...homeData,
            userId,
          },
          include: {
            images: {
              orderBy: { order: 'asc' },
            },
          },
        });
        this.logger.log(`Home created for user ${userId}`);
      }

      await this.ensureIntentLinks(tx, userId, updatedHome.id, null);
      return updatedHome;
    });

    return await this.mapHomeToResponseDto(home);
  }

  /**
   * Met à jour uniquement la description
   */
  async updateDescription(
    userId: number,
    description: string | null,
  ): Promise<HomeResponseDto> {
    const home = await this.prisma.home.findUnique({
      where: { userId },
    });

    if (!home) {
      throw new NotFoundException(
        'Aucun logement trouvé pour cet utilisateur.',
      );
    }

    const updatedHome = await this.prisma.home.update({
      where: { userId },
      data: { description },
      include: {
        images: {
          orderBy: { order: 'asc' },
        },
      },
    });

    return await this.mapHomeToResponseDto(updatedHome);
  }

  /**
   * Mappe un Home Prisma vers le DTO de réponse
   */
  private async mapHomeToResponseDto(home: any): Promise<HomeResponseDto> {
    return {
      id: home.id,
      userId: home.userId,
      addressFormatted: home.addressFormatted,
      addressPlaceId: home.addressPlaceId,
      lat: home.lat,
      lng: home.lng,
      homeType: home.homeType as HomeType,
      nbRooms: home.nbRooms,
      surface: home.surface,
      rent: home.rent,
      description: home.description,
      images: home.images
        ? await Promise.all(
          home.images.map((img: any) => this.mapImageToResponseDto(img)),
        )
        : [],
    };
  }

  private async mapImageToResponseDto(
    image: any,
  ): Promise<HomeImageResponseDto> {
    return {
      id: image.id,
      url: image.url,
      publicUrl: await this.s3Service.getPublicUrl(image.url),
      homeId: image.homeId,
      order: image.order,
      createdAt: image.createdAt,
    };
  }

  private async ensureIntentLinks(
    tx: any,
    userId: number,
    homeId: number,
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
          homeId,
          searchId: intent.searchId ?? searchId,
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
}
