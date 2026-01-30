import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewChecked, HostListener } from '@angular/core';
import { Conversation, Message, ContactData, MessageType } from '../../../../core/services/chat.service';

@Component({
    selector: 'app-chat-messages-list',
    templateUrl: './chat-messages-list.component.html',
    styleUrls: ['./chat-messages-list.component.scss']
})
export class ChatMessagesListComponent {
    @ViewChild('scrollMe') private myScrollContainer!: ElementRef;

    @Input() groupedMessages: { date: string, messages: Message[] }[] = [];
    @Input() activeConversation: Conversation | null = null;
    @Input() currentUserId: number | null = null;
    @Input() hasBeenReported = false;
    @Input() isLoadingOlder = false;
    @Input() showScrollToBottom = false;
    @Input() messages: Message[] = []; // Used for empty state check

    @Output() scroll = new EventEmitter<Event>();
    @Output() scrollToBottomRequest = new EventEmitter<void>();
    @Output() imageClick = new EventEmitter<{ url: string, message: Message }>();
    @Output() reportBannerClick = new EventEmitter<void>();
    @Output() messageSelect = new EventEmitter<number>();
    @Output() reply = new EventEmitter<Message>();
    @Output() edit = new EventEmitter<Message>();
    @Output() delete = new EventEmitter<Message>();
    @Output() editContact = new EventEmitter<Message>();

    activeMenuMessageId: number | null = null;

    @Input() selectionMode = false;
    @Input() selectedMessageIds = new Set<number>();
    @Input() isMeBanned = false;


    revealedContactIds = new Set<number>();

    toggleContactDetails(msgId: number) {
        if (this.revealedContactIds.has(msgId)) {
            this.revealedContactIds.delete(msgId);
        } else {
            this.revealedContactIds.add(msgId);
        }
    }

    onScroll(event: Event) {
        this.scroll.emit(event);
    }

    toggleSelection(msgId: number) {
        const msg = this.messages.find(m => m.id === msgId);
        if (msg && this.isMe(msg)) {
            this.messageSelect.emit(msgId);
        }
    }

    scrollToBottom(smooth = false) {
        if (this.myScrollContainer) {
            const element = this.myScrollContainer.nativeElement;
            element.scrollTo({
                top: element.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto'
            });
        }
    }

    isAtBottom(): boolean {
        if (!this.myScrollContainer) return true; // Default to true if not initialized
        const element = this.myScrollContainer.nativeElement;
        return (element.scrollHeight - element.scrollTop - element.clientHeight) < 50;
    }

    isMe(msg: Message): boolean {
        return msg.senderId === this.currentUserId;
    }

    getMessageImageUrls(msg: Message): string[] {
        if (msg.images && msg.images.length > 0) {
            return msg.images.map(img => img.url);
        }
        return msg.fileUrl ? [msg.fileUrl] : [];
    }

    openImageFullscreen(url: string, msg: Message) {
        this.imageClick.emit({ url, message: msg });
    }

    formatMessage(content: string): string {
        if (!content) return '';
        // Regex to find @Name Name
        // We assume names can have spaces, but usually they are followed by another space or end of line
        // Finding @ followed by non-special chars until double space or certain punctuation might be hard
        // Let's assume the mention is @First Last (with space)

        // Simple regex for @ followed by characters until it hits something that's not a name character
        // Actually, since we control the injection we know it's @First Last 
        // Let's try to match @[A-Za-zÀ-ÖØ-öø-ÿ\s]+

        return content.replace(/@([a-zà-ÿ0-9]+(?:\s[a-zà-ÿ0-9]+)?)/gi, (match) => {
            return `<span class="mention-pill">${match}</span>`;
        });
    }

    trackByGroup(index: number, group: { date: string, messages: Message[] }): string {
        return group.date;
    }

    trackByMsgId(index: number, msg: Message): number {
        return msg.id;
    }

    toggleMessageMenu(event: Event, msgId: number) {
        event.stopPropagation();
        if (this.activeMenuMessageId === msgId) {
            this.activeMenuMessageId = null;
        } else {
            this.activeMenuMessageId = msgId;
        }
    }

    closeMenu() {
        this.activeMenuMessageId = null;
    }

    onReply(msg: Message) {
        this.reply.emit(msg);
        this.closeMenu();
    }

    onEdit(msg: Message) {
        this.edit.emit(msg);
        this.closeMenu();
    }

    onDelete(msg: Message) {
        this.delete.emit(msg);
        this.closeMenu();
    }

    // Listener for clicks outside the menu
    @HostListener('document:click')
    documentClick() {
        this.closeMenu();
    }

    // Contact message methods
    isContactMessage(msg: Message): boolean {
        return msg.type === MessageType.CONTACT;
    }

    openContactEditModal(msg: Message) {
        this.editContact.emit(msg);
        this.closeMenu();
    }

    getTargetUserName(msg: Message): string {
        if (msg.contactTargetUser) {
            return `${msg.contactTargetUser.firstName} ${msg.contactTargetUser.lastName}`;
        }
        return '';
    }
}
