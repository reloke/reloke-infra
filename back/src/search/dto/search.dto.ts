import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsDateString,
  Min,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsNotEmpty,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HomeType } from '../../home/dto/home-type.enum';

/**
 * DTO for a search zone (geographic area)
 */
export class SearchZoneDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsNumber()
  @Min(1, { message: 'Le rayon doit être supérieur à 0' })
  radius: number;

  @IsString()
  @IsNotEmpty({ message: 'Le label de la zone est requis' })
  label: string;
}

/**
 * DTO for creating or updating a search
 */
export class CreateSearchDto {
  // Budget
  @IsNumber()
  @Min(0, { message: 'Le loyer minimum doit être positif' })
  @IsOptional()
  minRent?: number;

  @IsNumber()
  @Min(1, { message: 'Le loyer maximum doit être supérieur à 0' })
  maxRent: number;

  // Surface
  @IsNumber()
  @Min(1, { message: 'La surface minimum doit être supérieure à 0' })
  @IsOptional()
  minRoomSurface?: number;

  @IsNumber()
  @Min(1, { message: 'La surface maximum doit être supérieure à 0' })
  @IsOptional()
  maxRoomSurface?: number;

  // Number of rooms
  @IsNumber()
  @Min(1, { message: 'Le nombre de pièces minimum doit être au moins 1' })
  @IsOptional()
  minRoomNb?: number;

  @IsNumber()
  @Min(1, { message: 'Le nombre de pièces maximum doit être au moins 1' })
  @IsOptional()
  maxRoomNb?: number;

  // Housing types (array of HomeType enum values)
  @IsArray()
  @IsEnum(HomeType, { each: true, message: 'Type de logement invalide' })
  @IsOptional()
  homeTypes?: HomeType[];

  // Dates
  @IsDateString({}, { message: 'Date de début invalide' })
  searchStartDate: string;

  @IsDateString({}, { message: 'Date de fin invalide' })
  searchEndDate: string;

  @IsOptional()
  @IsString()
  clientTimeZone?: string;

  // Zones (1 to 5)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SearchZoneDto)
  @ArrayMinSize(1, { message: 'Au moins une zone de recherche est requise' })
  @ArrayMaxSize(5, { message: 'Maximum 5 zones de recherche autorisées' })
  zones: SearchZoneDto[];
}

export class UpdateSearchDto extends CreateSearchDto {}

/**
 * Response DTO for a search zone
 */
export class SearchZoneResponseDto {
  id: number;
  latitude: number;
  longitude: number;
  radius: number;
  label: string;
}

/**
 * Response DTO for a search
 */
export class SearchResponseDto {
  id: number;
  minRent: number | null;
  maxRent: number | null;
  minRoomSurface: number | null;
  maxRoomSurface: number | null;
  minRoomNb: number | null;
  maxRoomNb: number | null;
  homeTypes: HomeType[] | null;
  searchStartDate: string | null;
  searchEndDate: string | null;
  zones: SearchZoneResponseDto[];
  isActivelySearching: boolean;
  searchStoppedAt: string | null;
}

/**
 * DTO for updating only the search period dates
 */
export class UpdateSearchPeriodDto {
  @IsDateString({}, { message: 'Date de début invalide' })
  searchStartDate: string;

  @IsDateString({}, { message: 'Date de fin invalide' })
  searchEndDate: string;

  @IsOptional()
  @IsString()
  clientTimeZone?: string;
}

/**
 * Response DTO for stop search action
 */
export class StopSearchResponseDto {
  success: boolean;
  message: string;
  cleared?: {
    intentStopped: boolean;
    searchCleared: boolean;
    homeCleared: boolean;
    searchAdressesDeleted: number;
    homeImgsDeleted: number;
    s3KeysAttempted: number;
  };
}

/**
 * Response DTO for update period action
 */
export class UpdatePeriodResponseDto {
  success: boolean;
  searchStartDate: string;
  searchEndDate: string;
}
