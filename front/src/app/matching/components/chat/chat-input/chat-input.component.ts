import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { ChatService, Conversation, MessageType, Message, QuotaStatus } from '../../../../core/services/chat.service';
import { CameraService } from '../../../../core/services/camera.service';
import { ConnectivityService } from '../../../../core/services/connectivity.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
    selector: 'app-chat-input',
    templateUrl: './chat-input.component.html',
    styleUrls: ['./chat-input.component.scss']
})
export class ChatInputComponent implements OnDestroy, OnChanges {
    @ViewChild('videoElement') videoRef!: ElementRef<HTMLVideoElement>;
    @ViewChild('canvasElement') canvasRef!: ElementRef<HTMLCanvasElement>;
    @ViewChild('messageInput') messageInput!: ElementRef<HTMLTextAreaElement>;

    @Input() activeConversation: Conversation | null = null;
    @Input() currentUserId: number | null = null;
    @Input() quotaStatus: QuotaStatus | null = null;

    @Output() messageSent = new EventEmitter<void>();
    @Output() attachmentSent = new EventEmitter<any>();
    @Output() openConduct = new EventEmitter<void>();
    @Output() mailTemplateOpen = new EventEmitter<void>();

    @Input() replyingMessage: Message | null = null;
    @Input() editingMessage: Message | null = null;
    @Output() cancelReply = new EventEmitter<void>();
    @Output() cancelEdit = new EventEmitter<void>();

    newMessage = '';
    showAttachmentModal = false;
    showConductModal = false;
    showContactModal = false;
    showMobileMenu = false;

    // Contact gestionnaire form
    contactForm = {
        name: '',
        email: '',
        phone: '',
        targetUserId: null as number | null
    };
    contactFormErrors = {
        name: '',
        email: '',
        phone: ''
    };
    isSendingContact = false;

    // Mention state
    showMentionDropdown = false;
    mentionSearch = '';
    filteredParticipants: any[] = [];

    // Camera & File state
    isCameraActive = false;
    cameraError: string | null = null;
    private mediaStream: MediaStream | null = null;
    selectedFiles: File[] = [];
    filePreviews: string[] = [];

    isProcessing = false;
    isSending = false;
    isCaptured = false; // For flash effect

    private destroy$ = new Subject<void>();

    constructor(
        private chatService: ChatService,
        private cameraService: CameraService,
        public connectivityService: ConnectivityService
    ) { }

