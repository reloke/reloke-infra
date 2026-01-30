import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';

/**
 * Didit KYC Service
 *
 * Handles identity verification via Didit's Pro workflow with:
 * - Liveness detection
 * - Document verification
 * - Name matching (firstName, lastName from DB sent as metadata)
 *
 * API Reference: https://docs.didit.me/identity-verification/
 *
 * Authentication: OAuth2 Client Credentials
 * - Token endpoint: https://apx.didit.me/auth/v2/token/
 * - Session endpoint: https://verification.didit.me/v2/session/
 */
@Injectable()
export class DiditService {
  private readonly logger = new Logger(DiditService.name);
  private readonly authBaseUrl: string;
  private readonly verificationBaseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly workflowId: string;
  private readonly webhookSecret: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    this.authBaseUrl = this.configService.get<string>(
      'DIDIT_AUTH_URL',
      'https://apx.didit.me/auth',
    );
    this.verificationBaseUrl = this.configService.get<string>(
      'DIDIT_API_BASE_URL',
      'https://verification.didit.me',
    );
    this.clientId = (
      this.configService.get<string>('DIDIT_CLIENT_ID', '') || ''
    ).trim();
    this.clientSecret = (
      this.configService.get<string>('DIDIT_CLIENT_SECRET', '') || ''
    ).trim();
    this.workflowId = (
      this.configService.get<string>('DIDIT_WORKFLOW_ID', '') || ''
    ).trim();
    this.webhookSecret = (
      this.configService.get<string>('DIDIT_WEBHOOK_SECRET', '') || ''
    ).trim();

