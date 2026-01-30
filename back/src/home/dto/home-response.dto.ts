import { HomeType } from './home-type.enum';

export class HomeImageResponseDto {
  id: number;
  url: string;
  publicUrl: string;
  homeId: number;
  order: number;
  createdAt: Date;
}

export class HomeResponseDto {
  id: number;
  userId: number;
  addressFormatted: string;
  addressPlaceId: string;
  lat: number;
  lng: number;
  homeType: HomeType;
  nbRooms: number;
  surface: number;
  rent: number;
  description?: string;
  images: HomeImageResponseDto[];
}
