import { Component, OnInit } from '@angular/core';
import { AdminService } from '../../../core/services/admin.service';
import { DatePipe } from '@angular/common';

@Component({
    selector: 'app-admin-influencers',
    templateUrl: './admin-influencers.component.html',
    styleUrls: []
})
export class AdminInfluencersComponent implements OnInit {
    activeTab: 'influencers' | 'codes' = 'influencers';

    influencers: any[] = [];
    promos: any[] = [];

    isLoading = false;

    // Modals
    showAddInfluencerModal = false;
    showAddPromoModal = false;
    showDeleteConfirmModal = false;
    showValidationErrors = false;

    // Forms
    newInfluencer = { firstName: '', lastName: '', email: '' };
    newPromo = {
        code: '',
        discountPercentage: 10,
        validUntil: '',
        usageLimit: null as number | null,
        influencerId: null as number | null,
        isActive: true
    };

    // Deletion Logic
    selectedInfluencerId: number | null = null;
    deletionImpactCount: number = 0;

    // UI State
    openActionMenuId: number | string | null = null;

    // Alert State
    alertMessage: string | null = null;
    alertType: 'success' | 'error' | 'warning' | 'info' = 'error';

    // Search
    searchTerm: string = '';

    get filteredInfluencers() {
        if (!this.searchTerm) return this.influencers;
        const lowerTerm = this.searchTerm.toLowerCase();
        return this.influencers.filter(inf =>
            inf.firstName.toLowerCase().includes(lowerTerm) ||
            inf.lastName.toLowerCase().includes(lowerTerm) ||
            inf.email.toLowerCase().includes(lowerTerm)
        );
    }

    get filteredPromos() {
        if (!this.searchTerm) return this.promos;
        const lowerTerm = this.searchTerm.toLowerCase();
        return this.promos.filter(promo =>
            promo.code.toLowerCase().includes(lowerTerm) ||
            (promo.influencer && (
                promo.influencer.firstName.toLowerCase().includes(lowerTerm) ||
                promo.influencer.lastName.toLowerCase().includes(lowerTerm)
            ))
        );
    }

    constructor(private adminService: AdminService) { }

    ngOnInit() {
        this.loadData();
    }

    loadData() {
        this.isLoading = true;
        this.adminService.getInfluencers().subscribe({
            next: (res) => {
                this.influencers = res.map((inf: any) => ({
                    ...inf,
                    totalUsage: inf.promoCodes?.reduce((acc: number, code: any) => acc + (code.currentUsageCount || 0), 0) || 0
                }));
                this.isLoading = false;
                if (this.influencers.length > 0 && !this.newPromo.influencerId) {
                    this.newPromo.influencerId = this.influencers[0].id;
                }
            },
            error: (err) => {
                console.error(err);
                this.isLoading = false;
            }
        });

        this.adminService.getPromos().subscribe({
            next: (res) => this.promos = res
        });
    }

    switchTab(tab: 'influencers' | 'codes') {
        this.activeTab = tab;
    }

    // --- Influencer Actions ---

    // Editing Logic
    editingInfluencerId: number | null = null;
    editingPromoId: number | null = null;

    // ...

    // --- Influencer Actions ---

    openAddInfluencer() {
        this.editingInfluencerId = null;
        this.newInfluencer = { firstName: '', lastName: '', email: '' };
        this.showAddInfluencerModal = true;
        this.showValidationErrors = false;
    }

    openEditInfluencer(inf: any) {
        // Stop propagation if strict needed, but usually clicking row handles it
        this.editingInfluencerId = inf.id;
        this.newInfluencer = {
            firstName: inf.firstName,
            lastName: inf.lastName,
            email: inf.email
        };
        this.showAddInfluencerModal = true;
        this.showValidationErrors = false;
        this.openActionMenuId = null;
    }

