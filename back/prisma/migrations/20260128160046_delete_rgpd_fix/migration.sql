-- CreateEnum
CREATE TYPE "HomeType" AS ENUM ('CHAMBRE', 'STUDIO', 'T1', 'T1_BIS', 'T2', 'T2_BIS', 'T3', 'T3_BIS', 'T4', 'T5', 'T6_PLUS');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'NOT_INTERESTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('STANDARD', 'TRIANGLE');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'REQUIRES_INPUT', 'CANCELED', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'SYSTEM', 'CONTACT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'RESOLVED', 'DISMISSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('Home', 'Search', 'Intent', 'SearchAdress', 'User');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('http', 'cron', 'system');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MESSAGE', 'MATCH', 'SYSTEM');

-- CreateEnum
CREATE TYPE "HelpTopic" AS ENUM ('HOME', 'SEARCH', 'SEARCH_CRITERIA', 'MATCHES', 'PAYMENTS', 'OTHER');

-- CreateEnum
CREATE TYPE "HelpRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AdminAuditAction" AS ENUM ('VIEW_USER_CONTEXT', 'VIEW_TRANSACTION', 'BAN_USER', 'UNBAN_USER', 'CLAIM_HELP_REQUEST', 'RESOLVE_HELP_REQUEST', 'RELEASE_HELP_REQUEST', 'VIEW_HELP_REQUEST', 'EXPORT_DATA', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "uid" TEXT NOT NULL,
    "firstName" VARCHAR(50) NOT NULL,
    "lastName" VARCHAR(50) NOT NULL,
    "mail" VARCHAR(255) NOT NULL,
    "dateLastConnection" TIMESTAMP(3) NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "isActif" BOOLEAN NOT NULL DEFAULT false,
    "isKycVerified" BOOLEAN NOT NULL DEFAULT false,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "kycReason" TEXT,
    "kycAttempts" INTEGER NOT NULL DEFAULT 0,
    "kycLastError" TEXT,
    "accountValidatedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "paypaldId" TEXT,
    "password" TEXT NOT NULL,
    "lastPasswordUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "resetPasswordToken" TEXT,
    "resetPasswordExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "cguAccepted" BOOLEAN NOT NULL DEFAULT false,
    "cguAcceptedAt" TIMESTAMP(3),
    "cguVersion" TEXT,
    "googleId" TEXT,
    "profilePicture" TEXT,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "banMessage" TEXT,
    "bannedAt" TIMESTAMP(3),
    "flowCooldownUntil" TIMESTAMP(3),
    "diditSessionId" TEXT,
    "stripeCustomerId" TEXT,
    "usedPromoCodeId" INTEGER,
    "influencerId" INTEGER,
    "dossierFacileUrl" TEXT,
    "isDossierValid" BOOLEAN NOT NULL DEFAULT false,
    "lastDossierCheckAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anonymizedAt" TIMESTAMP(3),
    "deletionRequestedAt" TIMESTAMP(3),
    "deletionScheduledAt" TIMESTAMP(3),
    "deletedReason" TEXT,
    "isDeletionFinalized" BOOLEAN NOT NULL DEFAULT false,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Influencer" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "influencerHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Influencer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "discountPercentage" INTEGER NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageLimit" INTEGER,
    "currentUsageCount" INTEGER NOT NULL DEFAULT 0,
    "influencerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMetadata" (
    "id" SERIAL NOT NULL,
    "inscriptionDate" TIMESTAMP(3) NOT NULL,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "UserMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectionLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "ip" TEXT NOT NULL,
    "loginDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityProof" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "IdentityProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Home" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "addressFormatted" TEXT,
    "addressPlaceId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "homeType" "HomeType",
    "nbRooms" INTEGER,
    "surface" INTEGER,
    "rent" INTEGER,
    "description" TEXT,
    "geom" geometry(Point, 4326),
    "intentId" INTEGER,

    CONSTRAINT "Home_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_images" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "homeId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "home_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intent" (
    "id" SERIAL NOT NULL,
    "intentPeriod" INTEGER,
    "intentPrice" DOUBLE PRECISION,
    "numberOfMatch" INTEGER NOT NULL DEFAULT 0,
    "isInFlow" BOOLEAN NOT NULL DEFAULT false,
    "totalMatchesPurchased" INTEGER NOT NULL DEFAULT 0,
    "totalMatchesUsed" INTEGER NOT NULL DEFAULT 0,
    "totalMatchesRemaining" INTEGER NOT NULL DEFAULT 0,
    "lastMatchesSeenAt" TIMESTAMP(3),
    "matchingProcessingUntil" TIMESTAMP(3),
    "matchingProcessingBy" TEXT,
    "lastMatchingEnqueuedAt" TIMESTAMP(3),
    "lastMatchingProcessedAt" TIMESTAMP(3),
    "refundCooldownUntil" TIMESTAMP(3),
    "lastRefundAt" TIMESTAMP(3),
    "isActivelySearching" BOOLEAN NOT NULL DEFAULT true,
    "searchStoppedAt" TIMESTAMP(3),
    "lastSearchNudgeEmailAt" TIMESTAMP(3),
    "lastSearchExpiredEmailAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "homeId" INTEGER,
    "userId" INTEGER NOT NULL,
    "searchId" INTEGER,

    CONSTRAINT "Intent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Search" (
    "id" SERIAL NOT NULL,
    "minRent" DOUBLE PRECISION,
    "maxRent" DOUBLE PRECISION,
    "minRoomSurface" INTEGER,
    "maxRoomSurface" INTEGER,
    "minRoomNb" INTEGER,
    "maxRoomNb" INTEGER,
    "homeType" JSONB,
    "searchStartDate" TIMESTAMP(3),
    "searchEndDate" TIMESTAMP(3),
    "userId" INTEGER NOT NULL,

    CONSTRAINT "Search_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchAdress" (
    "id" SERIAL NOT NULL,
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "radius" DOUBLE PRECISION,
    "label" TEXT,
    "geom" geometry(Point, 4326),
    "searchId" INTEGER NOT NULL,

    CONSTRAINT "SearchAdress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "stripeRefundId" TEXT,
    "planType" TEXT NOT NULL,
    "matchesInitial" INTEGER NOT NULL,
    "matchesUsed" INTEGER NOT NULL DEFAULT 0,
    "amountBase" DOUBLE PRECISION NOT NULL,
    "amountFees" DOUBLE PRECISION NOT NULL,
    "amountTotal" DOUBLE PRECISION NOT NULL,
    "pricePerMatch" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "matchesRefunded" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "succeededAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "userId" INTEGER NOT NULL,
    "intentId" INTEGER NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stripeEventId" TEXT,
    "stripeObjectId" TEXT,
    "amountBase" DOUBLE PRECISION,
    "amountFees" DOUBLE PRECISION,
    "amountTotal" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'eur',
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentId" INTEGER,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" SERIAL NOT NULL,
    "matchGroupId" TEXT,
    "type" "MatchType" NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatParticipant" (
    "id" SERIAL NOT NULL,
    "chatId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "fileUrl" TEXT,
    "fileType" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "contactTargetUserId" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "redactedAt" TIMESTAMP(3),
    "redactionReason" TEXT,
    "replyToId" INTEGER,
    "chatId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageImg" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,

    CONSTRAINT "MessageImg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" SERIAL NOT NULL,
    "reason" TEXT,
    "description" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reportedUserId" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "handledByAdminId" INTEGER,
    "resolutionNote" TEXT,
    "chatId" INTEGER NOT NULL,
    "messageId" INTEGER,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "snapshot" JSONB,
    "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
    "uid" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'NEW',
    "statusBeforeArchive" "MatchStatus",
    "archivedAt" TIMESTAMP(3),
    "type" "MatchType" NOT NULL DEFAULT 'STANDARD',
    "groupId" TEXT,
    "seekerIntentId" INTEGER NOT NULL,
    "targetIntentId" INTEGER NOT NULL,
    "targetHomeId" INTEGER NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" INTEGER NOT NULL,
    "userId" INTEGER,
    "action" "AuditAction" NOT NULL,
    "changedFields" JSONB NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "source" "AuditSource" NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntentEdge" (
    "id" SERIAL NOT NULL,
    "fromIntentId" INTEGER NOT NULL,
    "toIntentId" INTEGER NOT NULL,
    "score" DOUBLE PRECISION,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntentEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchingTask" (
    "id" SERIAL NOT NULL,
    "intentId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MATCHING',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "runId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DossierFacileLink" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "uuid" TEXT NOT NULL,
    "dossierFacileUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastCheckedAt" TIMESTAMP(3),
    "lastHttpCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DossierFacileLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalCase" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "holdUntil" TIMESTAMP(3),
    "internalNotes" TEXT,
    "userId" INTEGER,
    "reportId" INTEGER,
    "paymentId" INTEGER,
    "chatId" INTEGER,
    "matchGroupId" TEXT,
    "evidenceSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "runId" TEXT,
    "referenceId" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchNotificationOutbox" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "intentId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MATCHES_FOUND',
    "matchCountDelta" INTEGER NOT NULL DEFAULT 1,
    "matchType" "MatchType" NOT NULL DEFAULT 'STANDARD',
    "matchUids" JSONB,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchNotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "NotificationType" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpRequest" (
    "id" SERIAL NOT NULL,
    "uid" TEXT NOT NULL,
    "topic" "HelpTopic" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "HelpRequestStatus" NOT NULL DEFAULT 'OPEN',
    "userId" INTEGER NOT NULL,
    "claimedById" INTEGER,
    "claimedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpRequestAttachment" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "helpRequestId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpRequestAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" SERIAL NOT NULL,
    "adminId" INTEGER NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "action" "AdminAuditAction" NOT NULL,
    "targetUserId" INTEGER,
    "targetUserUid" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_uid_key" ON "User"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "User_mail_key" ON "User"("mail");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "Influencer_email_key" ON "Influencer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Influencer_influencerHash_key" ON "Influencer"("influencerHash");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCode_code_idx" ON "PromoCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UserMetadata_userId_key" ON "UserMetadata"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Home_userId_key" ON "Home"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Home_intentId_key" ON "Home"("intentId");

-- CreateIndex
CREATE INDEX "Home_lat_lng_idx" ON "Home"("lat", "lng");

-- CreateIndex
CREATE UNIQUE INDEX "Intent_homeId_key" ON "Intent"("homeId");

-- CreateIndex
CREATE UNIQUE INDEX "Intent_searchId_key" ON "Intent"("searchId");

-- CreateIndex
CREATE INDEX "Intent_isInFlow_totalMatchesRemaining_idx" ON "Intent"("isInFlow", "totalMatchesRemaining");

-- CreateIndex
CREATE INDEX "Intent_homeId_idx" ON "Intent"("homeId");

-- CreateIndex
CREATE INDEX "Intent_searchId_idx" ON "Intent"("searchId");

-- CreateIndex
CREATE INDEX "Intent_matchingProcessingUntil_idx" ON "Intent"("matchingProcessingUntil");

-- CreateIndex
CREATE INDEX "Intent_lastMatchingProcessedAt_idx" ON "Intent"("lastMatchingProcessedAt");

-- CreateIndex
CREATE INDEX "Intent_refundCooldownUntil_idx" ON "Intent"("refundCooldownUntil");

-- CreateIndex
CREATE INDEX "Intent_isActivelySearching_totalMatchesRemaining_idx" ON "Intent"("isActivelySearching", "totalMatchesRemaining");

-- CreateIndex
CREATE INDEX "Intent_lastSearchNudgeEmailAt_idx" ON "Intent"("lastSearchNudgeEmailAt");

-- CreateIndex
CREATE INDEX "Intent_lastSearchExpiredEmailAt_idx" ON "Intent"("lastSearchExpiredEmailAt");

-- CreateIndex
CREATE INDEX "Intent_userId_idx" ON "Intent"("userId");

-- CreateIndex
CREATE INDEX "Search_searchEndDate_idx" ON "Search"("searchEndDate");

-- CreateIndex
CREATE INDEX "Search_searchStartDate_idx" ON "Search"("searchStartDate");

-- CreateIndex
CREATE INDEX "SearchAdress_searchId_idx" ON "SearchAdress"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key" ON "Payment"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_intentId_idx" ON "Payment"("intentId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_stripeEventId_key" ON "Transaction"("stripeEventId");

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- CreateIndex
CREATE INDEX "Transaction_paymentId_idx" ON "Transaction"("paymentId");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_stripeEventId_idx" ON "Transaction"("stripeEventId");

-- CreateIndex
CREATE INDEX "Transaction_userId_occurredAt_id_idx" ON "Transaction"("userId", "occurredAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Chat_matchGroupId_key" ON "Chat"("matchGroupId");

-- CreateIndex
CREATE INDEX "Chat_lastMessageAt_idx" ON "Chat"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Chat_createdAt_idx" ON "Chat"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatParticipant_chatId_userId_key" ON "ChatParticipant"("chatId", "userId");

-- CreateIndex
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");

-- CreateIndex
CREATE INDEX "Message_contactTargetUserId_idx" ON "Message"("contactTargetUserId");

-- CreateIndex
CREATE INDEX "Report_reporterId_idx" ON "Report"("reporterId");

-- CreateIndex
CREATE INDEX "Report_reportedUserId_idx" ON "Report"("reportedUserId");

-- CreateIndex
CREATE INDEX "Report_chatId_idx" ON "Report"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_uid_key" ON "Match"("uid");

-- CreateIndex
CREATE INDEX "Match_seekerIntentId_status_idx" ON "Match"("seekerIntentId", "status");

-- CreateIndex
CREATE INDEX "Match_seekerIntentId_createdAt_idx" ON "Match"("seekerIntentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Match_targetIntentId_idx" ON "Match"("targetIntentId");

-- CreateIndex
CREATE INDEX "Match_type_idx" ON "Match"("type");

-- CreateIndex
CREATE INDEX "Match_groupId_idx" ON "Match"("groupId");

-- CreateIndex
CREATE INDEX "Match_groupId_type_idx" ON "Match"("groupId", "type");

-- CreateIndex
CREATE INDEX "Match_groupId_status_idx" ON "Match"("groupId", "status");

-- CreateIndex
CREATE INDEX "Match_status_archivedAt_idx" ON "Match"("status", "archivedAt");

-- CreateIndex
CREATE INDEX "Match_uid_idx" ON "Match"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "Match_seekerIntentId_targetHomeId_key" ON "Match"("seekerIntentId", "targetHomeId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "IntentEdge_fromIntentId_idx" ON "IntentEdge"("fromIntentId");

-- CreateIndex
CREATE INDEX "IntentEdge_toIntentId_idx" ON "IntentEdge"("toIntentId");

-- CreateIndex
CREATE INDEX "IntentEdge_fromIntentId_score_idx" ON "IntentEdge"("fromIntentId", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "IntentEdge_fromIntentId_toIntentId_key" ON "IntentEdge"("fromIntentId", "toIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "unique_active_task_idx" ON "MatchingTask"("intentId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "DossierFacileLink_userId_key" ON "DossierFacileLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DossierFacileLink_uuid_key" ON "DossierFacileLink"("uuid");

-- CreateIndex
CREATE INDEX "DossierFacileLink_status_idx" ON "DossierFacileLink"("status");

-- CreateIndex
CREATE INDEX "LegalCase_status_idx" ON "LegalCase"("status");

-- CreateIndex
CREATE INDEX "LegalCase_holdUntil_idx" ON "LegalCase"("holdUntil");

-- CreateIndex
CREATE INDEX "LegalCase_userId_idx" ON "LegalCase"("userId");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_type_idx" ON "NotificationLog"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_userId_type_runId_key" ON "NotificationLog"("userId", "type", "runId");

-- CreateIndex
CREATE INDEX "MatchNotificationOutbox_processedAt_availableAt_idx" ON "MatchNotificationOutbox"("processedAt", "availableAt");

-- CreateIndex
CREATE INDEX "MatchNotificationOutbox_runId_userId_idx" ON "MatchNotificationOutbox"("runId", "userId");

-- CreateIndex
CREATE INDEX "MatchNotificationOutbox_processedAt_createdAt_idx" ON "MatchNotificationOutbox"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "MatchNotificationOutbox_userId_idx" ON "MatchNotificationOutbox"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchNotificationOutbox_runId_userId_intentId_key" ON "MatchNotificationOutbox"("runId", "userId", "intentId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HelpRequest_uid_key" ON "HelpRequest"("uid");

-- CreateIndex
CREATE INDEX "HelpRequest_userId_idx" ON "HelpRequest"("userId");

-- CreateIndex
CREATE INDEX "HelpRequest_status_idx" ON "HelpRequest"("status");

-- CreateIndex
CREATE INDEX "HelpRequest_claimedById_idx" ON "HelpRequest"("claimedById");

-- CreateIndex
CREATE INDEX "HelpRequest_createdAt_idx" ON "HelpRequest"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "HelpRequest_status_createdAt_idx" ON "HelpRequest"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "HelpRequestAttachment_helpRequestId_idx" ON "HelpRequestAttachment"("helpRequestId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetUserId_createdAt_idx" ON "AdminAuditLog"("targetUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_usedPromoCodeId_fkey" FOREIGN KEY ("usedPromoCodeId") REFERENCES "PromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMetadata" ADD CONSTRAINT "UserMetadata_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectionLog" ADD CONSTRAINT "ConnectionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityProof" ADD CONSTRAINT "IdentityProof_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Home" ADD CONSTRAINT "Home_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_images" ADD CONSTRAINT "home_images_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_images" ADD CONSTRAINT "home_images_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intent" ADD CONSTRAINT "Intent_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Search" ADD CONSTRAINT "Search_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchAdress" ADD CONSTRAINT "SearchAdress_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "Search"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatParticipant" ADD CONSTRAINT "ChatParticipant_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatParticipant" ADD CONSTRAINT "ChatParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactTargetUserId_fkey" FOREIGN KEY ("contactTargetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageImg" ADD CONSTRAINT "MessageImg_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_seekerIntentId_fkey" FOREIGN KEY ("seekerIntentId") REFERENCES "Intent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_targetIntentId_fkey" FOREIGN KEY ("targetIntentId") REFERENCES "Intent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_targetHomeId_fkey" FOREIGN KEY ("targetHomeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentEdge" ADD CONSTRAINT "IntentEdge_fromIntentId_fkey" FOREIGN KEY ("fromIntentId") REFERENCES "Intent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentEdge" ADD CONSTRAINT "IntentEdge_toIntentId_fkey" FOREIGN KEY ("toIntentId") REFERENCES "Intent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchingTask" ADD CONSTRAINT "MatchingTask_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "Intent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DossierFacileLink" ADD CONSTRAINT "DossierFacileLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpRequest" ADD CONSTRAINT "HelpRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpRequest" ADD CONSTRAINT "HelpRequest_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpRequestAttachment" ADD CONSTRAINT "HelpRequestAttachment_helpRequestId_fkey" FOREIGN KEY ("helpRequestId") REFERENCES "HelpRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
