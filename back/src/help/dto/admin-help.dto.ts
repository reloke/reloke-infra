import { IsString, IsOptional, MaxLength, IsEnum } from 'class-validator';
import { HelpRequestStatus } from '@prisma/client';

export class ClaimHelpRequestDto {
  // No body needed - admin ID comes from JWT
}

export class ResolveHelpRequestDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000, {
    message: 'La note de résolution ne peut pas dépasser 2000 caractères',
  })
  resolutionNote?: string;
}

export class ListHelpRequestsQueryDto {
  @IsOptional()
  @IsEnum(HelpRequestStatus)
  status?: HelpRequestStatus;

  @IsOptional()
  @IsString()
  cursor?: string; // uid of last item for cursor pagination

  @IsOptional()
  limit?: number;
}

// User context DTOs for admin view
export class UserHomeContextDto {
  hasHome: boolean;
  home?: {
    addressFormatted: string | null;
    homeType: string | null;
    nbRooms: number | null;
    surface: number | null;
    rent: number | null;
    imagesCount: number;
  };
}

export class UserSearchContextDto {
  hasSearch: boolean;
  search?: {
    minRent: number | null;
    maxRent: number | null;
    minRoomSurface: number | null;
    maxRoomSurface: number | null;
    homeType: string[] | null;
    searchStartDate: Date | null;
    searchEndDate: Date | null;
    zonesCount: number;
  };
}

export class UserCreditsContextDto {
  totalMatchesPurchased: number;
  totalMatchesUsed: number;
  totalMatchesRemaining: number;
  isInFlow: boolean;
  isActivelySearching: boolean;
  refundCooldownUntil: Date | null;
}

export class UserMatchContextDto {
  matchUid: string;
  status: string;
  type: string;
  createdAt: Date;
  targetHome: {
    addressFormatted: string | null;
    homeType: string | null;
    rent: number | null;
  };
}

export class UserTransactionContextDto {
  id: number;
  type: string;
  status: string;
  amountTotal: number | null;
  occurredAt: Date;
}

export class UserFullContextDto {
  user: {
    id: number;
    firstName: string;
    lastName: string;
    mail: string;
    createdAt: Date;
    isKycVerified: boolean;
    isBanned: boolean;
  };
  home: UserHomeContextDto;
  search: UserSearchContextDto;
  credits: UserCreditsContextDto;
  recentMatches: UserMatchContextDto[];
  recentTransactions: UserTransactionContextDto[];
}