    submitInfluencer() {
        this.showValidationErrors = true;
        if (!this.newInfluencer.firstName || !this.newInfluencer.email) {
            this.alertMessage = 'Veuillez remplir les champs obligatoires (*).';
            this.alertType = 'error';
            return;
        }

        if (this.editingInfluencerId) {
            this.adminService.updateInfluencer(this.editingInfluencerId, this.newInfluencer).subscribe({
                next: () => {
                    this.showAddInfluencerModal = false;
                    this.showValidationErrors = false;
                    this.loadData();
                    this.alertMessage = 'Influenceur mis à jour avec succès.';
                    this.alertType = 'success';
                },
                error: (err) => {
                    console.error(err);
                    this.alertMessage = 'Une erreur est survenue lors de la mise à jour.';
                    this.alertType = 'error';
                }
            });
        } else {
            this.adminService.createInfluencer(this.newInfluencer).subscribe({
                next: () => {
                    this.showAddInfluencerModal = false;
                    this.showValidationErrors = false;
                    this.loadData();
                    this.alertMessage = 'Influenceur créé avec succès.';
                    this.alertType = 'success';
                },
                error: (err) => {
                    console.error(err);
                    this.alertMessage = 'Une erreur est survenue lors de la création.';
                    this.alertType = 'error';
                }
            });
        }
    }

    // ...

    openAddPromo() {
        this.editingPromoId = null;
        this.alertMessage = null; // Reset alert

        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);

