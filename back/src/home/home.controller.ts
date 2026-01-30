import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { HomeService } from './home.service';
import { HomeImagesService } from './services/home-images.service';
import {
  CreateHomeDto,
  UpdateHomeDescriptionDto,
  HomeResponseDto,
  HomeImageResponseDto,
} from './dto/home.dto';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 10;

const multerOptions = {
  limits: {
    fileSize: MAX_IMAGE_SIZE,
  },
  fileFilter: (req, file, callback) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (!validTypes.includes(file.mimetype)) {
      return callback(
        new BadRequestException(
          `Le fichier "${file.originalname}" n'est pas une image valide (JPEG, PNG, WebP, HEIC).`,
        ),
        false,
      );
    }
    callback(null, true);
  },
};

@Controller('homes')
@UseGuards(AuthGuard('jwt'))
export class HomeController {
  constructor(
    private readonly homeService: HomeService,
    private readonly homeImagesService: HomeImagesService,
  ) {}

  /**
   * GET /homes/me
   * Récupère le Home de l'utilisateur connecté
   */
  @Get('me')
  async getMyHome(@Request() req): Promise<HomeResponseDto | null> {
    console.log(req.user.userId);
    return this.homeService.getHomeForUser(req.user.userId);
  }

  /**
   * POST /homes
   * Crée ou met à jour le Home de l'utilisateur
   */
  @Post()
  async createOrUpdateHome(
    @Request() req,
    @Body() dto: CreateHomeDto,
  ): Promise<HomeResponseDto> {
    return this.homeService.createOrUpdateHome(req.user.userId, dto);
  }

  /**
   * PUT /homes/description
   * Met à jour uniquement la description
   */
  @Put('description')
  async updateDescription(
    @Request() req,
    @Body() dto: UpdateHomeDescriptionDto,
  ): Promise<HomeResponseDto> {
    return this.homeService.updateDescription(
      req.user.userId,
      dto.description || null,
    );
  }

  /**
   * GET /homes/:homeId/images
   * Récupère les images d'un Home
   */
  @Get(':homeId/images')
  async getHomeImages(
    @Request() req,
    @Param('homeId', ParseIntPipe) homeId: number,
  ): Promise<HomeImageResponseDto[]> {
    return this.homeImagesService.getImagesByHome(homeId, req.user.userId);
  }

  /**
   * POST /homes/:homeId/images
   * Upload des images pour un Home (3-10 images)
   */
  @Post(':homeId/images')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES, multerOptions))
  async uploadImages(
    @Request() req,
    @Param('homeId', ParseIntPipe) homeId: number,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<HomeImageResponseDto[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Aucune image fournie.');
    }

    return this.homeImagesService.uploadImages(req.user.userId, homeId, files);
  }

  /**
   * PUT /homes/:homeId/images
   * Synchronise les images en une seule requÃªte (delete + upload)
   */
  @Put(':homeId/images')
  @UseInterceptors(FilesInterceptor('newImages', MAX_FILES, multerOptions))
  async syncImages(
    @Request() req,
    @Param('homeId', ParseIntPipe) homeId: number,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('deleteImageIds') deleteImageIds: string,
  ): Promise<HomeImageResponseDto[]> {
    const parsedDeleteIds = this.parseDeleteIds(deleteImageIds);

    return this.homeImagesService.syncImages(
      homeId,
      req.user.userId,
      parsedDeleteIds,
      files || [],
    );
  }

  /**
   * DELETE /homes/:homeId/images/:imageId
   * Supprime une image
   */
  @Delete(':homeId/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteImage(
    @Request() req,
    @Param('homeId', ParseIntPipe) homeId: number,
    @Param('imageId', ParseIntPipe) imageId: number,
  ): Promise<void> {
    await this.homeImagesService.deleteImage(imageId, req.user.userId);
  }

  /**
   * PUT /homes/:homeId/images/reorder
   * Réordonne les images
   */
  @Put(':homeId/images/reorder')
  async reorderImages(
    @Request() req,
    @Param('homeId', ParseIntPipe) homeId: number,
    @Body('imageIds') imageIds: number[],
  ): Promise<HomeImageResponseDto[]> {
    return this.homeImagesService.reorderImages(
      homeId,
      req.user.userId,
      imageIds,
    );
  }

  /**
   * GET /homes/:homeId/images/validate
   * Valide le nombre d'images
   */
  @Get(':homeId/images/validate')
  async validateImageCount(
    @Request() req,
    @Param('homeId', ParseIntPipe) homeId: number,
  ): Promise<{ valid: boolean; count: number; message?: string }> {
    return this.homeImagesService.validateImageCount(homeId);
  }

  private parseDeleteIds(deleteImageIds: string): number[] {
    if (!deleteImageIds) {
      return [];
    }

    try {
      const parsed = JSON.parse(deleteImageIds);
      if (!Array.isArray(parsed)) {
        throw new Error('deleteImageIds doit Ãªtre un tableau JSON.');
      }

      const numbers = parsed.map((value) => {
        const id = Number(value);
        if (!Number.isInteger(id)) {
          throw new Error('Chaque id doit Ãªtre un entier.');
        }
        return id;
      });

      return numbers;
    } catch (error) {
      throw new BadRequestException(
        "Le champ 'deleteImageIds' doit Ãªtre une chaÃ®ne JSON valide contenant un tableau d'entiers.",
      );
    }
  }
}
