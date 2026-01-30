import { Component, Input, Output, EventEmitter, HostBinding, OnInit, OnDestroy, HostListener } from '@angular/core';
import { Conversation, Message } from '../../../../core/services/chat.service';

@Component({
    selector: 'app-chat-sidebar',
    templateUrl: './chat-sidebar.component.html',
    styleUrls: ['./chat-sidebar.component.scss']
})
export class ChatSidebarComponent {
    @Input() conversations: Conversation[] = [];
    @Input() activeConversation: Conversation | null = null;
    @Input() isSidebarCollapsed = false;
    @Input() showMobileList = true;
    @Input() currentUserId: number | null = null;

    isMobile = false;

    constructor() {
        this.checkScreenSize();
    }

    @HostListener('window:resize', ['$event'])
    onResize(event: any) {
        this.checkScreenSize();
    }

    checkScreenSize() {
        this.isMobile = window.innerWidth < 768;
    }

    @Output() conversationSelected = new EventEmitter<Conversation>();
    @Output() sidebarToggled = new EventEmitter<void>();

    // Hide sidebar on mobile when a conversation is selected
    @HostBinding('class.hidden') get isHiddenOnMobile(): boolean {
        return !this.showMobileList;
    }

    // Apply collapsed class when sidebar is collapsed (desktop only)
    @HostBinding('class.collapsed') get isCollapsed(): boolean {
        return this.isSidebarCollapsed;
    }

    selectConversation(conv: Conversation) {
        this.conversationSelected.emit(conv);
    }

    toggleSidebar() {
        this.sidebarToggled.emit();
    }

    getInitials(conv: Conversation): string {
        const others = this.getOtherParticipants(conv);
        if (others.length === 0) return '?';

        const first = others[0].user.firstName?.charAt(0) || '';
        const last = others[0].user.lastName?.charAt(0) || '';
        return (first + last).toUpperCase() || '?';
    }

    getOtherParticipants(conv: Conversation): any[] {
        return conv.participants.filter(p => p.userId !== this.currentUserId);
    }

    getConversationName(conv: Conversation): string {
        const others = this.getOtherParticipants(conv);
        if (others.length === 0) return 'Utilisateur';

        return others.map(p => p.user.firstName).join(' & ');
    }

    getMessagePreview(conv: Conversation): string {
        if (!conv.messages || conv.messages.length === 0) return 'Démarrer la discussion';
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (lastMsg.type === 'IMAGE') return '📷 Image';
        if (lastMsg.type === 'FILE') return '📁 Fichier';
        return lastMsg.content || 'Démarrer la discussion';
    }

    trackByConvId(index: number, conv: Conversation): number {
        return conv.id;
    }
}