        this.newPromo = {
            code: '',
            discountPercentage: 10,
            validUntil: nextMonth.toISOString().split('T')[0],
            usageLimit: null,
            influencerId: this.influencers.length > 0 ? this.influencers[0].id : null,
            isActive: true
        };
        this.showAddPromoModal = true;
        this.showValidationErrors = false;
    }

    openEditPromo(promo: any) {
        this.editingPromoId = promo.id;
        this.alertMessage = null;

        // Format date for input type="date"
        let validUntilStr = '';
        if (promo.validUntil) {
            const d = new Date(promo.validUntil);
            validUntilStr = d.toISOString().split('T')[0];
        }

        this.newPromo = {
            code: promo.code,
            discountPercentage: promo.discountPercentage,
            validUntil: validUntilStr,
            usageLimit: promo.usageLimit,
            influencerId: promo.influencerId,
            isActive: promo.isActive
        };
        this.showAddPromoModal = true;
        this.openActionMenuId = null;
    }

    submitPromo() {
        this.alertMessage = null;
        this.showValidationErrors = true;

        if (!this.newPromo.code || !this.newPromo.influencerId) {
            this.alertMessage = 'Veuillez remplir les champs obligatoires (*).';
            this.alertType = 'error';
            return;
        }

        if (this.editingPromoId) {
            this.adminService.updatePromo(this.editingPromoId, this.newPromo).subscribe({
                next: () => {
                    this.showAddPromoModal = false;
                    this.showValidationErrors = false;
                    this.loadData();
                    this.alertMessage = 'Code promo mis à jour.';
                    this.alertType = 'success';
                },
                error: (err) => {
                    console.error(err);
                    if (err.status === 409) {
                        this.alertMessage = 'Ce code promo existe déjà.';
                        this.alertType = 'error';
                    } else {
                        this.alertMessage = 'Erreur lors de la mise à jour.';
                        this.alertType = 'error';
                    }
                }
            });
        } else {
            this.adminService.createPromo(this.newPromo).subscribe({
                next: () => {
                    this.showAddPromoModal = false;
                    this.loadData();
                    this.alertMessage = 'Code promo créé avec succès.';
                    this.alertType = 'success';
                },
                error: (err) => {
                    console.error(err);
                    if (err.status === 409) {
                        this.alertMessage = 'Ce code promo existe déjà.';
                        this.alertType = 'error';
                    } else {
                        this.alertMessage = 'Une erreur est survenue lors de la création du code promo.';
                        this.alertType = 'error';
                    }
                }
            });
        }
    }

    // ... rest of class

    // Promo Deletion Logic
    showDeletePromoConfirmModal = false;
    selectedPromoId: number | null = null;

    // ...

    initiateDeletePromo(id: number) {
        this.selectedPromoId = id;
        this.showDeletePromoConfirmModal = true;
    }

    confirmDeletePromo() {
        if (!this.selectedPromoId) return;
        this.adminService.deletePromo(this.selectedPromoId).subscribe({
            next: () => {
                this.showDeletePromoConfirmModal = false;
                this.selectedPromoId = null;
                this.loadData();
                this.alertMessage = 'Code promo supprimé avec succès.';
                this.alertType = 'success';
            },
            error: (err) => {
                this.alertMessage = 'Erreur lors de la suppression du code promo.';
                this.alertType = 'error';
            }
        });
    }

    deletePromo(id: number) {
        this.initiateDeletePromo(id);
    }

    // Promo Toggle Logic
    showTogglePromoModal = false;
    selectedPromoToToggle: any = null;

    initiateTogglePromo(promo: any) {
        this.selectedPromoToToggle = promo;
        this.showTogglePromoModal = true;
    }

    confirmTogglePromo() {
        if (!this.selectedPromoToToggle) return;

        this.adminService.togglePromo(this.selectedPromoToToggle.id).subscribe({
            next: () => {
                this.showTogglePromoModal = false;
                this.selectedPromoToToggle = null;
                this.loadData();
                this.alertMessage = 'Statut du code promo mis à jour.';
                this.alertType = 'success';
            },
            error: (err) => {
                console.error(err);
                this.alertMessage = 'Erreur lors de la mise à jour du statut.';
                this.alertType = 'error';
            }
        });
    }

    getInfluencerName(id: number): string {
        const inf = this.influencers.find(i => i.id === id);
        return inf ? `${inf.firstName} ${inf.lastName}` : 'Inconnu';
    }

    toggleActionMenu(id: number | string) {
        if (this.openActionMenuId === id) {
            this.openActionMenuId = null;
        } else {
            this.openActionMenuId = id;
        }
    }
    // Missing methods restored
    initiateDeleteInfluencer(id: number) {
        this.selectedInfluencerId = id;
        this.adminService.getInfluencerDeletionImpact(id).subscribe({
            next: (res: any) => {
                this.deletionImpactCount = res.activeCodesCount;
                this.showDeleteConfirmModal = true;
            }
        });
    }

    confirmDeleteInfluencer() {
        if (!this.selectedInfluencerId) return;

        this.adminService.deleteInfluencer(this.selectedInfluencerId).subscribe({
            next: () => {
                this.showDeleteConfirmModal = false;
                this.selectedInfluencerId = null;
                this.loadData();
                this.alertMessage = 'Influenceur supprimé avec succès.';
                this.alertType = 'success';
            },
            error: (err) => {
                console.error(err);
                this.alertMessage = 'Erreur lors de la suppression.';
                this.alertType = 'error';
            }
        });
    }

    sendReport(id: number) {
        this.openActionMenuId = null;
        this.adminService.sendInfluencerReport(id).subscribe({
            next: () => {
                this.alertMessage = 'Rapport envoyé avec succès par email.';
                this.alertType = 'success';
                setTimeout(() => this.alertMessage = null, 5000);
            },
            error: (err) => {
                console.error(err);
                this.alertMessage = 'Erreur lors de l\'envoi du rapport.';
                this.alertType = 'error';
            }
        });
    }

    closeAlert() {
        this.alertMessage = null;
    }

    generateLink(id: number) {
        this.openActionMenuId = null;
        this.isLoading = true;
        this.adminService.generateInfluencerLink(id).subscribe({
            next: (res: any) => {
                this.loadData();
                this.alertMessage = 'Lien généré avec succès.';
                this.alertType = 'success';
                setTimeout(() => this.alertMessage = null, 5000);
            },
            error: (err) => {
                console.error(err);
                this.alertMessage = 'Erreur lors de la génération du lien.';
                this.alertType = 'error';
                this.isLoading = false;
            }
        });
    }

    sendAffiliateLink(id: number) {
        this.openActionMenuId = null;
        this.isLoading = true;
        this.adminService.sendInfluencerLink(id).subscribe({
            next: () => {
                this.isLoading = false;
                this.alertMessage = 'Lien d\'affiliation envoyé par email à l\'influenceur.';
                this.alertType = 'success';
                setTimeout(() => this.alertMessage = null, 5000);
            },
            error: (err) => {
                console.error(err);
                this.alertMessage = 'Erreur lors de l\'envoi du lien.';
                this.alertType = 'error';
                this.isLoading = false;
            }
        });
    }
}
