import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly bucket: string;
  private readonly region: string;
  private readonly isConfigured: boolean;
  private readonly signedUrlExpiresSeconds = 60 * 60 * 3;

  // Store credentials as safe strings
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private s3Client: S3Client | null = null;

  constructor(private configService: ConfigService) {
    this.region =
      this.configService.get<string>('AWS_S3_REGION') || 'eu-west-3';
    this.bucket = this.configService.get<string>('AWS_S3_BUCKET')!;

    // Force to string ('' if undefined) to avoid string | undefined
    this.accessKeyId =
      this.configService.get<string>('AWS_S3_ACCESS_KEY_ID') || '';
    this.secretAccessKey =
      this.configService.get<string>('AWS_S3_SECRET_ACCESS_KEY') || '';

    // S3 is configured only if everything is present and not placeholder
    this.isConfigured =
      !!this.bucket &&
      !!this.accessKeyId &&
      !!this.secretAccessKey &&
      this.accessKeyId !== 'VOTRE_ACCESS_KEY';

    if (!this.isConfigured) {
      this.logger.warn('AWS S3 is not configured - uploads are disabled');
    }
  }

  /**
   * Generate a unique key for storing an image
   */
  generateObjectKey(
    userId: number,
    homeId: number,
    originalFilename: string,
  ): string {
    const extension = this.getFileExtension(originalFilename);
    const uniqueId = randomUUID();
    return `homes/${userId}/${homeId}/${uniqueId}${extension}`;
  }

  /**
   * Upload a file to S3
   */
  async uploadFile(
    buffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<string> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        "AWS S3 n'est pas configure. L'upload des images est desactive.",
      );
    }

    return this.uploadToS3(buffer, key, mimeType);
  }

  /**
   * Upload to S3
   */
  private async uploadToS3(
    buffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<string> {
    try {
      // Dynamic import to avoid issues when AWS SDK is not installed
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const s3Client = await this.getS3Client();

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      });

      await s3Client.send(command);
      this.logger.log(`File uploaded to S3 successfully: ${key}`);

      return key;
    } catch (error) {
      this.logger.error(
        `Failed to upload file to S3: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        "Erreur lors de l'upload de l'image. Veuillez reessayer.",
      );
    }
  }

  /**
   * Delete a file from S3
   */
  async deleteFile(key: string): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(`AWS S3 not configured - skip delete for key: ${key}`);
      return;
    }

    await this.deleteFromS3(key);
  }

  /**
   * Delete from S3
   */
  private async deleteFromS3(key: string): Promise<void> {
    try {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const s3Client = await this.getS3Client();

      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await s3Client.send(command);
      this.logger.log(`File deleted from S3 successfully: ${key}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete file from S3: ${error.message}`,
        error.stack,
      );
      // Do not throw, continue even if deletion fails
    }
  }

  /**
   * Delete multiple files
   */
  async deleteFiles(keys: string[]): Promise<void> {
    await this.deleteFilesBatch(keys);
  }

  /**
   * Generate a signed (private) URL for an object
   */
  async getPublicUrl(key: string): Promise<string> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        "AWS S3 n'est pas configure. Impossible de generer l'URL.",
      );
    }

    try {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

      const s3Client = await this.getS3Client();

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      return await getSignedUrl(s3Client, command, {
        expiresIn: this.signedUrlExpiresSeconds,
      });
    } catch (error) {
      this.logger.error(
        `Failed to generate signed URL: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        "Erreur lors de la generation de l'URL de l'image.",
      );
    }
  }

  private getFileExtension(filename: string): string {
    const parts = filename.split('.');
    if (parts.length > 1) {
      return `.${parts[parts.length - 1].toLowerCase()}`;
    }
    return '.jpg';
  }

  /**
   * Generate a presigned URL for direct browser upload
   * @param folder The folder prefix (e.g., 'help-attachments')
   * @param userId The user ID
   * @param filename Original filename for extension
   * @param contentType MIME type of the file
   * @returns Object with presigned URL and the key to store
   */
  async generatePresignedUploadUrl(
    folder: string,
    userId: number,
    filename: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string }> {
    if (!this.isConfigured) {
      throw new BadRequestException(
        "AWS S3 n'est pas configure. L'upload des images est desactive.",
      );
    }

    try {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

      const extension = this.getFileExtension(filename);
      const uniqueId = randomUUID();
      const key = `${folder}/${userId}/${uniqueId}${extension}`;

      const s3Client = await this.getS3Client();

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 300, // 5 minutes to upload
      });

      this.logger.log(`Generated presigned upload URL for key: ${key}`);

      return { uploadUrl, key };
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned upload URL: ${error.message}`,
        error.stack,
      );
      throw new BadRequestException(
        "Erreur lors de la generation de l'URL d'upload.",
      );
    }
  }

  /**
   * Check if S3 is configured
   */
  isS3Configured(): boolean {
    return this.isConfigured;
  }

  /**
   * Delete multiple files in batches (up to 1000 keys per request)
   */
  async deleteFilesBatch(keys: string[]): Promise<void> {
    if (!keys || keys.length === 0) {
      return;
    }

    if (!this.isConfigured) {
      this.logger.warn(
        `AWS S3 not configured - skip batch delete for ${keys.length} keys`,
      );
      return;
    }

    try {
      const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
      const s3Client = await this.getS3Client();
      const chunkSize = 1000;

      for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize);
        try {
          const command = new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: chunk.map((key) => ({ Key: key })) },
          });

          const result = await s3Client.send(command);
          const deleted = result?.Deleted?.length ?? 0;
          const errors = result?.Errors?.length ?? 0;
          this.logger.log(
            `S3 batch delete executed for ${chunk.length} keys (deleted=${deleted}, errors=${errors})`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to delete S3 batch of ${chunk.length} keys: ${error.message}`,
            error.stack,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to initialize S3 batch delete: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Lazily instantiate and reuse the S3 client
   */
  private async getS3Client(): Promise<S3Client> {
    if (this.s3Client) {
      return this.s3Client;
    }

    const { S3Client } = await import('@aws-sdk/client-s3');
    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
    });

    return this.s3Client;
  }
}
