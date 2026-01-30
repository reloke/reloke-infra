import { PartialType } from '@nestjs/mapped-types';
import { CreateHomeDto } from './create-home.dto';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateHomeDto extends PartialType(CreateHomeDto) {}

export class UpdateHomeDescriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000, {
    message: 'La description ne peut pas dépasser 1000 caractères.',
  })
  description?: string;
}
