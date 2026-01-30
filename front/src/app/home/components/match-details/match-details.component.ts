import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import {
    MatchItemDetails,
    MatchingService,
    MatchStatus,
    MatchType,
    TriangleSnapshot,
    TriangleSearchSnapshot,
    TriangleEdgeEvaluation,
} from '../../../matching/services/matching.service';

@Component({
    selector: 'app-match-details',
    templateUrl: './match-details.component.html',
    styleUrls: ['./match-details.component.scss'],
})
export class MatchDetailsComponent implements OnInit, OnDestroy {
    match: MatchItemDetails | null = null;
    isLoading = true;
    error: string | null = null;

    // UI States
    isMobile = false;
    isSnapshotOpen = false;
    isGalleryOpen = false;
    isActionLoading = false;
    isActionsMenuOpen = false;
    isNotInterestedModalOpen = false;
    isInterestedModalOpen = false;

    // Gallery
    images: string[] = [];
    currentImageIndex = 0;
    galleryImageIndex = 0;

    // Enums
    MatchStatus = MatchStatus;
    MatchType = MatchType;

    // Triangle match view model - dynamic, role-aware
    triangleVm: {
        // The connected user's position in the chain
        you: { name: string; initials: string };
        target: { name: string; initials: string; homeAddress?: string };
        third: { name: string; initials: string; homeAddress?: string };
        yourHomeAddress?: string;
        // Dynamic instructions
        instructions: {
            step1: string; // What YOU need to do
            step2: string; // What TARGET needs to do
            step3: string; // What THIRD needs to do (affects you)
        };
    } | null = null;

    // Snapshot criteria for "Pourquoi ce match?" section (works for both STANDARD and TRIANGLE)
    snapshotEvaluation: {
        rent?: { homeValue: number; searchMin?: number; searchMax?: number; passed: boolean };
        surface?: { homeValue: number; searchMin?: number; searchMax?: number; passed: boolean };
        rooms?: { homeValue: number; searchMin?: number; searchMax?: number; passed: boolean };
        homeType?: { homeValue: string; searchTypes?: string[]; passed: boolean };
        zones?: { passed: boolean; details?: string };
    } | null = null;


