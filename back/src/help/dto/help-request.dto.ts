import { HelpTopic, HelpRequestStatus } from '@prisma/client';

export class HelpRequestAttachmentDto {
  id: number;
  url: string;
  order: number;
}

export class HelpRequestUserDto {
  id: number;
  firstName: string;
  lastName: string;
  mail: string;
}

export class HelpRequestDto {
  uid: string;
  topic: HelpTopic;
  description: string;
  status: HelpRequestStatus;
  createdAt: Date;
  updatedAt: Date;
  attachments: HelpRequestAttachmentDto[];

  // Only in admin view
  user?: HelpRequestUserDto;
  claimedBy?: HelpRequestUserDto | null;
  claimedAt?: Date | null;
  resolvedAt?: Date | null;
  resolutionNote?: string | null;
}

export class HelpRequestListItemDto {
  uid: string;
  topic: HelpTopic;
  status: HelpRequestStatus;
  createdAt: Date;
  user?: HelpRequestUserDto; // Admin view only
  claimedBy?: HelpRequestUserDto | null;
  hasAttachments: boolean;
}

export class PaginatedHelpRequestsDto {
  items: HelpRequestListItemDto[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
}