    ngOnDestroy() {
        this.stopCamera();
        this.destroy$.next();
        this.destroy$.complete();
        this.cleanupPreviews();
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['editingMessage'] && this.editingMessage) {
            this.newMessage = this.editingMessage.content;
            // Optionally focus the input
        }
    }

    onInput(event: any) {
        this.adjustTextareaHeight();
        const text = this.newMessage;
        const cursorPosition = event.target.selectionStart;
        const textBeforeCursor = text.substring(0, cursorPosition);
        const lastAtSign = textBeforeCursor.lastIndexOf('@');

        if (lastAtSign !== -1 && (lastAtSign === 0 || textBeforeCursor[lastAtSign - 1] === ' ')) {
            const search = textBeforeCursor.substring(lastAtSign + 1);
            if (!search.includes(' ')) {
                this.mentionSearch = search;
                this.showMentionDropdown = true;
                this.filterParticipants();
                return;
            }
        }
        this.showMentionDropdown = false;
    }

    adjustTextareaHeight() {
        if (!this.messageInput) return;
        const textarea = this.messageInput.nativeElement;

        // Reset height to auto/base to calculate scrollHeight correctly
        textarea.style.height = '44px';

        if (!this.newMessage || this.newMessage.trim() === '') {
            return;
        }

        const newHeight = Math.min(textarea.scrollHeight, 120);
        textarea.style.height = newHeight + 'px';
    }

    handleKeyDown(event: KeyboardEvent) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }
    }

    private filterParticipants() {
        if (!this.activeConversation) return;

        this.filteredParticipants = this.activeConversation.participants
            .map(p => p.user)
            .filter(u => u.id !== this.currentUserId)
            .filter(u => {
                const fullName = `${u.firstName} ${u.lastName}`.toLowerCase();
                return fullName.includes(this.mentionSearch.toLowerCase());
            });

        if (this.filteredParticipants.length === 0) {
            this.showMentionDropdown = false;
        }
    }

    selectMention(user: any) {
        const text = this.newMessage;
        const cursorPosition = this.newMessage.length; // Simplified
        const lastAtSign = text.lastIndexOf('@');
        const textBeforeAt = text.substring(0, lastAtSign);

        this.newMessage = `${textBeforeAt}@${user.firstName} ${user.lastName} `;
        this.showMentionDropdown = false;
        this.mentionSearch = '';
    }

    sendMessage() {
        if (!this.newMessage.trim() || !this.activeConversation) return;

        if (this.editingMessage) {
            this.chatService.editMessage(this.editingMessage.id, this.newMessage);
            this.cancelEdit.emit();
        } else {
            this.chatService.sendMessage(
                this.activeConversation.id,
                this.newMessage,
                MessageType.TEXT,
                this.activeConversation.matchGroupId,
                this.replyingMessage?.id
            );
            if (this.replyingMessage) this.cancelReply.emit();
        }

        this.newMessage = '';
        setTimeout(() => this.adjustTextareaHeight(), 0);
        this.showMentionDropdown = false;
        this.messageSent.emit();
    }

    openMailTemplate() {
        this.mailTemplateOpen.emit();
        this.showMobileMenu = false; // Close menu after action
    }

    toggleMobileMenu() {
        this.showMobileMenu = !this.showMobileMenu;
    }

    toggleConductModal() {
        this.showConductModal = !this.showConductModal;
        if (this.showConductModal) {
            this.openConduct.emit();
        }
    }

    toggleAttachmentModal() {
        this.showAttachmentModal = !this.showAttachmentModal;
        this.showMobileMenu = false; // Close menu
        if (this.showAttachmentModal) {
            document.body.classList.add('camera-active');
            this.startCamera();
        } else {
            document.body.classList.remove('camera-active');
            this.stopCamera();
            this.cleanupPreviews();
            this.selectedFiles = [];
            this.filePreviews = [];
            this.cameraError = null;
        }
    }

    async startCamera() {
        try {
            this.cameraError = null;
            this.mediaStream = await this.cameraService.startCamera();
            this.isCameraActive = true;
            setTimeout(() => {
                if (this.videoRef?.nativeElement && this.mediaStream) {
                    this.videoRef.nativeElement.srcObject = this.mediaStream;
                }
            }, 0);
        } catch (err) {
            this.cameraError = "Impossible d'accéder à la caméra.";
            console.error(err);
        }
    }

    stopCamera() {
        this.cameraService.stopCamera();
        this.mediaStream = null;
        this.isCameraActive = false;
    }

    async capturePhoto() {
        if (!this.videoRef?.nativeElement || !this.canvasRef?.nativeElement) return;

        this.isCaptured = true;
        setTimeout(() => this.isCaptured = false, 150);

        this.isProcessing = true;
        try {
            const blob = await this.cameraService.captureSnapshot(this.videoRef.nativeElement, this.canvasRef.nativeElement);
            if (blob) {
                const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
                this.selectedFiles.push(file);
                this.filePreviews.push(URL.createObjectURL(file));
            }
        } catch (err) {
            console.error('Capture failed:', err);
        } finally {
            this.isProcessing = false;
        }
    }

    removeSelectedFile(index: number) {
        const preview = this.filePreviews[index];
        if (preview.startsWith('blob:')) {
            URL.revokeObjectURL(preview);
        }
        this.selectedFiles.splice(index, 1);
        this.filePreviews.splice(index, 1);

        if (this.selectedFiles.length === 0) {
            this.startCamera();
        }
    }

    onFileSelected(event: any) {
        const files: FileList = event.target.files;
        if (!files) return;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.size > 10 * 1024 * 1024) {
                this.cameraError = "Un des fichiers est trop volumineux (Max 10MB)";
                continue;
            }
            if (!file.type.startsWith('image/') && !file.type.includes('pdf')) {
                this.cameraError = "Format non supporté.";
                continue;
            }
            this.selectedFiles.push(file);
            this.filePreviews.push(URL.createObjectURL(file));
        }

        if (this.selectedFiles.length > 0) {
            this.stopCamera();
        }
    }

    sendAttachment() {
        if (!this.activeConversation) return;

        if (this.isProcessing) {
            setTimeout(() => this.sendAttachment(), 100);
            return;
        }

        if (this.selectedFiles.length === 0) return;

        this.isSending = true;

        const formData = new FormData();
        formData.append('chatId', this.activeConversation.id.toString());
        this.selectedFiles.forEach(file => {
            formData.append('files', file);
        });

        this.chatService.uploadFilesDirect(formData)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
                next: (message) => {
                    this.isSending = false;
                    this.cleanupPreviews();
                    this.selectedFiles = [];
                    this.filePreviews = [];
                    this.toggleAttachmentModal();
                    this.attachmentSent.emit(message);
                },
                error: (err) => {
                    console.error('[ChatInputComponent] Error uploading attachments:', err);
                    this.isSending = false;
                    this.cameraError = "Erreur lors de l'envoi.";
                }
            });
    }

    private cleanupPreviews() {
        this.filePreviews.forEach(p => {
            if (p.startsWith('blob:')) URL.revokeObjectURL(p);
        });
    }

    // Contact Gestionnaire Methods
    toggleContactModal() {
        this.showContactModal = !this.showContactModal;
        this.showMobileMenu = false; // Close menu
        if (!this.showContactModal) {
            this.resetContactForm();
        }
    }

    resetContactForm() {
        this.contactForm = {
            name: '',
            email: '',
            phone: '',
            targetUserId: null
        };
        this.contactFormErrors = { name: '', email: '', phone: '' };
        this.isSendingContact = false;
    }

    validateContactForm(): boolean {
        let isValid = true;
        this.contactFormErrors = { name: '', email: '', phone: '' };

        if (!this.contactForm.name.trim()) {
            this.contactFormErrors.name = 'Le nom est requis';
            isValid = false;
        }

        const email = this.contactForm.email.trim();
        const phone = this.contactForm.phone.trim();

        if (!email && !phone) {
            this.contactFormErrors.email = 'Email ou téléphone requis';
            this.contactFormErrors.phone = 'Email ou téléphone requis';
            isValid = false;
        } else {
            // Validate Email if present
            if (email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    this.contactFormErrors.email = "Format d'email invalide";
                    isValid = false;
                }
            }

            // Validate Phone if present
            if (phone) {
                const phoneRegex = /^[\d\s+()-]{8,}$/;
                if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
                    this.contactFormErrors.phone = 'Format de téléphone invalide';
                    isValid = false;
                }
            }
        }

        return isValid;
    }

    getOtherParticipants(): any[] {
        if (!this.activeConversation) return [];
        return this.activeConversation.participants
            .filter(p => p.userId !== this.currentUserId)
            .map(p => p.user);
    }

    isTriangleChat(): boolean {
        return this.activeConversation?.type === 'TRIANGLE';
    }

    sendContactMessage() {
        if (!this.validateContactForm() || !this.activeConversation) return;

        // For triangle chats, targetUserId is required
        if (this.isTriangleChat() && !this.contactForm.targetUserId) {
            return;
        }

        this.isSendingContact = true;

        this.chatService.sendContactMessage(
            this.activeConversation.id,
            this.activeConversation.matchGroupId,
            {
                name: this.contactForm.name.trim(),
                email: this.contactForm.email.trim(),
                phone: this.contactForm.phone.trim(),
                targetUserId: this.contactForm.targetUserId
            }
        ).pipe(takeUntil(this.destroy$))
            .subscribe({
                next: () => {
                    this.isSendingContact = false;
                    this.toggleContactModal();
                    this.messageSent.emit();
                },
                error: (err) => {
                    console.error('[ChatInputComponent] Error sending contact:', err);
                    this.isSendingContact = false;
                }
            });
    }
}
