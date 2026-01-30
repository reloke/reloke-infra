import { Component, Input, Output, EventEmitter, HostListener, ElementRef } from '@angular/core';
import { Conversation } from '../../../../core/services/chat.service';
import { AuthService } from '../../../../core/services/auth.service';

@Component({
    selector: 'app-chat-header',
    templateUrl: './chat-header.component.html',
    styleUrls: ['./chat-header.component.scss']
})
export class ChatHeaderComponent {
    @Input() activeConversation: Conversation | null = null;
    @Input() currentUserId: number | null = null;

    @Output() back = new EventEmitter<void>();
    @Output() toggleMatchInfo = new EventEmitter<void>();
    @Output() toggleCriteria = new EventEmitter<void>();
    @Output() viewMatchDetails = new EventEmitter<void>();
    @Output() toggleFiles = new EventEmitter<void>();
    @Output() startExitFlow = new EventEmitter<void>();
    @Output() toggleReport = new EventEmitter<void>();
    @Output() toggleSelection = new EventEmitter<void>();

    showActionMenu = false;

    constructor(
        private elementRef: ElementRef,
        private authService: AuthService
    ) { }

    get isDossierValid(): boolean {
        const user = this.authService.getCurrentUser();
        return user?.isDossierValid || !!user?.dossierFacileUrl;
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent) {
        if (!this.elementRef.nativeElement.contains(event.target)) {
            this.showActionMenu = false;
        }
    }

    getInitials(conv: Conversation | null): string {
        if (!conv) return '?';
        const others = this.getOtherParticipants(conv);
        if (others.length === 0) return '?';

        const first = others[0].user.firstName?.charAt(0) || '';
        const last = others[0].user.lastName?.charAt(0) || '';
        return (first + last).toUpperCase() || '?';
    }

    getOtherParticipants(conv: Conversation): any[] {
        return conv.participants.filter(p => p.userId !== this.currentUserId);
    }

    getConversationName(conv: Conversation | null): string {
        if (!conv) return '';
        const others = this.getOtherParticipants(conv);
        if (others.length === 0) return 'Utilisateur';

        return others.map(p => p.user.firstName).join(' & ');
    }

    toggleMenu() {
        this.showActionMenu = !this.showActionMenu;
    }

    closeMenu() {
        this.showActionMenu = false;
    }
}
