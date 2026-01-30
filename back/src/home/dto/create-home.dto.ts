import {
  IsString,
  IsNumber,
  IsInt,
  IsOptional,
  IsEnum,
  Min,
  IsDateString,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { HomeType } from './home-type.enum';

export class CreateHomeDto {
  @IsString({ message: "L'adresse formatée est obligatoire." })
  @IsNotEmpty({ message: "L'adresse formatée ne peut pas être vide." })
  addressFormatted: string;

  @IsString({ message: "L'identifiant Google Place est obligatoire." })
  @IsNotEmpty({
    message: 'Veuillez sélectionner une adresse dans la liste proposée.',
  })
  addressPlaceId: string;

  @IsNumber({}, { message: 'La latitude doit être un nombre.' })
  @Type(() => Number)
  lat: number;

  @IsNumber({}, { message: 'La longitude doit être un nombre.' })
  @Type(() => Number)
  lng: number;

  @IsEnum(HomeType, {
    message: "Le type de logement sélectionné n'est pas valide.",
  })
  homeType: HomeType;

  @IsInt({ message: 'Le nombre de pièces doit être un nombre entier.' })
  @Min(1, { message: 'Le nombre de pièces doit être au moins 1.' })
  @Type(() => Number)
  nbRooms: number;

  @IsNumber({}, { message: 'La surface doit être un nombre.' })
  @Min(1, { message: 'La surface doit être supérieure à 0 m².' })
  @Type(() => Number)
  surface: number;

  @IsNumber({}, { message: 'Le loyer doit être un nombre.' })
  @Min(1, { message: 'Le loyer doit être supérieur à 0 €.' })
  @Type(() => Number)
  rent: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000, {
    message: 'La description ne peut pas dépasser 1000 caractères.',
  })
  description?: string;
}
