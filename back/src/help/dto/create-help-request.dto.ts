import {
  IsEnum,
  IsString,
  IsArray,
  IsOptional,
  MaxLength,
  MinLength,
  ArrayMaxSize,
} from 'class-validator';
import { HelpTopic } from '@prisma/client';

export class CreateHelpRequestDto {
  @IsEnum(HelpTopic)
  topic: HelpTopic;

  @IsString()
  @MinLength(10, {
    message: 'La description doit faire au moins 10 caractères',
  })
  @MaxLength(2000, {
    message: 'La description ne peut pas dépasser 2000 caractères',
  })
  description: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(3, { message: 'Vous pouvez ajouter au maximum 3 images' })
  @IsString({ each: true })
  attachmentKeys?: string[]; // S3 object keys from presigned upload
}
