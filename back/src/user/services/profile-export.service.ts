import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ProfileExportService {
  private s3Client: S3Client;
  private bucketName: string;

  // Logo path for embedding in PDF
  private readonly logoPath = path.join(
    process.cwd(),
    '..',
    'frontend',
    'src',
    'assets',
    'images',
    'logo',
    'reloke-circle-logo.png',
  );

  // Brand colors - Reloke Theme
  private readonly colors = {
    primary: 'C25E46', // Terracotta
    primaryDark: 'A04530',
    primaryLight: 'E8B298',
    secondary: '6B665F', // Warm gray
    accent: 'D4A574', // Gold/Beige
    bgMain: 'F2F0E9', // Cream
    bgCard: 'FDFBF7', // Off-white
    bgDark: '2C2825', // Dark brown
    textMain: '1F2937',
    textLight: '6B7280',
    textMuted: '9CA3AF',
    white: 'FFFFFF',
    success: '059669',
    warning: 'D97706',
    error: 'DC2626',
    info: '2563EB',
    border: 'E5E7EB',
    borderLight: 'F3F4F6',
    tableHeader: 'C25E46',
    tableRowEven: 'FDFBF7',
    tableRowOdd: 'FFFFFF',
  };

  // French labels for enums
  private readonly homeTypeLabels: Record<string, string> = {
    CHAMBRE: 'Chambre',
    STUDIO: 'Studio',
    T1: 'T1',
    T1_BIS: 'T1 bis',
    T2: 'T2',
    T2_BIS: 'T2 bis',
    T3: 'T3',
    T3_BIS: 'T3 bis',
    T4: 'T4',
    T5: 'T5',
    T6_PLUS: 'T6+',
  };

  private readonly kycStatusLabels: Record<string, string> = {
    UNVERIFIED: 'Non vérifié',
    PENDING: 'En attente de vérification',
    VERIFIED: 'Vérifié',
    REJECTED: 'Rejeté',
    REQUIRES_INPUT: 'Information requise',
    CANCELED: 'Annulé',
  };

  private readonly matchStatusLabels: Record<string, string> = {
    NEW: 'Nouveau',
    IN_PROGRESS: 'En cours',
    NOT_INTERESTED: 'Pas intéressé',
    ARCHIVED: 'Archivé',
  };

  private readonly matchTypeLabels: Record<string, string> = {
    STANDARD: 'Échange direct',
    TRIANGLE: 'Échange triangulaire',
  };

  private readonly paymentStatusLabels: Record<string, string> = {
    PENDING: 'En attente',
    SUCCEEDED: 'Réussi',
    FAILED: 'Échoué',
    PARTIALLY_REFUNDED: 'Partiellement remboursé',
    REFUNDED: 'Remboursé',
  };

  private readonly reportStatusLabels: Record<string, string> = {
    PENDING: 'En attente',
    RESOLVED: 'Résolu',
    DISMISSED: 'Rejeté',
    ARCHIVED: 'Archivé',
  };

  private readonly helpTopicLabels: Record<string, string> = {
    HOME: 'Mon logement',
    SEARCH: 'Ma recherche',
    SEARCH_CRITERIA: 'Critères de recherche',
    MATCHES: 'Mes matchs',
    PAYMENTS: 'Paiements',
    OTHER: 'Autre',
  };

  private readonly helpStatusLabels: Record<string, string> = {
    OPEN: 'Ouvert',
    IN_PROGRESS: 'En cours',
    RESOLVED: 'Résolu',
  };

  private readonly notificationTypeLabels: Record<string, string> = {
    MESSAGE: 'Message',
    MATCH: 'Match',
    SYSTEM: 'Système',
  };

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const region = this.configService.get<string>('AWS_S3_REGION', 'eu-west-3');
    const accessKeyId = this.configService.get<string>(
      'AWS_S3_ACCESS_KEY_ID',
      '',
    );
    const secretAccessKey = this.configService.get<string>(
      'AWS_S3_SECRET_ACCESS_KEY',
      '',
    );

    this.s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.bucketName = this.configService.get<string>('AWS_S3_BUCKET', '');
  }

  async exportUserData(userId: number, res: Response, format: string = 'xlsx') {
    // Fetch ALL user data with comprehensive includes
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        metadata: true,
        home: {
          include: {
            images: { orderBy: { order: 'asc' } },
          },
        },
        searches: {
          include: {
            searchAdresses: true,
          },
        },
        identityProofs: true,
        intents: {
          include: {
            matchesAsSeeker: {
              include: {
                targetHome: {
                  include: {
                    user: {
                      select: { firstName: true, lastName: true, uid: true },
                    },
                    images: { orderBy: { order: 'asc' }, take: 1 },
                  },
                },
                targetIntent: {
                  include: {
                    user: {
                      select: { firstName: true, lastName: true, uid: true },
                    },
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
            matchesAsTarget: {
              include: {
                seekerIntent: {
                  include: {
                    user: {
                      select: { firstName: true, lastName: true, uid: true },
                    },
                    home: {
                      include: {
                        images: { orderBy: { order: 'asc' }, take: 1 },
                      },
                    },
                  },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
            payments: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        transactions: {
          orderBy: { occurredAt: 'desc' },
          take: 200,
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        chatParticipants: {
          include: {
            chat: {
              include: {
                messages: {
                  where: { isDeleted: false },
                  orderBy: { createdAt: 'asc' },
                  include: {
                    sender: {
                      select: { id: true, firstName: true, lastName: true },
                    },
                    images: true,
                  },
                },
                participants: {
                  include: {
                    user: {
                      select: { id: true, firstName: true, lastName: true },
                    },
                  },
                },
              },
            },
          },
        },
        notifications: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        connectionLogs: {
          orderBy: { loginDate: 'desc' },
          take: 50,
        },
        reportsMade: {
          include: {
            reportedUser: {
              select: { firstName: true, lastName: true, uid: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        reportsReceived: {
          include: {
            reporter: {
              select: { firstName: true, lastName: true, uid: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        helpRequests: {
          include: {
            attachments: { orderBy: { order: 'asc' } },
          },
          orderBy: { createdAt: 'desc' },
        },
        pushSubscriptions: true,
        usedPromoCode: true,
        dossierFacileLink: true,
        legalCases: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    // Generate presigned URLs for images (7 days validity)
    if (user.home?.images) {
      for (const img of user.home.images) {
        if (img.url) {
          img['presignedUrl'] = await this.getPresignedUrl(img.url);
        }
      }
    }

    // Identity proofs URLs
    for (const proof of user.identityProofs || []) {
      if (proof.url) {
        proof['presignedUrl'] = await this.getPresignedUrl(proof.url);
      }
    }

    // Help request attachments URLs
    for (const request of user.helpRequests || []) {
      for (const attachment of request.attachments || []) {
        if (attachment.url) {
          attachment['presignedUrl'] = await this.getPresignedUrl(
            attachment.url,
          );
        }
      }
    }

    switch (format.toLowerCase()) {
      case 'pdf':
        return this.exportToPdf(user, res);
      case 'xlsx':
      case 'xls':
      default:
        return this.exportToXlsx(user, res);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PDF EXPORT
  // ════════════════════════════════════════════════════════════════════════════

  private async exportToPdf(user: any, res: Response) {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      bufferPages: true,
      info: {
        Title: `Export de données - ${user.firstName} ${user.lastName}`,
        Author: 'Reloke SAS',
        Subject: 'Export de données personnelles RGPD',
        Creator: "Reloke - Plateforme d'échange de logements",
        Keywords: 'RGPD, export, données personnelles, Reloke',
      },
    });

    const date = new Date().toISOString().split('T')[0];
    const safeName = `${user.firstName}_${user.lastName}`.replace(
      /[^a-zA-Z0-9]/g,
      '_',
    );
    const filename = `reloke_export_${safeName}_${date}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);

    // Each section on a dedicated page
    await this.pdfCoverPage(doc, user);
    doc.addPage();
    await this.pdfProfilePage(doc, user);
    doc.addPage();
    await this.pdfHomePage(doc, user.home);
    doc.addPage();
    await this.pdfSearchPage(doc, user.searches);
    doc.addPage();
    await this.pdfMatchesPage(doc, user.intents);
    doc.addPage();
    await this.pdfMessagesPage(doc, user.chatParticipants, user.id);
    doc.addPage();
    await this.pdfTransactionsPage(doc, user.transactions, user.payments);

    // Add page numbers
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);

      // Footer line
      doc
        .strokeColor('#E5E7EB')
        .lineWidth(0.5)
        .moveTo(50, doc.page.height - 55)
        .lineTo(doc.page.width - 50, doc.page.height - 55)
        .stroke();

      // Page number
      doc
        .fontSize(9)
        .fillColor('#9CA3AF')
        .text(`Page ${i + 1} / ${pages.count}`, 50, doc.page.height - 45, {
          align: 'center',
          width: doc.page.width - 100,
        });

      // Footer branding
      doc
        .fontSize(8)
        .fillColor('#C25E46')
        .text('RELOKE', 50, doc.page.height - 32, {
          align: 'center',
          width: doc.page.width - 100,
          continued: true,
        })
        .fillColor('#9CA3AF')
        .text(' • Export RGPD • Données personnelles');
    }

    doc.end();
  }

  // ═══════════════════════════════════════════════════════════════════
  // PDF: LISEZ-MOI (Cover Page)
  // ═══════════════════════════════════════════════════════════════════
  private async pdfCoverPage(doc: any, user: any) {
    const pageWidth = doc.page.width;
    const centerX = pageWidth / 2;
    const margin = 50;
    const contentWidth = pageWidth - 2 * margin;

    // Try to add logo
    try {
      if (fs.existsSync(this.logoPath)) {
        doc.image(this.logoPath, centerX - 45, 50, { width: 90 });
      }
    } catch (e) {}

    // Brand name
    doc
      .fontSize(42)
      .fillColor('#C25E46')
      .text('RELOKE', 0, 155, { align: 'center', width: pageWidth });
    doc
      .fontSize(13)
      .fillColor('#6B665F')
      .text("Plateforme d'échange de logements", 0, 205, {
        align: 'center',
        width: pageWidth,
      });

    // Decorative line
    doc
      .strokeColor('#C25E46')
      .lineWidth(3)
      .moveTo(centerX - 80, 235)
      .lineTo(centerX + 80, 235)
      .stroke();

    // Main title box
    doc.roundedRect(margin, 260, contentWidth, 55, 6).fill('#C25E46');
    doc
      .fontSize(22)
      .fillColor('#FFFFFF')
      .text('EXPORTATION DE DONNÉES PERSONNELLES', margin, 278, {
        align: 'center',
        width: contentWidth,
      });

    // RGPD subtitle
    doc
      .fontSize(11)
      .fillColor('#6B665F')
      .text(
        'Conformément au Règlement Général sur la Protection des Données (RGPD),',
        margin,
        330,
        { align: 'center', width: contentWidth },
      )
      .text(
        "vous disposez d'un droit à la portabilité de vos données personnelles.",
        margin,
        345,
        { align: 'center', width: contentWidth },
      );

    // Warning box
    doc
      .roundedRect(margin, 380, contentWidth, 95, 6)
      .fillAndStroke('#FEF3C7', '#F59E0B');
    doc
      .fontSize(12)
      .fillColor('#92400E')
      .text('⚠️  VALIDITÉ DES LIENS MULTIMÉDIA', margin + 15, 395, {
        width: contentWidth - 30,
      });
    doc
      .fontSize(10)
      .fillColor('#78350F')
      .text(
        'Pour des raisons de sécurité, les liens vers vos photos et documents inclus dans ce fichier ont une durée de validité limitée à 7 jours (604 800 secondes).',
        margin + 15,
        415,
        { width: contentWidth - 30 },
      )
      .text(
        'Passé ce délai, vous devrez générer un nouvel export pour accéder à vos fichiers multimédias.',
        margin + 15,
        450,
        { width: contentWidth - 30 },
      );

    // User info card
    const cardY = 495;
    doc
      .roundedRect(margin, cardY, contentWidth, 115, 6)
      .fillAndStroke('#FDFBF7', '#E5E7EB');
    doc
      .fontSize(16)
      .fillColor('#1F2937')
      .text(`${user.firstName} ${user.lastName}`, margin, cardY + 20, {
        align: 'center',
        width: contentWidth,
      });
    doc
      .fontSize(11)
      .fillColor('#6B7280')
      .text(user.mail, margin, cardY + 45, {
        align: 'center',
        width: contentWidth,
      });
    doc
      .fontSize(10)
      .fillColor('#9CA3AF')
      .text(`Identifiant unique : ${user.uid}`, margin, cardY + 70, {
        align: 'center',
        width: contentWidth,
      })
      .text(
        `Membre depuis le ${this.formatDate(user.createdAt)}`,
        margin,
        cardY + 87,
        { align: 'center', width: contentWidth },
      );

    // Generation timestamp
    doc
      .fontSize(12)
      .fillColor('#1F2937')
      .text(
        `Date de génération : ${this.formatDateTime(new Date())}`,
        margin,
        635,
        { align: 'center', width: contentWidth },
      );

    // Contents
    doc
      .fontSize(10)
      .fillColor('#6B7280')
      .text(
        "Ce document contient l'intégralité de vos données personnelles stockées sur Reloke :",
        margin,
        670,
        { align: 'center', width: contentWidth },
      );
    doc
      .fontSize(9)
      .fillColor('#C25E46')
      .text(
        'Profil • Logement • Recherche • Matchs • Messages • Transactions',
        margin,
        690,
        { align: 'center', width: contentWidth },
      );
  }

  // ═══════════════════════════════════════════════════════════════════
  // PDF: MON PROFIL
  // ═══════════════════════════════════════════════════════════════════
  private async pdfProfilePage(doc: any, user: any) {
    this.pdfPageTitle(doc, 'MON PROFIL', 'Informations personnelles et compte');

    this.pdfSectionHeader(doc, 'IDENTITÉ');
    this.pdfKeyValue(doc, 'Prénom', user.firstName);
    this.pdfKeyValue(doc, 'Nom', user.lastName);
    this.pdfKeyValue(doc, 'Email', user.mail);
    this.pdfKeyValue(doc, 'Téléphone', user.phone || 'Non renseigné');
    this.pdfKeyValue(doc, 'UID', user.uid);
    this.pdfKeyValue(
      doc,
      'Rôle',
      user.role === 'USER' ? 'Utilisateur' : 'Administrateur',
    );
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'STATUT DU COMPTE');
    this.pdfKeyValue(doc, 'Compte actif', user.isActif ? '✓ Oui' : '✗ Non');
    this.pdfKeyValue(
      doc,
      'Compte verrouillé',
      user.isLocked ? '✓ Oui' : '✗ Non',
    );
    this.pdfKeyValue(
      doc,
      'Email vérifié',
      user.isEmailVerified ? '✓ Oui' : '✗ Non',
    );
    this.pdfKeyValue(
      doc,
      'Banni',
      user.isBanned ? `✓ Oui (${user.banReason || 'N/A'})` : '✗ Non',
    );
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, "VÉRIFICATION D'IDENTITÉ (KYC)");
    this.pdfKeyValue(
      doc,
      'Statut',
      this.kycStatusLabels[user.kycStatus] || user.kycStatus,
    );
    this.pdfKeyValue(
      doc,
      'Identité vérifiée',
      user.isKycVerified ? '✓ Oui' : '✗ Non',
    );
    this.pdfKeyValue(
      doc,
      'Date de validation',
      user.accountValidatedAt
        ? this.formatDate(user.accountValidatedAt)
        : 'N/A',
    );
    if (user.kycReason) this.pdfKeyValue(doc, 'Motif refus', user.kycReason);
    this.pdfKeyValue(doc, 'Session Didit', user.diditSessionId || 'N/A');
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'DOSSIER LOCATAIRE');
    this.pdfKeyValue(
      doc,
      'URL DossierFacile',
      user.dossierFacileUrl || 'Non renseigné',
    );
    this.pdfKeyValue(
      doc,
      'Dossier valide',
      user.isDossierValid ? '✓ Oui' : '✗ Non',
    );
    if (user.dossierFacileLink) {
      this.pdfKeyValue(
        doc,
        'Statut DossierFacile',
        user.dossierFacileLink.status,
      );
    }
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'CONSENTEMENT CGU');
    this.pdfKeyValue(
      doc,
      'CGU acceptées',
      user.cguAccepted ? '✓ Oui' : '✗ Non',
    );
    this.pdfKeyValue(
      doc,
      "Date d'acceptation",
      user.cguAcceptedAt ? this.formatDateTime(user.cguAcceptedAt) : 'N/A',
    );
    this.pdfKeyValue(doc, 'Version CGU', user.cguVersion || 'N/A');
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'DATES IMPORTANTES');
    this.pdfKeyValue(doc, 'Inscription', this.formatDateTime(user.createdAt));
    this.pdfKeyValue(
      doc,
      'Dernière connexion',
      this.formatDateTime(user.dateLastConnection),
    );
    this.pdfKeyValue(
      doc,
      'Dernière activité',
      this.formatDateTime(user.lastActivityAt),
    );
    doc.moveDown(0.5);

    if (user.deletionScheduledAt) {
      this.pdfSectionHeader(doc, '⚠️ SUPPRESSION PROGRAMMÉE');
      this.pdfKeyValue(
        doc,
        'Demandée le',
        user.deletionRequestedAt
          ? this.formatDateTime(user.deletionRequestedAt)
          : 'N/A',
      );
      this.pdfKeyValue(
        doc,
        'Date prévue',
        this.formatDateTime(user.deletionScheduledAt),
      );
      doc.moveDown(0.5);
    }

    if (user.usedPromoCode) {
      this.pdfSectionHeader(doc, 'CODE PROMO UTILISÉ');
      this.pdfKeyValue(doc, 'Code', user.usedPromoCode.code);
      this.pdfKeyValue(
        doc,
        'Réduction',
        `${user.usedPromoCode.discountPercentage}%`,
      );
      doc.moveDown(0.5);
    }

    if (user.metadata) {
      this.pdfSectionHeader(doc, 'MÉTADONNÉES (SNAPSHOT JSON)');
      this.pdfJsonBlock(doc, user.metadata);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PDF: MON LOGEMENT
  // ═══════════════════════════════════════════════════════════════════
  private async pdfHomePage(doc: any, home: any) {
    this.pdfPageTitle(
      doc,
      'MON LOGEMENT',
      "Logement sortant proposé à l'échange",
    );

    if (!home) {
      this.pdfEmptyState(doc, 'Aucun logement enregistré');
      return;
    }

    this.pdfSectionHeader(doc, 'LOCALISATION');
    this.pdfKeyValue(doc, 'Adresse complète', home.addressFormatted);
    this.pdfKeyValue(doc, 'Place ID Google', home.addressPlaceId || 'N/A');
    this.pdfKeyValue(
      doc,
      'Coordonnées GPS',
      `${home.lat?.toFixed(6) || 'N/A'}, ${home.lng?.toFixed(6) || 'N/A'}`,
    );
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'CARACTÉRISTIQUES');
    this.pdfKeyValue(
      doc,
      'Type de logement',
      this.homeTypeLabels[home.homeType] || home.homeType,
    );
    this.pdfKeyValue(doc, 'Nombre de pièces', `${home.nbRooms} pièce(s)`);
    this.pdfKeyValue(doc, 'Surface', `${home.surface} m²`);
    this.pdfKeyValue(doc, 'Loyer mensuel', `${home.rent} € / mois`);
    doc.moveDown(0.5);

    if (home.description) {
      this.pdfSectionHeader(doc, 'DESCRIPTION');
      doc
        .fontSize(10)
        .fillColor('#4B5563')
        .text(home.description, { width: doc.page.width - 100 });
      doc.moveDown(0.5);
    }

    this.pdfSectionHeader(doc, 'PHOTOS');
    if (home.images?.length > 0) {
      this.pdfKeyValue(
        doc,
        'Nombre de photos',
        `${home.images.length} photo(s)`,
      );
      home.images.forEach((img, index) => {
        const url = img.presignedUrl || img.url || 'N/A';
        doc
          .fontSize(9)
          .fillColor('#2563EB')
          .text(`Photo ${index + 1} : `, { continued: true })
          .text(url.substring(0, 80) + (url.length > 80 ? '...' : ''), {
            link: url,
            underline: true,
          });
      });
    } else {
      doc.fontSize(10).fillColor('#9CA3AF').text('Aucune photo téléchargée');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PDF: MA RECHERCHE
  // ═══════════════════════════════════════════════════════════════════
  private async pdfSearchPage(doc: any, searches: any[]) {
    this.pdfPageTitle(doc, 'MA RECHERCHE', 'Critères de recherche de logement');

    if (!searches || searches.length === 0) {
      this.pdfEmptyState(doc, 'Aucune recherche enregistrée');
      return;
    }

    const search = searches[0];

    this.pdfSectionHeader(doc, 'BUDGET');
    this.pdfKeyValue(
      doc,
      'Loyer minimum',
      search.minRent ? `${search.minRent} €` : 'Non défini',
    );
    this.pdfKeyValue(
      doc,
      'Loyer maximum',
      search.maxRent ? `${search.maxRent} €` : 'Non défini',
    );
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'SURFACE');
    this.pdfKeyValue(
      doc,
      'Surface minimum',
      search.minRoomSurface ? `${search.minRoomSurface} m²` : 'Non défini',
    );
    this.pdfKeyValue(
      doc,
      'Surface maximum',
      search.maxRoomSurface ? `${search.maxRoomSurface} m²` : 'Non défini',
    );
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'NOMBRE DE PIÈCES');
    this.pdfKeyValue(
      doc,
      'Minimum',
      search.minRoomNb?.toString() || 'Non défini',
    );
    this.pdfKeyValue(
      doc,
      'Maximum',
      search.maxRoomNb?.toString() || 'Non défini',
    );
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'TYPES DE LOGEMENT ACCEPTÉS');
    let homeTypes = 'Tous types';
    try {
      const types = search.homeType
        ? Array.isArray(search.homeType)
          ? search.homeType
          : JSON.parse(search.homeType)
        : [];
      if (types.length > 0)
        homeTypes = types.map((t) => this.homeTypeLabels[t] || t).join(', ');
    } catch (e) {
      homeTypes = String(search.homeType) || 'Tous types';
    }
    this.pdfKeyValue(doc, 'Types', homeTypes);
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'DISPONIBILITÉ');
    this.pdfKeyValue(
      doc,
      'Disponible à partir du',
      search.searchStartDate
        ? this.formatDate(search.searchStartDate)
        : 'Non défini',
    );
    this.pdfKeyValue(
      doc,
      "Recherche active jusqu'au",
      search.searchEndDate
        ? this.formatDate(search.searchEndDate)
        : 'Non défini',
    );
    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'ZONES DE RECHERCHE');
    if (search.searchAdresses?.length > 0) {
      search.searchAdresses.forEach((zone, index) => {
        const zoneLabel = zone.label || 'Zone sans nom';
        const radius = zone.radius ? ` (rayon : ${zone.radius} km)` : '';
        this.pdfKeyValue(doc, `Zone ${index + 1}`, `${zoneLabel}${radius}`);
      });
    } else {
      doc
        .fontSize(10)
        .fillColor('#9CA3AF')
        .text('Aucune zone de recherche définie');
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PDF: MES MATCHS
  // ═══════════════════════════════════════════════════════════════════
  private async pdfMatchesPage(doc: any, intents: any[]) {
    this.pdfPageTitle(doc, 'MES MATCHS', 'Historique des correspondances');

    const intent = intents?.[0];

    if (intent) {
      this.pdfSectionHeader(doc, 'RÉSUMÉ DES CRÉDITS');
      this.pdfKeyValue(
        doc,
        'Crédits achetés (total)',
        intent.totalMatchesPurchased || 0,
      );
      this.pdfKeyValue(doc, 'Crédits utilisés', intent.totalMatchesUsed || 0);
      this.pdfKeyValue(
        doc,
        'Crédits restants',
        intent.totalMatchesRemaining || 0,
      );
      this.pdfKeyValue(
        doc,
        'En cours de recherche',
        intent.isInFlow ? '✓ Oui' : '✗ Non',
      );
      this.pdfKeyValue(
        doc,
        'Recherche active',
        intent.isActivelySearching ? '✓ Oui' : '✗ Non',
      );
      doc.moveDown(0.5);
    }

    const allMatches: any[] = [];
    for (const i of intents || []) {
      for (const m of i.matchesAsSeeker || []) {
        allMatches.push({
          date: m.createdAt,
          uid: m.uid,
          type: m.type,
          direction: 'Sortant',
          target: m.targetHome?.addressFormatted || 'N/A',
          targetUser: m.targetHome?.user
            ? `${m.targetHome.user.firstName} ${m.targetHome.user.lastName}`
            : 'N/A',
          status: m.status,
          groupId: m.groupId,
          snapshot: m.snapshot,
        });
      }
      for (const m of i.matchesAsTarget || []) {
        allMatches.push({
          date: m.createdAt,
          uid: m.uid,
          type: m.type,
          direction: 'Entrant',
          target: m.seekerIntent?.home?.addressFormatted || 'N/A',
          targetUser: m.seekerIntent?.user
            ? `${m.seekerIntent.user.firstName} ${m.seekerIntent.user.lastName}`
            : 'N/A',
          status: m.status,
          groupId: m.groupId,
          snapshot: m.snapshot,
        });
      }
    }

    this.pdfSectionHeader(doc, `LISTE DES MATCHS (${allMatches.length})`);

    if (allMatches.length === 0) {
      doc.fontSize(10).fillColor('#9CA3AF').text('Aucun match enregistré');
      return;
    }

    allMatches.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    allMatches.slice(0, 15).forEach((match, index) => {
      this.pdfPageBreakCheck(doc, 80);

      doc
        .fontSize(10)
        .fillColor('#C25E46')
        .text(`Match #${index + 1}`, { continued: true });
      doc.fillColor('#9CA3AF').text(` — ${this.formatDateTime(match.date)}`);

      this.pdfKeyValue(
        doc,
        'Type',
        this.matchTypeLabels[match.type] || match.type,
      );
      this.pdfKeyValue(doc, 'Direction', match.direction);
      this.pdfKeyValue(doc, 'Logement cible', match.target);
      this.pdfKeyValue(doc, 'Utilisateur cible', match.targetUser);
      this.pdfKeyValue(
        doc,
        'Statut',
        this.matchStatusLabels[match.status] || match.status,
      );
      if (match.groupId)
        this.pdfKeyValue(doc, 'Groupe triangulaire', match.groupId);

      if (match.snapshot) {
        doc.moveDown(0.2);
        doc.fontSize(8).fillColor('#6B7280').text('Snapshot JSON :');
        this.pdfJsonBlock(doc, match.snapshot, true);
      }

      doc.moveDown(0.5);
    });

    if (allMatches.length > 15) {
      doc
        .fontSize(9)
        .fillColor('#9CA3AF')
        .text(
          `... et ${allMatches.length - 15} autres matchs (voir export Excel)`,
        );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PDF: MESSAGES
  // ═══════════════════════════════════════════════════════════════════
  private async pdfMessagesPage(
    doc: any,
    chatParticipants: any[],
    userId: number,
  ) {
    this.pdfPageTitle(doc, 'MESSAGES', 'Historique des conversations');

    const conversations =
      chatParticipants?.filter((p) => p.chat?.messages?.length > 0) || [];
    const totalMessages = conversations.reduce(
      (sum, p) => sum + (p.chat?.messages?.length || 0),
      0,
    );

    this.pdfSectionHeader(doc, 'RÉSUMÉ');
    this.pdfKeyValue(doc, 'Nombre de conversations', `${conversations.length}`);
    this.pdfKeyValue(doc, 'Nombre total de messages', `${totalMessages}`);
    doc.moveDown(0.5);

    if (conversations.length === 0) {
      doc.fontSize(10).fillColor('#9CA3AF').text('Aucune conversation');
      return;
    }

    let convIndex = 1;
    for (const participant of conversations.slice(0, 5)) {
      this.pdfPageBreakCheck(doc, 150);

      const chat = participant.chat;
      const otherParticipants = chat.participants
        .filter((p) => p.userId !== userId)
        .map((p) => `${p.user.firstName} ${p.user.lastName}`)
        .join(', ');

      this.pdfSectionHeader(
        doc,
        `CONVERSATION ${convIndex} — ${otherParticipants || 'Inconnu'}`,
      );

      doc
        .fontSize(9)
        .fillColor('#6B7280')
        .text(
          `Type : ${this.matchTypeLabels[chat.type] || chat.type} • ${chat.messages.length} message(s)`,
        );
      doc.moveDown(0.3);

      const recentMessages = chat.messages.slice(-5);
      recentMessages.forEach((msg) => {
        const isMe = msg.senderId === userId;
        const senderName = isMe ? 'Moi' : msg.sender?.firstName || 'Inconnu';

        doc
          .fontSize(8)
          .fillColor('#9CA3AF')
          .text(`[${this.formatDateTime(msg.createdAt)}] `, {
            continued: true,
          });
        doc
          .fillColor(isMe ? '#C25E46' : '#1F2937')
          .text(`${senderName}: `, { continued: true });
        doc
          .fillColor('#4B5563')
          .text((msg.content || '[Média]').substring(0, 120));
      });

      if (chat.messages.length > 5) {
        doc
          .fontSize(8)
          .fillColor('#9CA3AF')
          .text(`... et ${chat.messages.length - 5} autres messages`);
      }

      doc.moveDown(0.5);
      convIndex++;
    }

    if (conversations.length > 5) {
      doc
        .fontSize(9)
        .fillColor('#9CA3AF')
        .text(
          `... et ${conversations.length - 5} autres conversations (voir export Excel)`,
        );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PDF: TRANSACTIONS
  // ═══════════════════════════════════════════════════════════════════
  private async pdfTransactionsPage(
    doc: any,
    transactions: any[],
    payments: any[],
  ) {
    this.pdfPageTitle(doc, 'TRANSACTIONS', 'Paiements et historique financier');

    this.pdfSectionHeader(doc, 'PAIEMENTS');

    if (!payments || payments.length === 0) {
      doc.fontSize(10).fillColor('#9CA3AF').text('Aucun paiement enregistré');
    } else {
      let totalSpent = 0;
      payments
        .filter((p) => p.status === 'SUCCEEDED')
        .forEach((p) => (totalSpent += p.amountTotal || 0));

      this.pdfKeyValue(doc, 'Nombre de paiements', `${payments.length}`);
      this.pdfKeyValue(doc, 'Total dépensé', `${totalSpent.toFixed(2)} €`);
      doc.moveDown(0.3);

      payments.slice(0, 10).forEach((payment, index) => {
        this.pdfPageBreakCheck(doc, 50);

        const statusIcon =
          payment.status === 'SUCCEEDED'
            ? '✓'
            : payment.status === 'FAILED'
              ? '✗'
              : '○';

        doc
          .fontSize(9)
          .fillColor('#C25E46')
          .text(`Paiement #${index + 1}`, { continued: true });
        doc
          .fillColor('#9CA3AF')
          .text(` — ${this.formatDate(payment.createdAt)}`);

        this.pdfKeyValue(doc, 'Pack', payment.planType);
        this.pdfKeyValue(doc, 'Crédits', `${payment.matchesInitial} match(s)`);
        this.pdfKeyValue(
          doc,
          'Montant total',
          `${payment.amountTotal?.toFixed(2)} €`,
        );
        this.pdfKeyValue(
          doc,
          'Statut',
          `${statusIcon} ${this.paymentStatusLabels[payment.status] || payment.status}`,
        );
        doc.moveDown(0.3);
      });
    }

    doc.moveDown(0.5);

    this.pdfSectionHeader(doc, 'JOURNAL DES TRANSACTIONS');

    if (!transactions || transactions.length === 0) {
      doc
        .fontSize(10)
        .fillColor('#9CA3AF')
        .text('Aucune transaction enregistrée');
      return;
    }

    this.pdfKeyValue(doc, 'Nombre de transactions', `${transactions.length}`);
    doc.moveDown(0.3);

    transactions.slice(0, 15).forEach((tx) => {
      this.pdfPageBreakCheck(doc, 25);
      doc
        .fontSize(8)
        .fillColor('#6B7280')
        .text(
          `${this.formatDateTime(tx.occurredAt)} • ${tx.type} • ${tx.status} • ${tx.amountTotal ? tx.amountTotal.toFixed(2) + ' €' : 'N/A'}`,
        );
    });

    if (transactions.length > 15) {
      doc
        .fontSize(8)
        .fillColor('#9CA3AF')
        .text(`... et ${transactions.length - 15} autres transactions`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PDF HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════
  private pdfPageTitle(doc: any, title: string, subtitle: string) {
    doc.fontSize(26).fillColor('#C25E46').text(title, 50, 50);
    doc
      .strokeColor('#C25E46')
      .lineWidth(3)
      .moveTo(50, 85)
      .lineTo(130, 85)
      .stroke();
    doc.fontSize(11).fillColor('#6B7280').text(subtitle, 50, 95);
    doc.y = 125;
  }

  private pdfSectionHeader(doc: any, title: string) {
    doc.moveDown(0.3);
    doc
      .strokeColor('#C25E46')
      .lineWidth(2)
      .moveTo(50, doc.y)
      .lineTo(65, doc.y)
      .stroke();
    doc.moveDown(0.15);
    doc.fontSize(12).fillColor('#C25E46').text(title);
    doc.moveDown(0.25);
  }

  private pdfKeyValue(doc: any, label: string, value: any) {
    doc
      .fontSize(10)
      .fillColor('#6B7280')
      .text(`${label} : `, { continued: true });
    doc.fillColor('#1F2937').text(String(value ?? 'N/A'));
  }

  private pdfEmptyState(doc: any, message: string) {
    doc.fontSize(14).fillColor('#9CA3AF').text(message, { align: 'center' });
  }

  private pdfJsonBlock(doc: any, data: any, compact: boolean = false) {
    const jsonStr = JSON.stringify(data, null, compact ? 0 : 2).substring(
      0,
      compact ? 500 : 2000,
    );
    doc
      .roundedRect(
        50,
        doc.y,
        doc.page.width - 100,
        Math.min(jsonStr.split('\n').length * 10, compact ? 60 : 150),
        4,
      )
      .fill('#F3F4F6');
    doc
      .fontSize(7)
      .fillColor('#374151')
      .text(jsonStr, 55, doc.y + 5, { width: doc.page.width - 110 });
    doc.y += Math.min(jsonStr.split('\n').length * 10, compact ? 60 : 150) + 10;
  }

  private pdfPageBreakCheck(doc: any, neededSpace: number) {
    if (doc.y + neededSpace > doc.page.height - 70) {
      doc.addPage();
      doc.y = 50;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // EXCEL EXPORT
  // ════════════════════════════════════════════════════════════════════════════════

  private async exportToXlsx(user: any, res: Response) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Reloke';
    workbook.created = new Date();
    workbook.company = 'Reloke SAS';
    workbook.subject = 'Export de données personnelles RGPD';

    await this.xlsxCoverSheet(workbook, user);
    await this.xlsxProfileSheet(workbook, user);
    await this.xlsxHomeSheet(workbook, user.home);
    await this.xlsxSearchSheet(workbook, user.searches);
    await this.xlsxMatchesSheet(workbook, user.intents, user.id);
    await this.xlsxMessagesSheet(workbook, user.chatParticipants, user.id);
    await this.xlsxTransactionsSheet(
      workbook,
      user.transactions,
      user.payments,
    );
    await this.xlsxActivitySheet(workbook, user);

    const date = new Date().toISOString().split('T')[0];
    const safeName = `${user.firstName}_${user.lastName}`.replace(
      /[^a-zA-Z0-9]/g,
      '_',
    );
    const filename = `reloke_export_${safeName}_${date}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXCEL: LISEZ-MOI (Cover)
  // ═══════════════════════════════════════════════════════════════════
  private async xlsxCoverSheet(workbook: ExcelJS.Workbook, user: any) {
    const sheet = workbook.addWorksheet('📖 Lisez-moi', {
      properties: { tabColor: { argb: this.colors.primary } },
    });
    sheet.getColumn(1).width = 3;
    sheet.getColumn(2).width = 40;
    sheet.getColumn(3).width = 55;
    sheet.getColumn(4).width = 3;

    let row = 2;
    row = this.xlsxTitle(
      sheet,
      row,
      '🏠 RELOKE',
      "Plateforme d'échange de logements",
    );

    sheet.mergeCells(`B${row}:C${row + 1}`);
    const mainCell = sheet.getCell(`B${row}`);
    mainCell.value = 'EXPORTATION DE DONNÉES PERSONNELLES';
    mainCell.font = {
      bold: true,
      size: 18,
      color: { argb: this.colors.white },
    };
    mainCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: this.colors.primary },
    };
    mainCell.alignment = { horizontal: 'center', vertical: 'middle' };
    mainCell.border = this.xlsxBorderStyle(this.colors.primaryDark);
    sheet.getRow(row).height = 22;
    sheet.getRow(row + 1).height = 22;
    row += 3;

    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).value =
      "Conformément au RGPD, vous disposez d'un droit à la portabilité de vos données.";
    sheet.getCell(`B${row}`).font = {
      size: 10,
      color: { argb: this.colors.textLight },
      italic: true,
    };
    sheet.getCell(`B${row}`).alignment = { horizontal: 'center' };
    row += 2;

    row = this.xlsxWarningBox(sheet, row, '⚠️ VALIDITÉ DES LIENS MULTIMÉDIA', [
      'Pour des raisons de sécurité, les liens vers vos photos et documents (S3)',
      'ont une durée de validité limitée de 7 jours (604 800 secondes).',
      '',
      'Passé ce délai, vous devrez générer un nouvel export.',
    ]);

    row = this.xlsxSectionTitle(sheet, row, '📋 INFORMATIONS DU DOCUMENT');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Date de génération', this.formatDateTime(new Date())],
      ['Titulaire du compte', `${user.firstName} ${user.lastName}`],
      ['Email', user.mail],
      ['Identifiant unique', user.uid],
      ["Date d'inscription", this.formatDate(user.createdAt)],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📚 CONTENU DU FICHIER');
    const intent = user.intents?.[0];
    const totalMatches =
      (intent?.matchesAsSeeker?.length || 0) +
      (intent?.matchesAsTarget?.length || 0);
    const totalMessages =
      user.chatParticipants?.reduce(
        (s, p) => s + (p.chat?.messages?.length || 0),
        0,
      ) || 0;

    row = this.xlsxKeyValueBlock(sheet, row, [
      ['📖 Lisez-moi', 'Cette page'],
      ['👤 Mon Profil', 'Informations personnelles'],
      ['🏠 Mon Logement', user.home ? 'Détails logement' : '(Vide)'],
      [
        '🔍 Ma Recherche',
        user.searches?.length ? 'Critères recherche' : '(Vide)',
      ],
      ['💫 Mes Matchs', `${totalMatches} match(s)`],
      ['💬 Messages', `${totalMessages} message(s)`],
      ['💳 Transactions', `${user.payments?.length || 0} paiement(s)`],
      ['📊 Activité', 'Connexions, notifications, signalements'],
    ]);
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXCEL: PROFIL
  // ═══════════════════════════════════════════════════════════════════
  private async xlsxProfileSheet(workbook: ExcelJS.Workbook, user: any) {
    const sheet = workbook.addWorksheet('👤 Mon Profil', {
      properties: { tabColor: { argb: this.colors.info } },
    });
    sheet.getColumn(1).width = 3;
    sheet.getColumn(2).width = 35;
    sheet.getColumn(3).width = 55;
    sheet.getColumn(4).width = 3;

    let row = 2;
    row = this.xlsxPageHeader(sheet, row, 'MON PROFIL', '👤');

    row = this.xlsxSectionTitle(sheet, row, '🪪 IDENTITÉ');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Prénom', user.firstName],
      ['Nom', user.lastName],
      ['Email', user.mail],
      ['Téléphone', user.phone || 'Non renseigné'],
      ['UID', user.uid],
      ['Rôle', user.role === 'USER' ? 'Utilisateur' : 'Administrateur'],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📊 STATUT DU COMPTE');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Compte actif', user.isActif ? '✅ Oui' : '❌ Non'],
      ['Compte verrouillé', user.isLocked ? '🔒 Oui' : '🔓 Non'],
      ['Email vérifié', user.isEmailVerified ? '✅ Oui' : '❌ Non'],
      [
        'Banni',
        user.isBanned ? `🚫 Oui (${user.banReason || 'N/A'})` : '✅ Non',
      ],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, "🛡️ VÉRIFICATION D'IDENTITÉ (KYC)");
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Statut KYC', this.kycStatusLabels[user.kycStatus] || user.kycStatus],
      ['Identité vérifiée', user.isKycVerified ? '✅ Oui' : '❌ Non'],
      [
        'Date validation',
        user.accountValidatedAt
          ? this.formatDate(user.accountValidatedAt)
          : 'N/A',
      ],
      ['Motif refus', user.kycReason || 'N/A'],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📁 DOSSIER LOCATAIRE');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['URL DossierFacile', user.dossierFacileUrl || 'Non renseigné'],
      ['Dossier valide', user.isDossierValid ? '✅ Oui' : '❌ Non'],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📜 CGU / CONSENTEMENT');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['CGU acceptées', user.cguAccepted ? '✅ Oui' : '❌ Non'],
      [
        'Date acceptation',
        user.cguAcceptedAt ? this.formatDateTime(user.cguAcceptedAt) : 'N/A',
      ],
      ['Version CGU', user.cguVersion || 'N/A'],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📅 DATES IMPORTANTES');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Inscription', this.formatDateTime(user.createdAt)],
      ['Dernière connexion', this.formatDateTime(user.dateLastConnection)],
      ['Dernière activité', this.formatDateTime(user.lastActivityAt)],
    ]);
    row++;

    if (user.deletionScheduledAt) {
      row = this.xlsxSectionTitle(sheet, row, '⚠️ SUPPRESSION PROGRAMMÉE');
      row = this.xlsxKeyValueBlock(sheet, row, [
        [
          'Demandée le',
          user.deletionRequestedAt
            ? this.formatDateTime(user.deletionRequestedAt)
            : 'N/A',
        ],
        ['Date prévue', this.formatDateTime(user.deletionScheduledAt)],
      ]);
      row++;
    }

    if (user.usedPromoCode) {
      row = this.xlsxSectionTitle(sheet, row, '🎟️ CODE PROMO');
      row = this.xlsxKeyValueBlock(sheet, row, [
        ['Code', user.usedPromoCode.code],
        ['Réduction', `${user.usedPromoCode.discountPercentage}%`],
      ]);
      row++;
    }

    if (user.metadata) {
      row = this.xlsxSectionTitle(sheet, row, '📦 MÉTADONNÉES (SNAPSHOT JSON)');
      row = this.xlsxJsonBlock(sheet, row, user.metadata);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXCEL: LOGEMENT
  // ═══════════════════════════════════════════════════════════════════
  private async xlsxHomeSheet(workbook: ExcelJS.Workbook, home: any) {
    const sheet = workbook.addWorksheet('🏠 Mon Logement', {
      properties: { tabColor: { argb: this.colors.warning } },
    });
    sheet.getColumn(1).width = 3;
    sheet.getColumn(2).width = 35;
    sheet.getColumn(3).width = 55;
    sheet.getColumn(4).width = 3;

    let row = 2;
    row = this.xlsxPageHeader(sheet, row, 'MON LOGEMENT', '🏠');

    if (!home) {
      row = this.xlsxEmptyState(sheet, row, 'Aucun logement enregistré');
      return;
    }

    row = this.xlsxSectionTitle(sheet, row, '📍 LOCALISATION');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Adresse', home.addressFormatted],
      ['Place ID Google', home.addressPlaceId || 'N/A'],
      ['Latitude', home.lat?.toFixed(6) || 'N/A'],
      ['Longitude', home.lng?.toFixed(6) || 'N/A'],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '🏗️ CARACTÉRISTIQUES');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Type', this.homeTypeLabels[home.homeType] || home.homeType],
      ['Pièces', `${home.nbRooms} pièce(s)`],
      ['Surface', `${home.surface} m²`],
      ['Loyer', `${home.rent} € / mois`],
    ]);
    row++;

    if (home.description) {
      row = this.xlsxSectionTitle(sheet, row, '📝 DESCRIPTION');
      sheet.mergeCells(`B${row}:C${row}`);
      sheet.getCell(`B${row}`).value = home.description;
      sheet.getCell(`B${row}`).font = {
        size: 10,
        color: { argb: this.colors.textMain },
      };
      sheet.getCell(`B${row}`).alignment = { wrapText: true, vertical: 'top' };
      sheet.getCell(`B${row}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: this.colors.bgCard },
      };
      sheet.getRow(row).height = Math.max(
        40,
        Math.ceil(home.description.length / 80) * 15,
      );
      row += 2;
    }

    row = this.xlsxSectionTitle(sheet, row, '📷 PHOTOS');
    if (home.images?.length > 0) {
      row = this.xlsxKeyValueBlock(sheet, row, [
        ['Nombre', `${home.images.length} photo(s)`],
      ]);
      home.images.forEach((img, index) => {
        const url = img.presignedUrl || img.url || 'N/A';
        sheet.getCell(`B${row}`).value = `Photo ${index + 1}`;
        sheet.getCell(`B${row}`).font = {
          size: 9,
          color: { argb: this.colors.secondary },
        };
        sheet.getCell(`C${row}`).value = url;
        sheet.getCell(`C${row}`).font = {
          size: 8,
          color: { argb: this.colors.info },
        };
        sheet.getCell(`C${row}`).alignment = { wrapText: true };
        sheet.getRow(row).height = 18;
        row++;
      });
    } else {
      sheet.getCell(`B${row}`).value = 'Aucune photo';
      sheet.getCell(`B${row}`).font = {
        size: 10,
        color: { argb: this.colors.textMuted },
        italic: true,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXCEL: RECHERCHE
  // ═══════════════════════════════════════════════════════════════════
  private async xlsxSearchSheet(workbook: ExcelJS.Workbook, searches: any[]) {
    const sheet = workbook.addWorksheet('🔍 Ma Recherche', {
      properties: { tabColor: { argb: this.colors.success } },
    });
    sheet.getColumn(1).width = 3;
    sheet.getColumn(2).width = 35;
    sheet.getColumn(3).width = 55;
    sheet.getColumn(4).width = 3;

    let row = 2;
    row = this.xlsxPageHeader(sheet, row, 'MA RECHERCHE', '🔍');

    if (!searches || searches.length === 0) {
      row = this.xlsxEmptyState(sheet, row, 'Aucune recherche enregistrée');
      return;
    }

    const search = searches[0];

    row = this.xlsxSectionTitle(sheet, row, '💰 BUDGET');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Loyer minimum', search.minRent ? `${search.minRent} €` : 'Non défini'],
      ['Loyer maximum', search.maxRent ? `${search.maxRent} €` : 'Non défini'],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📐 SURFACE');
    row = this.xlsxKeyValueBlock(sheet, row, [
      [
        'Minimum',
        search.minRoomSurface ? `${search.minRoomSurface} m²` : 'Non défini',
      ],
      [
        'Maximum',
        search.maxRoomSurface ? `${search.maxRoomSurface} m²` : 'Non défini',
      ],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '🚪 NOMBRE DE PIÈCES');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Minimum', search.minRoomNb?.toString() || 'Non défini'],
      ['Maximum', search.maxRoomNb?.toString() || 'Non défini'],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '🏠 TYPES DE LOGEMENT');
    let homeTypes = 'Tous types';
    try {
      const types = search.homeType
        ? Array.isArray(search.homeType)
          ? search.homeType
          : JSON.parse(search.homeType)
        : [];
      if (types.length > 0)
        homeTypes = types.map((t) => this.homeTypeLabels[t] || t).join(', ');
    } catch (e) {
      homeTypes = String(search.homeType) || 'Tous types';
    }
    row = this.xlsxKeyValueBlock(sheet, row, [['Types acceptés', homeTypes]]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📅 DISPONIBILITÉ');
    row = this.xlsxKeyValueBlock(sheet, row, [
      [
        'Disponible à partir du',
        search.searchStartDate
          ? this.formatDate(search.searchStartDate)
          : 'Non défini',
      ],
      [
        "Recherche active jusqu'au",
        search.searchEndDate
          ? this.formatDate(search.searchEndDate)
          : 'Non défini',
      ],
    ]);
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📍 ZONES DE RECHERCHE');
    if (search.searchAdresses?.length > 0) {
      search.searchAdresses.forEach((zone, index) => {
        const zoneLabel = zone.label || 'Zone sans nom';
        const radius = zone.radius ? ` (rayon: ${zone.radius} km)` : '';
        sheet.getCell(`B${row}`).value = `Zone ${index + 1}`;
        sheet.getCell(`B${row}`).font = {
          bold: true,
          size: 10,
          color: { argb: this.colors.textMain },
        };
        sheet.getCell(`C${row}`).value = `${zoneLabel}${radius}`;
        sheet.getCell(`C${row}`).font = {
          size: 10,
          color: { argb: this.colors.textMain },
        };
        sheet.getRow(row).height = 22;
        row++;
      });
    } else {
      sheet.getCell(`B${row}`).value = 'Aucune zone définie';
      sheet.getCell(`B${row}`).font = {
        size: 10,
        color: { argb: this.colors.textMuted },
        italic: true,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXCEL: MATCHS
  // ═══════════════════════════════════════════════════════════════════
  private async xlsxMatchesSheet(
    workbook: ExcelJS.Workbook,
    intents: any[],
    userId: number,
  ) {
    const sheet = workbook.addWorksheet('💫 Mes Matchs', {
      properties: { tabColor: { argb: 'EC4899' } },
    });
    sheet.getColumn(1).width = 3;
    sheet.getColumn(2).width = 14;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 12;
    sheet.getColumn(5).width = 35;
    sheet.getColumn(6).width = 12;
    sheet.getColumn(7).width = 40;
    sheet.getColumn(8).width = 3;

    let row = 2;
    row = this.xlsxPageHeader(sheet, row, 'MES MATCHS', '💫');

    const intent = intents?.[0];

    if (intent) {
      row = this.xlsxSectionTitle(sheet, row, '💎 RÉSUMÉ CRÉDITS');
      row = this.xlsxKeyValueBlock(sheet, row, [
        ['Crédits achetés', intent.totalMatchesPurchased || 0],
        ['Crédits utilisés', intent.totalMatchesUsed || 0],
        ['Crédits restants', intent.totalMatchesRemaining || 0],
        ['En flow', intent.isInFlow ? '✅ Oui' : '❌ Non'],
        ['Recherche active', intent.isActivelySearching ? '✅ Oui' : '❌ Non'],
      ]);
      row++;
    }

    const allMatches: any[] = [];
    for (const i of intents || []) {
      for (const m of i.matchesAsSeeker || []) {
        allMatches.push({
          date: m.createdAt,
          type: m.type,
          direction: '➡️ Sortant',
          target: m.targetHome?.addressFormatted || 'N/A',
          status: m.status,
          snapshot: m.snapshot,
        });
      }
      for (const m of i.matchesAsTarget || []) {
        allMatches.push({
          date: m.createdAt,
          type: m.type,
          direction: '⬅️ Entrant',
          target: m.seekerIntent?.home?.addressFormatted || 'N/A',
          status: m.status,
          snapshot: m.snapshot,
        });
      }
    }

    row = this.xlsxSectionTitle(
      sheet,
      row,
      `📋 LISTE DES MATCHS (${allMatches.length})`,
    );

    if (allMatches.length === 0) {
      row = this.xlsxEmptyState(sheet, row, 'Aucun match enregistré');
      return;
    }

    allMatches.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const headers = [
      'Date',
      'Type',
      'Direction',
      'Logement cible',
      'Statut',
      'Snapshot JSON',
    ];
    headers.forEach((h, i) => {
      const cell = sheet.getCell(row, i + 2);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: this.colors.white } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: this.colors.tableHeader },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = this.xlsxBorderStyle(this.colors.primaryDark);
    });
    sheet.getRow(row).height = 26;
    row++;

    allMatches.forEach((match, index) => {
      const isEven = index % 2 === 0;
      const bgColor = isEven
        ? this.colors.tableRowEven
        : this.colors.tableRowOdd;

      const values = [
        this.formatDate(match.date),
        this.matchTypeLabels[match.type] || match.type,
        match.direction,
        match.target,
        this.matchStatusLabels[match.status] || match.status,
        match.snapshot
          ? JSON.stringify(match.snapshot).substring(0, 100)
          : 'N/A',
      ];

      values.forEach((v, i) => {
        const cell = sheet.getCell(row, i + 2);
        cell.value = v;
        cell.font = { size: 9, color: { argb: this.colors.textMain } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        cell.alignment = { wrapText: true, vertical: 'middle' };
        cell.border = {
          bottom: { style: 'thin', color: { argb: this.colors.border } },
        };
      });

      sheet.getRow(row).height = 22;
      row++;
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXCEL: MESSAGES
  // ═══════════════════════════════════════════════════════════════════
  private async xlsxMessagesSheet(
    workbook: ExcelJS.Workbook,
    chatParticipants: any[],
    userId: number,
  ) {
    const sheet = workbook.addWorksheet('💬 Messages', {
      properties: { tabColor: { argb: '14B8A6' } },
    });
    sheet.getColumn(1).width = 3;
    sheet.getColumn(2).width = 8;
    sheet.getColumn(3).width = 18;
    sheet.getColumn(4).width = 16;
    sheet.getColumn(5).width = 55;
    sheet.getColumn(6).width = 10;
    sheet.getColumn(7).width = 3;

    let row = 2;
    row = this.xlsxPageHeader(sheet, row, 'MESSAGES', '💬');

    const conversations =
      chatParticipants?.filter((p) => p.chat?.messages?.length > 0) || [];
    const totalMessages = conversations.reduce(
      (s, p) => s + (p.chat?.messages?.length || 0),
      0,
    );

    row = this.xlsxSectionTitle(sheet, row, '📊 RÉSUMÉ');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Conversations', `${conversations.length}`],
      ['Messages totaux', `${totalMessages}`],
    ]);
    row++;

    if (conversations.length === 0) {
      row = this.xlsxEmptyState(sheet, row, 'Aucune conversation');
      return;
    }

    let convIndex = 1;
    for (const participant of conversations) {
      const chat = participant.chat;
      const others = chat.participants
        .filter((p) => p.userId !== userId)
        .map((p) => `${p.user.firstName} ${p.user.lastName}`)
        .join(', ');

      row = this.xlsxSectionTitle(
        sheet,
        row,
        `💬 CONV. ${convIndex} — ${others || 'Inconnu'}`,
      );

      const headers = ['#', 'Date', 'Expéditeur', 'Message', 'Type'];
      headers.forEach((h, i) => {
        const cell = sheet.getCell(row, i + 2);
        cell.value = h;
        cell.font = { bold: true, size: 9, color: { argb: this.colors.white } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: this.colors.tableHeader },
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      sheet.getRow(row).height = 22;
      row++;

      chat.messages.forEach((msg, msgIdx) => {
        const isMe = msg.senderId === userId;
        const isEven = msgIdx % 2 === 0;
        const bgColor = isEven
          ? this.colors.tableRowEven
          : this.colors.tableRowOdd;

        const values = [
          `${msgIdx + 1}`,
          this.formatDateTime(msg.createdAt),
          isMe ? '🟢 Moi' : msg.sender?.firstName || 'Inconnu',
          msg.content || '[Média]',
          msg.type || 'TEXT',
        ];

        values.forEach((v, i) => {
          const cell = sheet.getCell(row, i + 2);
          cell.value = v;
          cell.font = {
            size: 9,
            color: {
              argb:
                isMe && i === 2 ? this.colors.primary : this.colors.textMain,
            },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgColor },
          };
          cell.alignment = { wrapText: true, vertical: 'middle' };
        });

        sheet.getRow(row).height = Math.max(
          20,
          Math.ceil((msg.content?.length || 0) / 60) * 12,
        );
        row++;
      });

      convIndex++;
      row++;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXCEL: TRANSACTIONS
  // ═══════════════════════════════════════════════════════════════════
  private async xlsxTransactionsSheet(
    workbook: ExcelJS.Workbook,
    transactions: any[],
    payments: any[],
  ) {
    const sheet = workbook.addWorksheet('💳 Transactions', {
      properties: { tabColor: { argb: '8B5CF6' } },
    });
    sheet.getColumn(1).width = 3;
    sheet.getColumn(2).width = 16;
    sheet.getColumn(3).width = 18;
    sheet.getColumn(4).width = 10;
    sheet.getColumn(5).width = 12;
    sheet.getColumn(6).width = 12;
    sheet.getColumn(7).width = 12;
    sheet.getColumn(8).width = 3;

    let row = 2;
    row = this.xlsxPageHeader(sheet, row, 'TRANSACTIONS', '💳');

    row = this.xlsxSectionTitle(sheet, row, '💰 PAIEMENTS');

    if (!payments || payments.length === 0) {
      row = this.xlsxEmptyState(sheet, row, 'Aucun paiement enregistré');
    } else {
      let totalSpent = 0;
      payments
        .filter((p) => p.status === 'SUCCEEDED')
        .forEach((p) => (totalSpent += p.amountTotal || 0));

      row = this.xlsxKeyValueBlock(sheet, row, [
        ['Nombre de paiements', `${payments.length}`],
        ['Total dépensé', `${totalSpent.toFixed(2)} €`],
      ]);
      row++;

      const headers = [
        'Date',
        'Pack',
        'Crédits',
        'Montant HT',
        'Total TTC',
        'Statut',
      ];
      headers.forEach((h, i) => {
        const cell = sheet.getCell(row, i + 2);
        cell.value = h;
        cell.font = {
          bold: true,
          size: 10,
          color: { argb: this.colors.white },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: this.colors.tableHeader },
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      sheet.getRow(row).height = 24;
      row++;

      payments.forEach((payment, index) => {
        const isEven = index % 2 === 0;
        const bgColor = isEven
          ? this.colors.tableRowEven
          : this.colors.tableRowOdd;
        const statusIcon =
          payment.status === 'SUCCEEDED'
            ? '✅'
            : payment.status === 'FAILED'
              ? '❌'
              : '⏳';

        const values = [
          this.formatDate(payment.createdAt),
          payment.planType || 'N/A',
          payment.matchesInitial?.toString() || '0',
          `${payment.amountBase?.toFixed(2) || '0.00'} €`,
          `${payment.amountTotal?.toFixed(2) || '0.00'} €`,
          `${statusIcon} ${this.paymentStatusLabels[payment.status] || payment.status}`,
        ];

        values.forEach((v, i) => {
          const cell = sheet.getCell(row, i + 2);
          cell.value = v;
          cell.font = { size: 9, color: { argb: this.colors.textMain } };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgColor },
          };
          cell.border = {
            bottom: { style: 'thin', color: { argb: this.colors.border } },
          };
        });

        sheet.getRow(row).height = 22;
        row++;
      });
    }

    row += 2;

    row = this.xlsxSectionTitle(sheet, row, '📜 JOURNAL DES TRANSACTIONS');

    if (!transactions || transactions.length === 0) {
      row = this.xlsxEmptyState(sheet, row, 'Aucune transaction');
      return;
    }

    const txHeaders = ['Date', 'Type', 'Statut', 'Montant', 'ID Stripe'];
    txHeaders.forEach((h, i) => {
      const cell = sheet.getCell(row, i + 2);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: this.colors.white } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: this.colors.secondary },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    sheet.getRow(row).height = 24;
    row++;

    transactions.forEach((tx, index) => {
      const isEven = index % 2 === 0;
      const bgColor = isEven
        ? this.colors.tableRowEven
        : this.colors.tableRowOdd;

      const values = [
        this.formatDateTime(tx.occurredAt),
        tx.type || 'N/A',
        tx.status || 'N/A',
        tx.amountTotal ? `${tx.amountTotal.toFixed(2)} €` : 'N/A',
        tx.stripeObjectId || 'N/A',
      ];

      values.forEach((v, i) => {
        const cell = sheet.getCell(row, i + 2);
        cell.value = v;
        cell.font = { size: 9, color: { argb: this.colors.textMain } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        cell.alignment = { wrapText: true, vertical: 'middle' };
      });

      sheet.getRow(row).height = 22;
      row++;
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXCEL: ACTIVITÉ
  // ═══════════════════════════════════════════════════════════════════
  private async xlsxActivitySheet(workbook: ExcelJS.Workbook, user: any) {
    const sheet = workbook.addWorksheet('📊 Activité', {
      properties: { tabColor: { argb: '64748B' } },
    });
    sheet.getColumn(1).width = 3;
    sheet.getColumn(2).width = 22;
    sheet.getColumn(3).width = 20;
    sheet.getColumn(4).width = 50;
    sheet.getColumn(5).width = 3;

    let row = 2;
    row = this.xlsxPageHeader(sheet, row, 'ACTIVITÉ & SÉCURITÉ', '📊');

    row = this.xlsxSectionTitle(sheet, row, '🔐 HISTORIQUE DE CONNEXIONS');
    if (user.connectionLogs?.length > 0) {
      row = this.xlsxKeyValueBlock(sheet, row, [
        ['Connexions enregistrées', `${user.connectionLogs.length}`],
      ]);

      const headers = ['Date et heure', 'Adresse IP'];
      headers.forEach((h, i) => {
        const cell = sheet.getCell(row, i + 2);
        cell.value = h;
        cell.font = { bold: true, size: 9, color: { argb: this.colors.white } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: this.colors.secondary },
        };
      });
      sheet.getRow(row).height = 22;
      row++;

      user.connectionLogs.forEach((log, index) => {
        const bgColor =
          index % 2 === 0 ? this.colors.tableRowEven : this.colors.tableRowOdd;
        sheet.getCell(`B${row}`).value = this.formatDateTime(log.loginDate);
        sheet.getCell(`B${row}`).font = {
          size: 9,
          color: { argb: this.colors.textMain },
        };
        sheet.getCell(`B${row}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        sheet.getCell(`C${row}`).value = log.ip || 'N/A';
        sheet.getCell(`C${row}`).font = {
          size: 9,
          color: { argb: this.colors.textLight },
        };
        sheet.getCell(`C${row}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        sheet.getRow(row).height = 20;
        row++;
      });
    } else {
      row = this.xlsxEmptyState(sheet, row, 'Aucun historique');
    }
    row++;

    row = this.xlsxSectionTitle(sheet, row, '🔔 NOTIFICATIONS');
    if (user.notifications?.length > 0) {
      row = this.xlsxKeyValueBlock(sheet, row, [
        ['Nombre', `${user.notifications.length}`],
      ]);

      const headers = ['Date', 'Type', 'Contenu'];
      headers.forEach((h, i) => {
        const cell = sheet.getCell(row, i + 2);
        cell.value = h;
        cell.font = { bold: true, size: 9, color: { argb: this.colors.white } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: this.colors.tableHeader },
        };
      });
      sheet.getRow(row).height = 22;
      row++;

      user.notifications.slice(0, 30).forEach((notif, index) => {
        const bgColor =
          index % 2 === 0 ? this.colors.tableRowEven : this.colors.tableRowOdd;
        sheet.getCell(`B${row}`).value = this.formatDateTime(notif.createdAt);
        sheet.getCell(`B${row}`).font = {
          size: 9,
          color: { argb: this.colors.textMain },
        };
        sheet.getCell(`B${row}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        sheet.getCell(`C${row}`).value =
          this.notificationTypeLabels[notif.type] || notif.type;
        sheet.getCell(`C${row}`).font = {
          size: 9,
          color: { argb: this.colors.textMain },
        };
        sheet.getCell(`C${row}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        sheet.getCell(`D${row}`).value =
          notif.content?.substring(0, 60) || 'N/A';
        sheet.getCell(`D${row}`).font = {
          size: 9,
          color: { argb: this.colors.textLight },
        };
        sheet.getCell(`D${row}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        sheet.getRow(row).height = 20;
        row++;
      });
    } else {
      row = this.xlsxEmptyState(sheet, row, 'Aucune notification');
    }
    row++;

    row = this.xlsxSectionTitle(sheet, row, '🚨 SIGNALEMENTS EFFECTUÉS');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Nombre', `${user.reportsMade?.length || 0}`],
    ]);
    if (user.reportsMade?.length > 0) {
      user.reportsMade.slice(0, 10).forEach((report) => {
        sheet.getCell(`B${row}`).value = this.formatDate(report.createdAt);
        sheet.getCell(`C${row}`).value =
          this.reportStatusLabels[report.status] || report.status;
        sheet.getCell(`D${row}`).value =
          report.reason?.substring(0, 50) || 'N/A';
        sheet.getRow(row).height = 20;
        row++;
      });
    }
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📩 SIGNALEMENTS REÇUS');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Nombre', `${user.reportsReceived?.length || 0}`],
    ]);
    if (user.reportsReceived?.length > 0) {
      user.reportsReceived.slice(0, 10).forEach((report) => {
        sheet.getCell(`B${row}`).value = this.formatDate(report.createdAt);
        sheet.getCell(`C${row}`).value =
          this.reportStatusLabels[report.status] || report.status;
        sheet.getCell(`D${row}`).value =
          report.reason?.substring(0, 50) || 'N/A';
        sheet.getRow(row).height = 20;
        row++;
      });
    }
    row++;

    row = this.xlsxSectionTitle(sheet, row, "🆘 DEMANDES D'AIDE");
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Nombre', `${user.helpRequests?.length || 0}`],
    ]);
    if (user.helpRequests?.length > 0) {
      user.helpRequests.slice(0, 10).forEach((request) => {
        sheet.getCell(`B${row}`).value = this.formatDate(request.createdAt);
        sheet.getCell(`C${row}`).value =
          this.helpTopicLabels[request.topic] || request.topic;
        sheet.getCell(`D${row}`).value =
          this.helpStatusLabels[request.status] || request.status;
        sheet.getRow(row).height = 20;
        row++;
      });
    }
    row++;

    row = this.xlsxSectionTitle(sheet, row, '📱 ABONNEMENTS PUSH');
    row = this.xlsxKeyValueBlock(sheet, row, [
      ['Appareils enregistrés', `${user.pushSubscriptions?.length || 0}`],
    ]);
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXCEL HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════

  private xlsxTitle(
    sheet: ExcelJS.Worksheet,
    row: number,
    title: string,
    subtitle: string,
  ): number {
    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).value = title;
    sheet.getCell(`B${row}`).font = {
      bold: true,
      size: 28,
      color: { argb: this.colors.primary },
    };
    sheet.getCell(`B${row}`).alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    sheet.getRow(row).height = 45;
    row++;

    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).value = subtitle;
    sheet.getCell(`B${row}`).font = {
      size: 12,
      color: { argb: this.colors.secondary },
      italic: true,
    };
    sheet.getCell(`B${row}`).alignment = { horizontal: 'center' };
    row += 2;

    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: this.colors.primary },
    };
    sheet.getRow(row).height = 4;
    row += 2;

    return row;
  }

  private xlsxPageHeader(
    sheet: ExcelJS.Worksheet,
    row: number,
    title: string,
    emoji: string,
  ): number {
    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).value = `${emoji} ${title}`;
    sheet.getCell(`B${row}`).font = {
      bold: true,
      size: 22,
      color: { argb: this.colors.primary },
    };
    sheet.getCell(`B${row}`).alignment = { vertical: 'middle' };
    sheet.getRow(row).height = 36;
    row++;

    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: this.colors.primary },
    };
    sheet.getRow(row).height = 3;
    row += 2;

    return row;
  }

  private xlsxSectionTitle(
    sheet: ExcelJS.Worksheet,
    row: number,
    title: string,
  ): number {
    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).value = title;
    sheet.getCell(`B${row}`).font = {
      bold: true,
      size: 12,
      color: { argb: this.colors.primary },
    };
    sheet.getCell(`B${row}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: this.colors.bgMain },
    };
    sheet.getCell(`B${row}`).border = {
      bottom: { style: 'medium', color: { argb: this.colors.primary } },
    };
    sheet.getRow(row).height = 26;
    return row + 1;
  }

  private xlsxKeyValueBlock(
    sheet: ExcelJS.Worksheet,
    row: number,
    data: [string, any][],
  ): number {
    data.forEach(([label, value], index) => {
      const bgColor = index % 2 === 0 ? this.colors.white : this.colors.bgCard;

      sheet.getCell(`B${row}`).value = label;
      sheet.getCell(`B${row}`).font = {
        size: 10,
        color: { argb: this.colors.secondary },
      };
      sheet.getCell(`B${row}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bgColor },
      };

      sheet.getCell(`C${row}`).value = String(value ?? 'N/A');
      sheet.getCell(`C${row}`).font = {
        size: 10,
        color: { argb: this.colors.textMain },
      };
      sheet.getCell(`C${row}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: bgColor },
      };
      sheet.getCell(`C${row}`).alignment = { wrapText: true };

      sheet.getRow(row).height = 22;
      row++;
    });
    return row;
  }

  private xlsxWarningBox(
    sheet: ExcelJS.Worksheet,
    row: number,
    title: string,
    lines: string[],
  ): number {
    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).value = title;
    sheet.getCell(`B${row}`).font = {
      bold: true,
      size: 12,
      color: { argb: this.colors.warning },
    };
    sheet.getCell(`B${row}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FEF3C7' },
    };
    sheet.getCell(`B${row}`).alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    sheet.getCell(`B${row}`).border = this.xlsxBorderStyle('F59E0B');
    sheet.getRow(row).height = 28;
    row++;

    lines.forEach((text) => {
      sheet.mergeCells(`B${row}:C${row}`);
      sheet.getCell(`B${row}`).value = text;
      sheet.getCell(`B${row}`).font = {
        size: 9,
        color: { argb: this.colors.textMain },
      };
      sheet.getCell(`B${row}`).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFBEB' },
      };
      sheet.getCell(`B${row}`).alignment = {
        horizontal: 'center',
        wrapText: true,
      };
      sheet.getCell(`B${row}`).border = {
        left: { style: 'thin', color: { argb: 'F59E0B' } },
        right: { style: 'thin', color: { argb: 'F59E0B' } },
      };
      sheet.getRow(row).height = text ? 18 : 8;
      row++;
    });

    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).border = {
      top: { style: 'thin', color: { argb: 'F59E0B' } },
    };
    row += 2;

    return row;
  }

  private xlsxEmptyState(
    sheet: ExcelJS.Worksheet,
    row: number,
    message: string,
  ): number {
    sheet.mergeCells(`B${row}:C${row}`);
    sheet.getCell(`B${row}`).value = `📭 ${message}`;
    sheet.getCell(`B${row}`).font = {
      size: 12,
      color: { argb: this.colors.textMuted },
      italic: true,
    };
    sheet.getCell(`B${row}`).alignment = {
      horizontal: 'center',
      vertical: 'middle',
    };
    sheet.getRow(row).height = 35;
    return row + 1;
  }

  private xlsxJsonBlock(
    sheet: ExcelJS.Worksheet,
    row: number,
    data: any,
  ): number {
    const jsonStr = JSON.stringify(data, null, 2).substring(0, 3000);
    const lines = jsonStr.split('\n').slice(0, 25);

    sheet.mergeCells(`B${row}:C${row + Math.min(lines.length, 25)}`);
    sheet.getCell(`B${row}`).value = jsonStr;
    sheet.getCell(`B${row}`).font = {
      name: 'Consolas',
      size: 8,
      color: { argb: this.colors.textMain },
    };
    sheet.getCell(`B${row}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'F3F4F6' },
    };
    sheet.getCell(`B${row}`).alignment = { wrapText: true, vertical: 'top' };
    sheet.getCell(`B${row}`).border = this.xlsxBorderStyle(this.colors.border);

    sheet.getRow(row).height = Math.min(lines.length, 25) * 12;

    return row + Math.min(lines.length, 25) + 2;
  }

  private xlsxBorderStyle(color: string): Partial<ExcelJS.Borders> {
    return {
      top: { style: 'thin', color: { argb: color } },
      left: { style: 'thin', color: { argb: color } },
      bottom: { style: 'thin', color: { argb: color } },
      right: { style: 'thin', color: { argb: color } },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════

  private formatDate(date: Date | string | null): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private formatDateTime(date: Date | string | null): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private async getPresignedUrl(key: string): Promise<string> {
    if (!key) return '';
    if (!this.bucketName || !this.s3Client) return `/uploads/${key}`;
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      return await getSignedUrl(this.s3Client, command, { expiresIn: 604800 });
    } catch (error) {
      return `/uploads/${key}`;
    }
  }
}
