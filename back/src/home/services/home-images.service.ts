import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from './s3.service';
import { HomeImageResponseDto } from '../dto/home.dto';

const MIN_IMAGES = 3;
const MAX_IMAGES = 10;

@Injectable()
export class HomeImagesService {
  private readonly logger = new Logger(HomeImagesService.name);

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
  ) {}

  /**
   * Synchronise les images d'un logement en une seule opÃ©ration (delete + upload)
   */
  async syncImages(
    homeId: number,
    userId: number,
    deleteIds: number[],
    newFiles: Express.Multer.File[],
  ): Promise<HomeImageResponseDto[]> {
    // Charger le home + images et vÃ©rifier ownership
    const home = await this.prisma.home.findUnique({
      where: { id: homeId },
      include: { images: true },
    });

    if (!home) {
      throw new NotFoundException('Logement non trouvÃ©.');
    }

    if (home.userId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accÃ¨s Ã  ce logement.");
    }

    const existingImages = home.images;

    // Valider deleteIds appartiennent bien au home
    const imagesToDelete = existingImages.filter((img) =>
      deleteIds.includes(img.id),
    );
    if (imagesToDelete.length !== deleteIds.length) {
      throw new NotFoundException(
        'Une ou plusieurs images Ã  supprimer sont introuvables pour ce logement.',
      );
    }

    // Calculer l'Ã©tat final
    const keptExisting = existingImages.filter(
      (img) => !deleteIds.includes(img.id),
    );
    const finalCount = keptExisting.length + newFiles.length;

    if (finalCount < MIN_IMAGES) {
      throw new BadRequestException(
        `Vous devez conserver au moins ${MIN_IMAGES} photos.`,
      );
    }

    if (finalCount > MAX_IMAGES) {
      throw new BadRequestException(
        `Vous ne pouvez pas avoir plus de ${MAX_IMAGES} photos.`,
      );
    }

    // Upload des nouveaux fichiers d'abord (pour rÃ©cupÃ©rer les keys)
    const uploaded = [] as { key: string; order: number; mime: string }[];
    try {
      let nextOrder = keptExisting.length;
      for (const file of newFiles) {
        if (!this.isValidImageType(file.mimetype)) {
          throw new BadRequestException(
            `Le fichier "${file.originalname}" n'est pas une image valide.`,
          );
        }

        const key = this.s3Service.generateObjectKey(
          userId,
          homeId,
          file.originalname,
        );

        await this.s3Service.uploadFile(file.buffer, key, file.mimetype);

        uploaded.push({ key, order: nextOrder, mime: file.mimetype });
        nextOrder++;
      }
    } catch (error) {
      // Cleanup best-effort des uploads partiels
      await this.s3Service.deleteFilesBatch(uploaded.map((u) => u.key));
      throw error;
    }

    // Transaction DB : delete + reorder kept + insert new
    await this.prisma.$transaction(async (tx) => {
      if (deleteIds.length) {
        await tx.homeImg.deleteMany({
          where: { id: { in: deleteIds }, homeId },
        });
      }

      // Recalcule l'ordre pour les images conservÃ©es
      await Promise.all(
        keptExisting
          .sort((a, b) => a.order - b.order)
          .map((img, idx) =>
            tx.homeImg.update({
              where: { id: img.id },
              data: { order: idx },
            }),
          ),
      );

      const baseOrder = keptExisting.length;
      for (const [index, upload] of uploaded.entries()) {
        await tx.homeImg.create({
          data: {
            url: upload.key,
            homeId,
            userId,
            order: baseOrder + index,
          },
        });
      }
    });

    // Supprimer de S3 les images effacÃ©es (best-effort, post-transaction)
    const keysToDelete = imagesToDelete.map((img) => img.url);
    if (keysToDelete.length) {
      await this.s3Service.deleteFilesBatch(keysToDelete);
    }

    // Retourner l'Ã©tat final
    const images = await this.prisma.homeImg.findMany({
      where: { homeId },
      orderBy: { order: 'asc' },
    });

    this.logger.log(
      `Synced images for home ${homeId} (kept=${keptExisting.length}, deleted=${deleteIds.length}, added=${uploaded.length})`,
    );

    return Promise.all(images.map((img) => this.mapToResponseDto(img)));
  }

  /**
   * Récupère toutes les images d'un Home
   */
  async getImagesByHome(
    homeId: number,
    userId: number,
  ): Promise<HomeImageResponseDto[]> {
    // Vérifier que le home appartient à l'utilisateur
    const home = await this.prisma.home.findUnique({
      where: { id: homeId },
    });

    if (!home) {
      throw new NotFoundException('Logement non trouvé.');
    }

    if (home.userId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à ce logement.");
    }

    const images = await this.prisma.homeImg.findMany({
      where: { homeId },
      orderBy: { order: 'asc' },
    });

    return await Promise.all(images.map((img) => this.mapToResponseDto(img)));
  }

  /**
   * Upload plusieurs images pour un Home
   */
  async uploadImages(
    userId: number,
    homeId: number,
    files: Express.Multer.File[],
  ): Promise<HomeImageResponseDto[]> {
    // 1. Vérifier que le home existe et appartient à l'utilisateur
    const home = await this.prisma.home.findUnique({
      where: { id: homeId },
      include: { images: true },
    });

    if (!home) {
      throw new NotFoundException('Logement non trouvé.');
    }

    if (home.userId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à ce logement.");
    }

    // 2. Valider le nombre de fichiers
    const currentImageCount = home.images.length;
    const newImageCount = files.length;
    const totalImageCount = currentImageCount + newImageCount;

    if (newImageCount === 0) {
      throw new BadRequestException('Aucune image fournie.');
    }

    if (totalImageCount > MAX_IMAGES) {
      throw new BadRequestException(
        `Vous ne pouvez pas avoir plus de ${MAX_IMAGES} photos. ` +
          `Vous en avez déjà ${currentImageCount}.`,
      );
    }

    // 3. Upload chaque fichier vers S3 et créer les enregistrements
    const uploadedImages: HomeImageResponseDto[] = [];
    let currentOrder = currentImageCount;

    for (const file of files) {
      // Valider le type de fichier
      if (!this.isValidImageType(file.mimetype)) {
        throw new BadRequestException(
          `Le fichier "${file.originalname}" n'est pas une image valide.`,
        );
      }

      // Générer la clé S3
      const key = this.s3Service.generateObjectKey(
        userId,
        homeId,
        file.originalname,
      );

      // Upload vers S3
      await this.s3Service.uploadFile(file.buffer, key, file.mimetype);

      // Créer l'enregistrement en base
      const image = await this.prisma.homeImg.create({
        data: {
          url: key,
          homeId,
          userId,
          order: currentOrder,
        },
      });

      uploadedImages.push(await this.mapToResponseDto(image));
      currentOrder++;
    }

    this.logger.log(
      `Uploaded ${uploadedImages.length} images for home ${homeId}`,
    );

    return uploadedImages;
  }

  /**
   * Supprime une image
   */
  async deleteImage(imageId: number, userId: number): Promise<void> {
    const image = await this.prisma.homeImg.findUnique({
      where: { id: imageId },
      include: { home: { include: { images: true } } },
    });

    if (!image) {
      throw new NotFoundException('Image non trouvée.');
    }

    if (image.userId !== userId) {
      throw new ForbiddenException(
        "Vous n'avez pas le droit de supprimer cette image.",
      );
    }

    // Vérifier qu'on ne descend pas en dessous du minimum
    const remainingImages = image.home.images.length - 1;
    if (remainingImages < MIN_IMAGES) {
      throw new BadRequestException(
        `Vous devez conserver au moins ${MIN_IMAGES} photos.`,
      );
    }

    // Supprimer de S3
    await this.s3Service.deleteFile(image.url);

    // Supprimer de la base
    await this.prisma.homeImg.delete({
      where: { id: imageId },
    });

    this.logger.log(`Deleted image ${imageId} for user ${userId}`);
  }

  /**
   * Réordonne les images
   */
  async reorderImages(
    homeId: number,
    userId: number,
    imageIds: number[],
  ): Promise<HomeImageResponseDto[]> {
    const home = await this.prisma.home.findUnique({
      where: { id: homeId },
      include: { images: true },
    });

    if (!home) {
      throw new NotFoundException('Logement non trouvé.');
    }

    if (home.userId !== userId) {
      throw new ForbiddenException("Vous n'avez pas accès à ce logement.");
    }

    // Mettre à jour l'ordre
    await Promise.all(
      imageIds.map((imageId, index) =>
        this.prisma.homeImg.update({
          where: { id: imageId },
          data: { order: index },
        }),
      ),
    );

    const images = await this.prisma.homeImg.findMany({
      where: { homeId },
      orderBy: { order: 'asc' },
    });

    return await Promise.all(images.map((img) => this.mapToResponseDto(img)));
  }

  /**
   * Valide le nombre total d'images pour un Home
   */
  async validateImageCount(
    homeId: number,
  ): Promise<{ valid: boolean; count: number; message?: string }> {
    const count = await this.prisma.homeImg.count({
      where: { homeId },
    });

    if (count < MIN_IMAGES) {
      return {
        valid: false,
        count,
        message: `Ajoutez au moins ${MIN_IMAGES} photos de votre logement. (${count}/${MIN_IMAGES})`,
      };
    }

    return { valid: true, count };
  }

  private isValidImageType(mimeType: string): boolean {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    return validTypes.includes(mimeType);
  }

  private async mapToResponseDto(image: any): Promise<HomeImageResponseDto> {
    return {
      id: image.id,
      url: image.url,
      publicUrl: await this.s3Service.getPublicUrl(image.url),
      homeId: image.homeId,
      order: image.order,
      createdAt: image.createdAt,
    };
  }
}