    if (!this.clientId || !this.clientSecret || !this.workflowId) {
      this.logger.warn(
        'Didit credentials not fully configured. KYC features will be limited.',
      );
    } else {
      this.logger.log('Didit service initialized successfully');
    }
  }

  /**
   * Get or refresh the access token for Didit API
   * Uses OAuth2 client_credentials flow
   */
  private async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (
      this.accessToken &&
      this.tokenExpiresAt &&
      new Date() < this.tokenExpiresAt
    ) {
      return this.accessToken;
    }

    try {
      const url = `${this.authBaseUrl}/v2/token/`;
      this.logger.debug(`Requesting Didit access token from ${url}`);

      const authString = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString('base64');
      const authHeader = `Basic ${authString}`;

      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      // Adding these just in case the Basic Auth isn't enough
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);

      const response = await axios.post(url, params.toString(), {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      this.accessToken = response.data.access_token;
      // Token expires in `expires_in` seconds, cache with 1 minute buffer
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiresAt = new Date(Date.now() + (expiresIn - 60) * 1000);

      this.logger.log('Didit access token refreshed successfully');
      return this.accessToken!;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to get Didit access token: ${JSON.stringify(axiosError.response?.data) || axiosError.message}`,
      );
      throw new Error('Failed to authenticate with Didit API');
    }
  }

  /**
   * Create a verification session for a user
   *
   * @param userId - Internal user ID
   * @param firstName - User's first name (for name matching)
   * @param lastName - User's last name (for name matching)
   * @returns Session data including verification URL
   */
  async createVerificationSession(
    userId: number,
    firstName: string,
    lastName: string,
  ): Promise<{
    sessionId: string;
    verificationUrl: string;
  }> {
    // [New] Check if user is allowed to retry
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true, kycAttempts: true },
    });
    if (
      user &&
      (user.kycStatus === ('MANUAL_REVIEW' as any) ||
        (user.kycAttempts || 0) >= 3)
    ) {
      throw new Error(
        'Maximum attempts reached. Your file is under manual review.',
      );
    }

    let token: string | null = null;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      this.logger.warn(
        `Didit OAuth failed: ${error.message}. Attemping X-Api-Key fallback.`,
      );
    }

    try {
      const url = `${this.verificationBaseUrl}/v1/session/`;
      this.logger.log(
        `Creating Didit session for user ${userId} using workflow_id: ${this.workflowId}`,
      );

      const headers: any = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        headers['X-Api-Key'] = this.clientSecret;
      }

      const callback = this.configService.get<string>('DIDIT_CALLBACK_URL', '');
      const body: any = {
        workflow_id: this.workflowId,
        vendor_data: userId.toString(),
        customer_metadata: {
          full_name: `${firstName} ${lastName}`,
        },
        metadata: {
          user_id: userId.toString(),
          first_name: firstName,
          last_name: lastName,
          full_name: `${firstName} ${lastName}`,
          expected_full_name: `${firstName} ${lastName}`, // Used by Didit for Full Name Matching
        },
      };

      if (callback) {
        body.callback = callback;
      }

      const sessionResponse = await axios.post(url, body, { headers });

      const sessionId =
        sessionResponse.data.session_id || sessionResponse.data.id;
      const verificationUrl =
        sessionResponse.data.verification_url || sessionResponse.data.url;

      this.logger.log(
        `Didit session created: id=${sessionId} for user ${userId}`,
      );

      // Update user to PENDING when session is created/started
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          diditSessionId: sessionId,
          kycStatus: 'PENDING',
        },
      });

      return {
        sessionId,
        verificationUrl,
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to create Didit session: ${JSON.stringify(axiosError.response?.data) || axiosError.message}`,
      );
      throw new Error('Failed to create verification session');
    }
  }

  /**
   * Retrieve session details from Didit
   */
  async getSessionDetails(sessionId: string): Promise<any> {
    const token = await this.getAccessToken();

    try {
      const response = await axios.get(
        `${this.verificationBaseUrl}/v2/session/${sessionId}/`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to get Didit session details: ${axiosError.message}`,
      );
      throw error;
    }
  }

  /**
   * Delete user records from Didit
   *
   * @param sessionId - The session ID to delete
   */
  async deleteUserRecords(sessionId: string): Promise<void> {
    const token = await this.getAccessToken();

    try {
      await axios.delete(
        `${this.verificationBaseUrl}/v2/session/${sessionId}/`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      this.logger.log(`Didit session ${sessionId} deleted successfully.`);
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        this.logger.warn(
          `Didit session ${sessionId} not found during deletion (already deleted?).`,
        );
      } else {
        this.logger.error(
          `Failed to delete Didit session ${sessionId}: ${axiosError.message}`,
        );
        // We don't throw here to allow the main anonymization flow to continue
        // But we log it as error.
        // User requirement: "Ajoute un service... qui gère l'appel DELETE"
      }
    }
  }

  /**
   * Verify webhook signature using HMAC-SHA256
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn(
        'Webhook secret not configured, skipping signature verification',
      );
      return true;
    }

    const payloadString =
      typeof payload === 'string' ? payload : payload.toString();
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payloadString)
      .digest('hex');

    const providedHash = signature.startsWith('sha256=')
      ? signature.substring(7)
      : signature;

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(providedHash),
    );
  }

  /**
   * Process webhook event from Didit
   */
  async handleWebhookEvent(body: DiditWebhookPayload): Promise<void> {
    const { session_id, status, vendor_data } = body;

    if (!session_id || !status) {
      this.logger.warn('Invalid Didit webhook payload', body);
      return;
    }

    const userId = vendor_data ? parseInt(vendor_data, 10) : null;

    if (!userId) {
      this.logger.warn(
        `Webhook received without valid vendor_data: ${session_id}`,
      );
      return;
    }

    this.logger.log(
      `Processing Didit webhook for user ${userId}: status=${status}`,
    );

    switch (status) {
      case 'Approved':
        await this.handleApproved(userId, session_id, body);
        break;

      case 'Declined':
      case 'Rejected':
        await this.handleDeclined(userId, session_id, body);
        break;

      case 'Need Review':
      case 'In Progress':
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            kycStatus: 'PENDING',
            diditSessionId: session_id,
          },
        });
        break;

      case 'Expired':
      case 'Abandoned':
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            kycStatus: 'CANCELED',
            diditSessionId: session_id,
          },
        });
        break;

      case 'Not Started':
        await this.prisma.user.update({
          where: { id: userId },
          data: { kycStatus: 'UNVERIFIED' },
        });
        break;

      default:
        this.logger.warn(`Unhandled Didit status: ${status}`);
    }
  }

  /**
   * Handle approved verification
   */
  private async handleApproved(
    userId: number,
    sessionId: string,
    webhookData: DiditWebhookPayload,
  ): Promise<void> {
    this.logger.log(`User ${userId} Approved by Didit. Updating database.`);

    // Double check age if DOB is provided (safety layer)
    const dob = webhookData.document?.date_of_birth;
    if (dob) {
      const age = this.calculateAge(dob);
      if (age < 18) {
        this.logger.warn(`User ${userId} rejected: Underage (${age})`);
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            kycStatus: 'REJECTED',
            isKycVerified: false,
            kycReason:
              'Vous devez avoir au moins 18 ans pour accéder à ce service.',
            diditSessionId: sessionId,
          },
        });
        return;
      }
    }

    // We trust Didit's Approval for Name Matching since we send expected_full_name during session creation.
    // This avoids issues with fuzzy matching mismatches as seen in logs.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: 'VERIFIED',
        isKycVerified: true,
        accountValidatedAt: new Date(),
        diditSessionId: sessionId,
        kycReason: null, // Clear any previous rejection reason
      },
    });

    this.logger.log(`User ${userId} successfully verified.`);
  }

  /**
   * Handle declined/rejected verification
   */
  private async handleDeclined(
    userId: number,
    sessionId: string,
    webhookData: any,
  ): Promise<void> {
    let kycReason = 'VERIFICATION_FAILED'; // Default fallback code

    // --- NEW LOGIC: Extract warnings from decision.id_verification.warnings ---
    // --- NEW LOGIC: Extract warnings from decision ---
    const decision = webhookData.decision || {};
    const idWarnings = decision.id_verification?.warnings || [];
    const livenessWarnings = decision.liveness?.warnings || [];
    const faceWarnings = decision.face_match?.warnings || [];

    // Combine all warnings
    const allWarnings = [...idWarnings, ...livenessWarnings, ...faceWarnings];

    // Debug Log
    console.log(
      `[DiditService] Processing handleDeclined for user ${userId}. All Warnings:`,
      JSON.stringify(allWarnings),
    );

    if (Array.isArray(allWarnings) && allWarnings.length > 0) {
      const reasons: string[] = [];

      allWarnings.forEach((w: any) => {
        // Ensure we use the RISK CODE, not the description
        let reasonCode = w.risk ? w.risk : 'UNKNOWN_RISK';

        // Add details for specific codes
        if (
          reasonCode === 'MINIMUM_AGE_NOT_MET' &&
          w.additional_data?.min_age_allowed
        ) {
          reasonCode += `:${w.additional_data.min_age_allowed}`;
        }

        reasons.push(reasonCode);
      });

      kycReason = reasons.join('|');
    } else {
      // Fallback to legacy extraction if no warnings structure found
      // If raw reason exists, use it but try to keep it code-like if possible
      const rawReason =
        webhookData.rejection_reason ||
        (webhookData.decline_reasons && webhookData.decline_reasons[0]);
      if (rawReason) {
        // If it looks like a sentence, just keep it, Frontend will display as is (default case)
        kycReason = rawReason;
      }
    }

    // Fetch current user attempts to safeguard concurrency (optional but good practice)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { kycAttempts: true },
    });
    const currentAttempts = (user?.kycAttempts || 0) + 1;

    let statusToSet = 'REJECTED';
    if (currentAttempts >= 3) {
      statusToSet = 'MANUAL_REVIEW';
      this.logger.warn(
        `User ${userId} reached ${currentAttempts} failed attempts. Switching to MANUAL_REVIEW.`,
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        kycStatus: statusToSet as any, // Cast because MANUAL_REVIEW might not be in generated types yet during dev
        isKycVerified: false,
        kycReason: kycReason,
        diditSessionId: sessionId,
        kycAttempts: currentAttempts,
        kycLastError: kycReason,
      },
    });

    this.logger.warn(
      `User ${userId} rejected by Didit (Attempt ${currentAttempts}). Reason: ${kycReason}`,
    );
  }

  /**
   * Calculate age from birth date string
   */
  private calculateAge(birthDate: string): number {
    const birth = new Date(birthDate);
    if (isNaN(birth.getTime())) return 0;

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  /**
   * Fuzzy name matching to handle minor differences
   * (accents, hyphens, middle names, etc.)
   */
  private fuzzyNameMatch(extracted: string, expected: string): boolean {
    if (!extracted || !expected) return false;

    // Normalize strings
    const normalize = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[-']/g, ' ') // Replace hyphens with spaces
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim()
        .toLowerCase();

    const normalizedExtracted = normalize(extracted);
    const normalizedExpected = normalize(expected);

    // Exact match after normalization
    if (normalizedExtracted === normalizedExpected) return true;

    // Check if one contains the other (for middle names, etc.)
    if (
      normalizedExtracted.includes(normalizedExpected) ||
      normalizedExpected.includes(normalizedExtracted)
    ) {
      return true;
    }

    // Levenshtein distance for typos (threshold: 2 chars difference)
    const distance = this.levenshteinDistance(
      normalizedExtracted,
      normalizedExpected,
    );
    return distance <= 2;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Check if Didit is properly configured
   */
  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.workflowId);
  }

  /**
   * Get user's current KYC status
   */
  async getUserKycStatus(userId: number) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        kycStatus: true,
        kycReason: true,
        isKycVerified: true,
        accountValidatedAt: true,
        diditSessionId: true,
      },
    });
  }
}

/**
 * Didit Webhook Payload Types
 */
export interface DiditWebhookPayload {
  session_id: string;
  status:
    | 'Approved'
    | 'Declined'
    | 'Rejected'
    | 'Need Review'
    | 'In Progress'
    | 'Expired'
    | 'Abandoned'
    | 'Not Started';
  vendor_data?: string;
  metadata?: Record<string, any>;
  workflow_id?: string;
  rejection_reason?: string; // New field as per user prompt
  document?: {
    first_name?: string;
    last_name?: string;
    date_of_birth?: string;
    document_type?: string;
    document_number?: string;
    expiry_date?: string;
    country?: string;
  };
  liveness?: {
    passed: boolean;
    score?: number;
  };
  face_match?: {
    passed: boolean;
    score?: number;
  };
  decline_reasons?: string[];
  created_at?: string;
  updated_at?: string;
}
