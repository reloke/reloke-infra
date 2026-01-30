import { Component, OnInit } from '@angular/core';
import { AdminService } from '../../../core/services/admin.service';

@Component({
    selector: 'app-admin-reports',
    templateUrl: './admin-reports.component.html',
    styleUrls: ['./admin-reports.component.scss']
})
export class AdminReportsComponent implements OnInit {
    reports: any[] = [];
    showArchived = false;
    loading = false;

    // Thread Modal
    showThreadModal = false;
    currentThread: any[] = [];
    currentChatId: number | null = null;

    // Ban Modal
    showBanModal = false;
    banStep = 1; // 1: Config, 2: Confirmation
    selectedReport: any = null;
    banReasonTitle = '';
    banReasonTemplate = 'Langage inapproprié';
    banAdminNote = '';

    banTemplates = [
        { label: 'Langage inapproprié', value: 'ban-inappropriate-language' },
        { label: 'Spam / Publicité', value: 'ban-spam' },
        { label: 'Harcèlement / Intimidation', value: 'ban-harassment' },
        { label: 'Contenu sexuellement explicite', value: 'ban-explicit-content' },
        { label: 'Autre violation', value: 'user-banned' }
    ];

    constructor(private adminService: AdminService) { }

    ngOnInit() {
        this.loadReports();
    }

    loadReports() {
        this.loading = true;
        this.adminService.getReports(this.showArchived).subscribe({
            next: (data) => {
                this.reports = data;
                this.loading = false;
            },
            error: (err) => {
                console.error('Error loading reports', err);
                this.loading = false;
            }
        });
    }

    toggleArchived() {
        this.showArchived = !this.showArchived;
        this.loadReports();
    }

    archiveReport(reportId: number) {
        this.adminService.archiveReport(reportId).subscribe(() => {
            this.loadReports();
        });
    }

    openThread(chatId: number) {
        this.currentChatId = chatId;
        this.adminService.getChatThread(chatId).subscribe(messages => {
            this.currentThread = messages;
            this.showThreadModal = true;
        });
    }

    openBanModal(report: any) {
        this.selectedReport = report;
        this.banReasonTitle = report.reason || 'Comportement inapproprié';
        this.banStep = 1;
        this.showBanModal = true;
    }

    confirmBan() {
        if (!this.selectedReport) return;

        const details = {
            reason: this.banReasonTemplate,
            customMessage: this.banAdminNote,
            template: this.banReasonTemplate
        };

        this.adminService.banUser(this.selectedReport.reportedUserId, details).subscribe({
            next: () => {
                // Automatically archive the report after banning
                this.adminService.archiveReport(this.selectedReport.id).subscribe(() => {
                    this.showBanModal = false;
                    this.selectedReport = null;
                    this.loadReports();
                });
            },
            error: (err) => {
                console.error('Error banning user', err);
            }
        });
    }

    // Image Helpers
    previewImageUrl: string | null = null;

    hasMedia(): boolean {
        return this.currentThread.some(m => m.type === 'IMAGE' || (m.type === 'FILE' && this.isImage(m.fileUrl)));
    }

    isImage(url: string | null): boolean {
        if (!url) return false;
        // Search for extension before any query parameters
        return url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i) != null;
    }

    openImage(url: string) {
        this.previewImageUrl = url;
    }
}