    private destroy$ = new Subject<void>();
    private scrollLockCount = 0;

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private matchingService: MatchingService,
        private snackBar: MatSnackBar,
        private location: Location
    ) { }

    ngOnInit(): void {
        this.checkMobile();

        this.route.paramMap
            .pipe(
                takeUntil(this.destroy$),
                switchMap((params) => {
                    const uid = params.get('uid');
                    if (!uid) {
                        throw new Error('UID manquant dans l\'URL');
                    }
                    this.isLoading = true;
                    this.error = null;
                    return this.matchingService.getMatchByUid(uid);
                })
            )
            .subscribe({
                next: (match) => {
                    this.match = match;
                    this.images = this.buildImages(match);
                    this.currentImageIndex = 0;
                    this.galleryImageIndex = 0;
                    this.buildTriangleVm();
                    this.isLoading = false;
                },
                error: () => {
                    this.isLoading = false;
                    this.error = 'Impossible de charger le match. Il a peut-être été supprimé ou vous n’avez pas les droits.';
                },
            });
    }

    ngOnDestroy(): void {
        this.scrollLockCount = 0;
        document.body.style.overflow = '';
        this.destroy$.next();
        this.destroy$.complete();
    }

    @HostListener('window:resize')
    onResize(): void {
        this.checkMobile();
    }

    @HostListener('document:click')
    onDocumentClick(): void {
        this.isActionsMenuOpen = false;
    }

    onActionsMenuToggle(event: Event): void {
        event.stopPropagation();
        this.isActionsMenuOpen = !this.isActionsMenuOpen;
    }

    onCloseActionsMenu(): void {
        this.isActionsMenuOpen = false;
    }

    goBack(): void {
        this.location.back();
    }

    private checkMobile(): void {
        this.isMobile = window.innerWidth < 768; // Md breakpoint
    }

    // Actions
    launchChat(): void {
        if (!this.match) return;

        if (this.match.status === MatchStatus.NEW) {
            this.isActionLoading = true;
            this.matchingService.updateMatchStatusByUid(this.match.uid, MatchStatus.IN_PROGRESS)
                .subscribe({
                    next: (res) => {
                        if (this.match) this.match.status = res.status;
                        this.isActionLoading = false;
                        this.proceedToChat();
                    },
                    error: () => {
                        this.isActionLoading = false;
                        this.snackBar.open('Erreur de connexion.', 'OK', { duration: 3000 });
                    }
                });
        } else {
            this.proceedToChat();
        }
    }

    private proceedToChat(): void {
        if (!this.match?.groupId) {
            this.snackBar.open('Identifiant de groupe manquant pour ce match.', 'Fermer', { duration: 3000 });
            return;
        }

        this.isActionLoading = true;
        this.matchingService.createChatForGroup(this.match.groupId)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: () => {
                    this.isActionLoading = false;
                    this.router.navigate(['/matching/chat', this.match!.groupId]);
                },
                error: () => {
                    this.isActionLoading = false;
                    this.snackBar.open('Impossible de lancer le chat.', 'Fermer', { duration: 3000 });
                }
            });
    }

    notInterested(): void {
        this.isNotInterestedModalOpen = true;
        this.lockBodyScroll();
    }

    confirmNotInterested(): void {
        if (!this.match) return;
        this.isNotInterestedModalOpen = false;
        this.isActionLoading = true;
        this.unlockBodyScroll();

        this.matchingService.updateMatchStatusByUid(this.match.uid, MatchStatus.NOT_INTERESTED)
            .subscribe({
                next: (res) => {
                    if (this.match) this.match.status = res.status;
                    this.isActionLoading = false;
                    if (this.match) this.match.status = res.status;
                    this.snackBar.open('Match archivé.', 'Fermer', { duration: 3000 });
                },
                error: () => {
                    this.isActionLoading = false;
                    this.snackBar.open('Une erreur est survenue.', 'Fermer', { duration: 3000 });
                }
            });
    }

    cancelNotInterested(): void {
        this.isNotInterestedModalOpen = false;
        this.unlockBodyScroll();
    }

    /**
     * Restore match from NOT_INTERESTED back to NEW status
     * Allows user to "undo" marking a match as not interested
     */
    restoreToList(): void {
        if (!this.match || this.match.status !== MatchStatus.NOT_INTERESTED) return;
        if (this.isActionLoading) return; // Prevent double-click

        this.isActionLoading = true;
        this.matchingService.updateMatchStatusByUid(this.match.uid, MatchStatus.NEW)
            .subscribe({
                next: (res) => {
                    if (this.match) this.match.status = res.status;
                    this.isActionLoading = false;
                    this.snackBar.open('Match remis en liste.', 'Fermer', { duration: 3000 });
                },
                error: () => {
                    this.isActionLoading = false;
                    this.snackBar.open('Une erreur est survenue.', 'Fermer', { duration: 3000 });
                }
            });
    }

    // UI Helpers
    openSnapshot(): void {
        this.isSnapshotOpen = true;
        this.lockBodyScroll();
    }

    closeSnapshot(): void {
        this.isSnapshotOpen = false;
        this.unlockBodyScroll();
    }

    openGallery(index?: number): void {
        if (!this.images.length) return;
        this.galleryImageIndex = typeof index === 'number' ? index : this.currentImageIndex;
        this.isGalleryOpen = true;
        this.lockBodyScroll();
    }

    closeGallery(): void {
        this.isGalleryOpen = false;
        this.unlockBodyScroll();
    }

    nextImage(): void {
        if (!this.images.length) return;
        this.currentImageIndex = (this.currentImageIndex + 1) % this.images.length;
    }

    previousImage(): void {
        if (!this.images.length) return;
        this.currentImageIndex =
            (this.currentImageIndex - 1 + this.images.length) % this.images.length;
    }

    goToImage(index: number): void {
        if (index < 0 || index >= this.images.length) return;
        this.currentImageIndex = index;
    }

    nextGalleryImage(): void {
        if (!this.images.length) return;
        this.galleryImageIndex = (this.galleryImageIndex + 1) % this.images.length;
    }

    previousGalleryImage(): void {
        if (!this.images.length) return;
        this.galleryImageIndex =
            (this.galleryImageIndex - 1 + this.images.length) % this.images.length;
    }

    goToGalleryImage(index: number): void {
        if (index < 0 || index >= this.images.length) return;
        this.galleryImageIndex = index;
    }

    getHomeTypeLabel(homeType: string): string {
        const labels: { [key: string]: string } = {
            CHAMBRE: 'Chambre',
            STUDIO: 'Studio',
            T1: 'T1', T1_BIS: 'T1 bis', T2: 'T2', T2_BIS: 'T2 bis',
            T3: 'T3', T3_BIS: 'T3 bis', T4: 'T4', T5: 'T5', T6_PLUS: 'T6+',
        };
        return labels[homeType] || homeType;
    }

    getStatusLabel(status: MatchStatus): string {
        switch (status) {
            case MatchStatus.NEW:
                return 'Nouveau Match';
            case MatchStatus.IN_PROGRESS:
                return 'Intéressé';
            case MatchStatus.NOT_INTERESTED:
                return 'Pas intéressé';
            case MatchStatus.ARCHIVED:
                return 'Ancien';
            default:
                return status;
        }
    }

    getStatusClass(status: MatchStatus): string {
        switch (status) {
            case MatchStatus.NEW:
                return 'bg-blue-100 text-blue-700';
            case MatchStatus.IN_PROGRESS:
                return 'bg-green-100 text-green-700';
            case MatchStatus.NOT_INTERESTED:
                return 'bg-gray-100 text-gray-500';
            case MatchStatus.ARCHIVED:
                return 'bg-gray-200 text-gray-600';
            default:
                return 'bg-gray-100 text-gray-500';
        }
    }

    formatDate(dateStr?: string | Date): string {
        if (!dateStr) return '';
        const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    }


    /**
     * Build triangle view model from snapshot data
     * Creates a dynamic, role-aware chain visualization
     *
     * Chain logic (A->B->C->A cycle):
     * - This Match row: seekerIntentId = connected user (A), targetIntentId = B
     * - A gets B's home (via B who gives bailleur contact)
     * - B gets C's home (via C who gives bailleur contact)
     * - C gets A's home (via A who gives bailleur contact)
     *
     * IMPORTANT: Users don't "accept each other's dossiers" as tenants.
     * Instead, each participant provides their bailleur/owner contact to the next.
     */
    private buildTriangleVm(): void {
        if (!this.match || this.match.type !== MatchType.TRIANGLE) {
            this.triangleVm = null;
            return;
        }

        const snapshot: any = this.match.snapshot;
        const triangleMeta = this.match.triangleMeta || snapshot;

        const participants = triangleMeta?.participants;
        if (!participants) {
            this.triangleVm = null;
            return;
        }

        const all = [participants.A, participants.B, participants.C].filter(Boolean);

        const seekerIntentId = this.match.seekerIntentId;
        const targetIntentId = this.match.targetIntentId;

        const youP = all.find((p: any) => p.intentId === seekerIntentId);
        const targetP = all.find((p: any) => p.intentId === targetIntentId);
        const thirdP = all.find((p: any) => p.intentId !== seekerIntentId && p.intentId !== targetIntentId);

        // Guard: triangle invalide (ou data incohérente)
        const distinctUserIds = new Set(all.map((p: any) => p.userId)).size;
        if (!youP || !targetP || !thirdP || distinctUserIds !== 3) {
            this.triangleVm = null;
            return;
        }

        const targetFullName =
            `${targetP.firstName || ''} ${targetP.lastName?.charAt(0) || ''}.`.trim() || 'Participant';
        const thirdFullName =
            `${thirdP.firstName || ''} ${thirdP.lastName?.charAt(0) || ''}.`.trim() || 'Participant';

        this.triangleVm = {
            you: { name: 'Vous', initials: 'V' },

            target: {
                name: targetFullName,
                initials: this.getInitials(targetP.firstName || 'T'),
                homeAddress: targetP.homeAddress,
            },

            third: {
                name: thirdFullName,
                initials: this.getInitials(thirdP.firstName || 'C'),
                homeAddress: thirdP.homeAddress,
            },

            yourHomeAddress: youP.homeAddress,

            instructions: {
                step1: `Vous visez le logement de ${targetFullName}. Contactez ${targetFullName} pour obtenir les coordonnées de son propriétaire/bailleur et envoyer votre dossier.`,
                step2: `${targetFullName} vise le logement de ${thirdFullName}. ${thirdFullName} transmettra les coordonnées de son bailleur à ${targetFullName}.`,
                step3: `${thirdFullName} vise votre logement. Vous transmettrez les coordonnées de votre propriétaire/bailleur à ${thirdFullName}.`,
            },
        };

        this.buildSnapshotEvaluation();
    }


    /**
     * Build snapshot evaluation data for display
     * Works for both STANDARD and TRIANGLE matches
     *
     * For TRIANGLE: finds the correct edge evaluation using seekerIntentId -> targetIntentId
     * The edge evaluations are keyed by participant labels (A_to_B, B_to_C, C_to_A)
     * but we need to match by actual intent IDs
     */
    private buildSnapshotEvaluation(): void {
        const snapshot: any = this.match?.snapshot;
        if (!snapshot) {
            this.snapshotEvaluation = null;
            return;
        }

        let evaluation: TriangleEdgeEvaluation | any = null;

        if (this.match?.type === MatchType.TRIANGLE && snapshot.edgeEvaluations) {
            // TRIANGLE: Find the edge matching this match row's seeker->target relationship
            const seekerIntentId = this.match.seekerIntentId;
            const targetIntentId = this.match.targetIntentId;

            if (seekerIntentId && targetIntentId) {
                // Search through all edges to find the one matching our intent IDs
                const edges: TriangleEdgeEvaluation[] = Object.values(snapshot.edgeEvaluations);
                evaluation = edges.find(
                    (edge: TriangleEdgeEvaluation) =>
                        edge.seekerIntentId === seekerIntentId && edge.targetIntentId === targetIntentId
                );
            }

            // Fallback to A_to_B if no match found (shouldn't happen with proper data)
            if (!evaluation && snapshot.edgeEvaluations.A_to_B) {
                evaluation = snapshot.edgeEvaluations.A_to_B;
            }
        } else if (snapshot.evaluation) {
            // STANDARD: use legacy evaluation structure
            evaluation = snapshot.evaluation;
        }

        if (!evaluation) {
            this.snapshotEvaluation = null;
            return;
        }

        this.snapshotEvaluation = {
            rent: evaluation.rent,
            surface: evaluation.surface,
            rooms: evaluation.rooms,
            homeType: evaluation.homeType,
            zones: evaluation.zones,
        };
    }

    /**
     * Get initials from a name (first letter uppercase)
     */
    private getInitials(name: string): string {
        if (!name) return '?';
        return name.charAt(0).toUpperCase();
    }


    private buildImages(match: MatchItemDetails): string[] {
        const urls = match?.targetHome?.imageUrls?.filter(Boolean) || [];
        if (urls.length > 0) {
            return urls;
        }
        if (match?.targetHome?.imageUrl) {
            return [match.targetHome.imageUrl];
        }
        return [];
    }

    private lockBodyScroll(): void {
        this.scrollLockCount += 1;
        document.body.style.overflow = 'hidden';
    }

    private unlockBodyScroll(): void {
        this.scrollLockCount = Math.max(0, this.scrollLockCount - 1);
        if (this.scrollLockCount === 0) {
            document.body.style.overflow = '';
        }
    }

    private toNumberOrNull(value: any): number | null {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
}
