import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, HostListener, NgZone } from '@angular/core';
import { ChatService, Conversation, Message, MessageType, Participant, ContactData } from '../../../core/services/chat.service';
import { AuthService, User } from '../../../core/services/auth.service';
import { CHAT_CONSTANTS } from '../../../core/services/chat.constants';
import { Subject, takeUntil, map, BehaviorSubject, interval, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ActivatedRoute, Router } from '@angular/router';
import { MatchType } from '../../services/matching.service';
import { environment } from '../../../../environments/environment';
import { ConnectivityService } from '../../../core/services/connectivity.service';
import { FR } from '../../../core/i18n/fr';

import { ChatSidebarComponent } from './chat-sidebar/chat-sidebar.component';
import { ChatMessagesListComponent } from './chat-messages-list/chat-messages-list.component';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-chat',
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.scss']
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('scrollMe') private myScrollContainer!: ElementRef;
  @ViewChild(ChatMessagesListComponent) messageList!: ChatMessagesListComponent;

  conversations: Conversation[] = [];
  messages: Message[] = [];
  activeConversation: Conversation | null = null;
  currentUserId: number | null = null;

  // Modals state
  showReportModal = false;
  showConfirmationModal = false;
  selectedUserToReport: Participant | null = null;
  reportDescription = '';
  hasBeenReported = false;
  showReportBannerInfo = false;
  showMailTemplateModal = false;
  mailTemplateContent = '';
  isMailTemplateEditMode = false;
  showMailTemplateCloseConfirmation = false;
  showContactUpdateAlert = false;
  userDossierFacileUrl: string | null = null;
  isBanned = false;


  // Camera & File state
  showImagePreview = false;
  previewImageUrl = '';
  allImages: any[] = [];
  currentImageIndex = 0;

  isSidebarCollapsed = false;
  private readonly CHAT_SIDEBAR_STORAGE_KEY = 'chat_sidebar_collapsed';

  showFilesMenu = false;
  showConductModal = false;

  private destroy$ = new Subject<void>();

  // Pagination & Scroll
  isLoadingOlder = false;
  hasMoreMessages = true;
  showScrollToBottom = false;
  lastScrollTop = 0;

  // Grouped messages
  groupedMessages: { date: string, messages: Message[] }[] = [];

  // Action Menu
  showExitConfirmation = false;
  showMatchInfo = false;
  showCriteriaModal = false;
  matchGroupInfo: {
    type: string;
    matches: Array<{
      id: number;
      uid: string;
      status: string;
      seeker: { id: number; firstName: string; lastName: string; profilePicture: string | null };
      targetHome: {
        id: number;
        rent: number;
        surface: number;
        nbRooms: number;
        homeType: string;
        addressFormatted: string;
        images: Array<{ url: string }>;
      };
      seekerIntentId: number;
    }>;
  } | null = null;
  myMatch: any = null; // Still any but at least grouped matches are safer
  isLoadingMatchInfo = false;
  MatchType = MatchType;
  triangleVm: any = null;
  directMatchVm: any = null;
  common = FR.common;

  // Selection
  selectionMode = false;
  selectedMessageIds = new Set<number>();
  replyingMessage: Message | null = null;
  editingMessage: Message | null = null;
  editingContactMessage: Message | null = null;
  contactEditForm: ContactData = { name: '', email: '', phone: '' };
  contactMessages: Message[] = [];
  showDeleteMessageConfirmation = false;
  messageToDelete: Message | null = null;

  // Mobile navigation
  // Mobile navigation
  showMobileList = true;

  quotaStatus: any = null;

  get rejectedMatches(): any[] {
    if (!this.matchGroupInfo) return [];
    return this.matchGroupInfo.matches.filter((m: any) =>
      m.status === 'NOT_INTERESTED' && Number(m.seeker?.id) !== this.currentUserId
    );
  }


  constructor(
    private chatService: ChatService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private router: Router,
    private ngZone: NgZone,
    public connectivityService: ConnectivityService,
    private snackBar: MatSnackBar
  ) {
    const user = this.authService.getCurrentUser();
    this.currentUserId = user?.id || null;
    this.isBanned = user?.status === 'BANNED' || user?.isLocked === true;
    this.isSidebarCollapsed = localStorage.getItem(this.CHAT_SIDEBAR_STORAGE_KEY) === 'true';

    // Subscribe to user updates for dynamic ban status
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(u => {
        if (u) {
          this.currentUserId = u.id;
          this.isBanned = u.status === 'BANNED' || u.isLocked;
        }
      });

    console.log('[ChatComponent] Initialized with currentUserId:', this.currentUserId, 'isBanned:', this.isBanned);
  }

  ngOnInit() {
    document.body.classList.add('chat-page-active');
    this.chatService.connect();
    this.loadConversations();

    // Subscribe to real-time ban notifications
    this.chatService.userBanned$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.isBanned = true;
      });

    this.chatService.messages$
      .pipe(takeUntil(this.destroy$))
      .subscribe(msg => {
        console.log('[ChatComponent] Incoming message details:', {
          id: msg.id,
          chatId: msg.chatId,
          activeConvId: this.activeConversation?.id,
          type: msg.type,
          fileUrl: msg.fileUrl
        });

        this.ngZone.run(() => {
          if (this.activeConversation && Number(msg.chatId) === Number(this.activeConversation.id)) {
            console.log('[ChatComponent] Message matches active conversation. Appending inside zone...');

            // Avoid duplicates
            if (this.messages.some(m => m.id === msg.id)) {
              console.log('[ChatComponent] Message already exists, skipping.');
              return;
            }

            this.messages = [...this.messages, msg];
            this.groupMessages();

            if (msg.type === MessageType.CONTACT) {
              this.contactMessages = [msg, ...this.contactMessages];
            }

            if (this.checkIfAtBottom() || Number(msg.senderId) === Number(this.currentUserId)) {
              setTimeout(() => this.scrollToBottom(true), 50);
            } else {
              this.showScrollToBottom = true;
            }

            // Also mark as read in backend if it's from someone else
            if (Number(msg.senderId) !== Number(this.currentUserId)) {
              this.chatService.markAsRead(msg.chatId).subscribe();
            }
          } else {
            // Set unread for the conversation
            const conv = this.conversations.find(c => c.id === msg.chatId);
            if (conv) {
              // Deduplicate based on last message ID to avoid double-counting if event fires twice
              const lastKnownId = (conv.messages && conv.messages.length > 0) ? conv.messages[0].id : -1;
              if (lastKnownId !== msg.id) {
                conv.unread = true;
                conv.unreadCount = (conv.unreadCount || 0) + 1;
              }
            }
          }

          this.reorderConversations(msg);
        });
      });

    this.chatService.messageUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe(updatedMsg => {
        this.ngZone.run(() => {
          const index = this.messages.findIndex(m => m.id === updatedMsg.id);
          if (index !== -1) {
            this.messages[index] = updatedMsg;
            this.groupMessages();
          }

          if (updatedMsg.type === MessageType.CONTACT) {
            const contactIndex = this.contactMessages.findIndex(m => m.id === updatedMsg.id);
            if (contactIndex !== -1) {
              this.contactMessages[contactIndex] = updatedMsg;

              // Show alert to recipient if they are in the chat
              if (Number(updatedMsg.senderId) !== Number(this.currentUserId)) {
                this.showContactUpdateAlert = true;
              }
            } else {
              this.contactMessages = [updatedMsg, ...this.contactMessages];
            }
          }
        });
      });

    this.chatService.messagesDeleted$
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => {
        this.ngZone.run(() => {
          if (this.activeConversation && Number(data.chatId) === Number(this.activeConversation.id)) {
            this.messages = this.messages.filter(m => !data.messageIds.includes(m.id));
            this.groupMessages();
          }

          // Also update last message in conversation list if needed
          const conv = this.conversations.find(c => c.id === data.chatId);
          if (conv && conv.messages) {
            conv.messages = conv.messages.filter(m => !data.messageIds.includes(m.id));
          }
        });
      });

    this.chatService.quotaUpdate$
      .pipe(takeUntil(this.destroy$))
      .subscribe(quota => {
        this.ngZone.run(() => {
          if (this.activeConversation && Number(quota.chatId) === Number(this.activeConversation.id)) {
            this.quotaStatus = quota;
          }
        });
      });

    // Connectivity periodic check for diagnostics - Fixed with RxJS to avoid memory leaks
    interval(30000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const socket = this.chatService.getSocket();
        if (socket?.connected) {
          socket.emit('checkConnectivity', {}, (response: any) => {
            console.log('[ChatComponent] Connectivity diagnostic:', response);
          });
        }
      });

    this.chatService.userReported$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.hasBeenReported = true;
      });

    // Handle route params un-nested for better reliability
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const matchGroupId = params['matchGroupId'];
      if (matchGroupId) {
        this.handleMatchGroupNavigation(matchGroupId);
      } else {
        this.chatService.leaveRoom();
        this.activeConversation = null;
        this.messages = [];
        this.groupedMessages = [];
        this.showMobileList = true;
      }
    });

    // Handle reconnection logic
    this.connectivityService.isOnline$
      .pipe(takeUntil(this.destroy$))
      .subscribe(online => {
        if (online) {
          console.log('[ChatComponent] Back online, refreshing messages and conversations...');
          this.loadConversations();
          if (this.activeConversation) {
            this.loadMessages(this.activeConversation.id);
          }
        }
      });
  }

  private handleMatchGroupNavigation(matchGroupId: string) {
    const roomName = `chat_${matchGroupId}`;
    this.chatService.enterRoom(roomName);

    // If conversations are already loaded, try to find immediate match
    const targetConv = this.conversations.find(c => c.matchGroupId === matchGroupId);

    if (targetConv) {
      this.setupActiveConversation(targetConv);
    } else {
      // Fetch it specifically if not found in list (or list still loading)
      this.chatService.getChatByMatchGroupId(matchGroupId).subscribe({
        next: (c) => {
          this.setupActiveConversation(c);
          // Add to local list if it's missing
          if (!this.conversations.find(conv => conv.id === c.id)) {
            this.conversations.unshift(c);
          }
        },
        error: () => {
          this.router.navigate(['/matching/chat']);
        }
      });
    }
  }

  private setupActiveConversation(conv: Conversation) {
    this.activeConversation = conv;
    this.activeConversation.unread = false;
    this.messages = [];
    this.groupedMessages = [];
    this.hasMoreMessages = true;
    this.showMobileList = false;
    this.matchGroupInfo = null;
    this.myMatch = null;
    this.chatService.joinChat(conv.id, conv.matchGroupId);
    this.loadMessages(conv.id);

    this.chatService.getMatchGroupInfo(conv.matchGroupId).subscribe(info => {
      this.matchGroupInfo = info;
      this.updateMyMatch();
      this.buildTriangleVm();
      this.buildDirectMatchVm();
    });

    // Mark as read
    this.chatService.markAsRead(conv.id).subscribe(() => {
      conv.unreadCount = 0;
      conv.unread = false;
    });

    this.chatService.getQuotaStatus(conv.id).subscribe(quota => {
      this.quotaStatus = quota;
    });

    this.loadConversationContacts(conv.id);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.chatService.disconnect();
    document.body.classList.remove('chat-page-active');
    document.body.classList.remove('image-viewer-active');
    document.body.classList.remove('camera-active');
  }


  loadConversations() {
    this.chatService.getConversations().subscribe(convs => {
      // Sort client-side to ensure active chats (latest message) appear at the top
      this.conversations = convs.sort((a, b) => {
        const timeA = new Date(a.lastMessageAt || a.createdAt).getTime();
        const timeB = new Date(b.lastMessageAt || b.createdAt).getTime();
        return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
      });
      console.log('[ChatComponent] Client-side sorted:', this.conversations.map(c => ({ id: c.id, time: c.lastMessageAt || c.createdAt })));

      // After loading conversations, if we have an active matchGroupId, 
      // we might need to refresh the activeConversation object to match the one in the list
      const currentId = this.route.snapshot.params['matchGroupId'];
      if (currentId) {
        const matching = convs.find(c => c.matchGroupId === currentId);
        if (matching) {
          this.activeConversation = matching;
        }
      }
    });
  }

  selectConversation(conv: Conversation) {
    this.router.navigate(['/matching/chat', conv.matchGroupId]);
  }

  backToConversations() {
    this.showMobileList = true;
    this.router.navigate(['/matching/chat']);
  }

  getMessagePreview(conv: Conversation): string {
    if (!conv.messages || conv.messages.length === 0) return 'Nouveau match !';
    const lastMsg = conv.messages[conv.messages.length - 1];

    if (lastMsg.images && lastMsg.images.length > 0) {
      return '📸 Photo';
    }
    if (lastMsg.type === 'IMAGE' || lastMsg.fileUrl) {
      return (lastMsg.type === 'IMAGE' || lastMsg.fileType?.startsWith('image/')) ? '📸 Photo' : '📎 Fichier';
    }

    return lastMsg.content;
  }

  loadMessages(chatId: number, cursor?: number) {
    if (this.isLoadingOlder) return;
    this.isLoadingOlder = true;

    this.chatService.getMessages(chatId, 30, cursor).subscribe({
      next: (newMessages) => {
        if (newMessages.length < 30) {
          this.hasMoreMessages = false;
        }

        if (cursor) {
          // Loading older: prepend
          this.messages = [...newMessages.reverse(), ...this.messages];
        } else {
          // Initial load
          this.messages = newMessages.reverse();
          setTimeout(() => this.scrollToBottom(), 100);
        }

        this.groupMessages();
        this.isLoadingOlder = false;
      },
      error: () => {
        this.isLoadingOlder = false;
      }
    });
  }

  onScroll(event: any) {
    const element = event.target;
    const atTop = element.scrollTop <= 10;

    // Show/hide scroll to bottom button
    const threshold = 300;
    this.showScrollToBottom = (element.scrollHeight - element.scrollTop - element.clientHeight) > threshold;

    if (atTop && this.hasMoreMessages && !this.isLoadingOlder && this.messages.length > 0) {
      const oldestId = this.messages[0].id;
      const prevHeight = element.scrollHeight;

      this.isLoadingOlder = true;
      this.chatService.getMessages(this.activeConversation!.id, 30, oldestId).subscribe({
        next: (newMessages) => {
          if (newMessages.length < 30) {
            this.hasMoreMessages = false;
          }

          this.messages = [...newMessages.reverse(), ...this.messages];
          this.groupMessages();
          this.isLoadingOlder = false;

          // Preserve scroll position
          setTimeout(() => {
            const newHeight = element.scrollHeight;
            element.scrollTop = newHeight - prevHeight;
          }, 0);
        },
        error: () => {
          this.isLoadingOlder = false;
        }
      });
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (!this.showImagePreview) return;

    if (event.key === 'ArrowRight') {
      this.nextImage();
    } else if (event.key === 'ArrowLeft') {
      this.prevImage();
    } else if (event.key === 'Escape') {
      this.closeImagePreview();
    }
  }

  private groupMessages() {
    // Force chronological ascending order (oldest first)
    this.messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const groups: { date: string, messages: Message[] }[] = [];

    this.messages.forEach(msg => {
      const date = new Date(msg.createdAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      const label = this.getDateLabel(date);
      let group = groups.find(g => g.date === label);
      if (!group) {
        group = { date: label, messages: [] };
        groups.push(group);
      }
      group.messages.push(msg);
    });

    this.groupedMessages = groups;
  }

  private getDateLabel(dateStr: string): string {
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

    if (dateStr === today) return "Aujourd'hui";
    if (dateStr === yesterdayStr) return "Hier";
    return dateStr;
  }

  private checkIfAtBottom(): boolean {
    if (this.messageList) {
      return this.messageList.isAtBottom();
    }
    return false;
  }

  trackByMsgId(index: number, msg: Message) {
    return msg.id;
  }

  trackByConvId(index: number, conv: Conversation) {
    return conv.id;
  }

  trackByGroup(index: number, group: any) {
    return group.date;
  }

  // Action Menu Handlers
  confirmExitFlow() {
    if (!this.activeConversation) return;

    this.chatService.exitFlow(this.activeConversation.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.showExitConfirmation = false;
        },
        error: (err) => {
          console.error('Error exiting flow:', err);
          this.showExitConfirmation = false;
        }
      });
  }

  viewCGU() {
    window.open('/legal/terms-and-conditions', '_blank');
  }

  toggleReportModal() {
    if (this.isBanned) return;
    this.showReportModal = !this.showReportModal;
    if (!this.showReportModal) {
      this.selectedUserToReport = null;
      this.reportDescription = '';
    }
  }

  getParticipantsToReport() {
    if (!this.activeConversation) return [];
    return this.activeConversation.participants.filter(p => p.userId !== this.currentUserId);
  }

  confirmReport() {
    if (!this.selectedUserToReport || !this.activeConversation) return;

    this.chatService.reportUser(
      this.activeConversation.id,
      this.selectedUserToReport.userId,
      this.reportDescription
    ).pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showConfirmationModal = false;
          this.selectedUserToReport = null;
          this.reportDescription = '';
          this.showReportModal = false;
          this.snackBar.open('Votre signalement a bien été pris en compte.', 'Fermer', {
            duration: 4000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: ['success-snackbar']
          });
        },
        error: (err) => {
          console.error('Error reporting user:', err);
          this.showConfirmationModal = false;
        }
      });
  }

  scrollToBottom(smooth = false): void {
    if (this.messageList) {
      this.messageList.scrollToBottom(smooth);
    }
  }

  onAttachmentSent(message: Message) {
    if (!this.messages.find(m => m.id === message.id)) {
      this.messages = [...this.messages, message];
      this.groupMessages();
      setTimeout(() => this.scrollToBottom(true), 100);
    }
  }

  getMessageImageUrls(msg: Message): string[] {
    if (msg.images && msg.images.length > 0) {
      return msg.images.map(img => img.url);
    }
    return msg.fileUrl ? [msg.fileUrl] : [];
  }

  getImageUrl(url: string): string {
    if (!url) return 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
    return url;
  }

  getHomeImageUrls(home: any): string[] {
    if (!home?.images) return [];
    return home.images.map((img: any) => img.url);
  }

  openImageFullscreen(url: string, context?: Message | string[]) {
    document.body.classList.add('image-viewer-active');

    // Build image list with metadata
    this.allImages = [];

    if (context && Array.isArray(context)) {
      // It's a list of URLs (e.g. from home images)
      context.forEach(imgUrl => {
        this.allImages.push({
          url: imgUrl,
          isMine: false,
          messageId: null
        });
      });
    } else if (context) {
      // It's a Message object
      const msg = context as Message;
      if (msg.images && msg.images.length > 0) {
        msg.images.forEach(img => {
          this.allImages.push({
            url: img.url,
            messageId: msg.id,
            imageId: img.id,
            isMine: msg.senderId === this.currentUserId
          });
        });
      } else if (msg.fileUrl) {
        this.allImages.push({
          url: msg.fileUrl,
          messageId: msg.id,
          isMine: msg.senderId === this.currentUserId
        });
      }
    } else {
      // Fallback: build from all messages (e.g. from gallery if no direct msg provided)
      this.messages.forEach(m => {
        if (m.images && m.images.length > 0) {
          m.images.forEach(img => {
            this.allImages.push({
              url: img.url,
              messageId: m.id,
              imageId: img.id,
              isMine: m.senderId === this.currentUserId
            });
          });
        } else if ((m.type === 'IMAGE' || m.fileType?.startsWith('image/')) && m.fileUrl) {
          this.allImages.push({
            url: m.fileUrl,
            messageId: m.id,
            isMine: m.senderId === this.currentUserId
          });
        }
      });
    }

    this.currentImageIndex = this.allImages.findIndex(img => img.url === url);
    if (this.currentImageIndex === -1 && url) {
      this.allImages.push({ url, isMine: false, messageId: -1 });
      this.currentImageIndex = this.allImages.length - 1;
    }

    this.previewImageUrl = url;
    this.showImagePreview = true;
  }

  deleteCurrentImage(event: Event) {
    event.stopPropagation();
    const currentImg = this.allImages[this.currentImageIndex];
    if (!currentImg || !currentImg.isMine || !currentImg.messageId || !this.activeConversation) return;

    if (currentImg.imageId) {
      // It's a group image
      this.chatService.deleteImage(this.activeConversation.id, currentImg.messageId, currentImg.imageId).subscribe({
        next: (res) => {
          // If message was deleted entirely, it will come via WebSocket (messagesDeleted)
          // If it was just updated, it will come via WebSocket (messageUpdated)

          // Optimistic UI: remove from local allImages
          this.allImages.splice(this.currentImageIndex, 1);
          if (this.allImages.length === 0) {
            this.closeImagePreview();
          } else {
            this.currentImageIndex = this.currentImageIndex % this.allImages.length;
            this.previewImageUrl = this.allImages[this.currentImageIndex].url;
          }
        }
      });
    } else {
      // It's a single image message, delete the whole message
      if (confirm('Voulez-vous supprimer ce message ?')) {
        this.chatService.deleteMessages(this.activeConversation.id, [currentImg.messageId]).subscribe({
          next: () => {
            this.allImages.splice(this.currentImageIndex, 1);
            if (this.allImages.length === 0) {
              this.closeImagePreview();
            } else {
              this.currentImageIndex = this.currentImageIndex % this.allImages.length;
              this.previewImageUrl = this.allImages[this.currentImageIndex].url;
            }
          }
        });
      }
    }
  }

  nextImage(event?: Event) {
    if (event) event.stopPropagation();
    if (this.allImages.length === 0) return;
    this.currentImageIndex = (this.currentImageIndex + 1) % this.allImages.length;
    this.previewImageUrl = this.allImages[this.currentImageIndex].url;
  }

  prevImage(event?: Event) {
    if (event) event.stopPropagation();
    if (this.allImages.length === 0) return;
    this.currentImageIndex = (this.currentImageIndex - 1 + this.allImages.length) % this.allImages.length;
    this.previewImageUrl = this.allImages[this.currentImageIndex].url;
  }

  closeImagePreview() {
    document.body.classList.remove('image-viewer-active');
    this.showImagePreview = false;
    this.previewImageUrl = '';
    this.allImages = [];
  }

  generateMailTemplate() {
    if (!this.activeConversation) return;

    const me = this.authService.getCurrentUser();
    const others = this.activeConversation.participants.filter(p => p.userId !== this.currentUserId);

    // Store DossierFacile URL from user with normalization
    let dfUrl = (me as any)?.dossierFacileUrl || null;
    if (dfUrl && !dfUrl.startsWith('http')) {
      dfUrl = 'https://' + dfUrl;
    }
    this.userDossierFacileUrl = dfUrl;

    // In our context, the "Target" is the one whose house we want.
    const targetName = others[0]?.user.firstName + ' ' + others[0]?.user.lastName;
    let houseInfo = "votre logement";

    if (this.matchGroupInfo) {
      // Try to find the match where I am the seeker (direct)
      const myMatch = this.matchGroupInfo.matches.find(m => m.seeker.id === this.currentUserId);
      if (myMatch) {
        houseInfo = `${myMatch.targetHome.homeType} de ${myMatch.targetHome.surface}m² situé à ${myMatch.targetHome.addressFormatted}`;
      }
    }

    // Custom polite formula if manager contact exists
    let politeFormula = 'Bonjour,';
    if (this.contactMessages && this.contactMessages.length > 0) {
      // Use the first contact name if available
      const contact = this.contactMessages[0];
      if (contact.contactName) {
        politeFormula = `À l'attention de M/Mme ${contact.contactName},\n\nBonjour,`;
      }
    }

    this.mailTemplateContent = `${politeFormula}\n\nJe m'appelle ${me?.firstName} ${me?.lastName}, membre de la communauté Reloke. Je me permets de vous contacter concernant le logement situé à [ADRESSE PRÉCISE] (libéré par ${targetName}), qui se libère prochainement.\n\nMon dossier est prêt et validé par Reloke. Voici quelques informations me concernant pour une première étude :\n- Nom de l'employeur : [NOM DE VOTRE EMPLOYEUR]\n- Revenus nets mensuels : [REVENUS NETS] €\n- Situation professionnelle : [VOTRE SITUATION - ex: CDI, Fonctionnaire]\n\nJe reste à votre entière disposition pour vous transmettre mon dossier complet via Reloke ou convenir d'une visite.\n\nBien cordialement,\n${me?.firstName} ${me?.lastName}`;

    this.isMailTemplateEditMode = false;
    this.showMailTemplateModal = true;
  }

  toggleMailTemplateEditMode() {
    this.isMailTemplateEditMode = !this.isMailTemplateEditMode;
  }

  copyMailTemplate() {
    navigator.clipboard.writeText(this.mailTemplateContent).then(() => {
      this.snackBar.open('Copié dans le presse-papier !', 'Fermer', {
        duration: 3000,
        panelClass: ['custom-snackbar-action-success']
      });
      this.showMailTemplateModal = false;
    });
  }

  toggleFilesMenu() {
    this.showFilesMenu = !this.showFilesMenu;
  }

  toggleConductModal() {
    this.showConductModal = !this.showConductModal;
  }

  getChatFiles() {
    const allMedia: any[] = [];

    this.messages.forEach(m => {
      // 1. Un seul fichier ou une seule image (fileUrl direct)
      if (m.fileUrl && (!m.images || m.images.length === 0)) {
        allMedia.push({
          id: m.id,
          url: m.fileUrl,
          content: m.type === 'IMAGE' ? 'Photo' : (m.content || 'Fichier'),
          createdAt: m.createdAt,
          type: m.type,
          fileType: m.fileType,
          message: m
        });
      }

      // 2. Plusieurs images envoyées ensemble
      if (m.images && m.images.length > 0) {
        m.images.forEach((img, idx) => {
          allMedia.push({
            id: `${m.id}_img_${idx}`,
            url: img.url,
            content: `Photo ${idx + 1}`,
            createdAt: m.createdAt,
            type: 'IMAGE',
            fileType: 'image/jpeg',
            message: m
          });
        });
      }
    });

    // Tri par date décroissante pour voir les plus récents en premier
    return allMedia.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  toggleSidebar() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
    localStorage.setItem(this.CHAT_SIDEBAR_STORAGE_KEY, String(this.isSidebarCollapsed));
  }

  toggleMatchInfo() {
    this.showMatchInfo = !this.showMatchInfo;
    if (this.showMatchInfo && this.activeConversation?.matchGroupId) {
      if (this.matchGroupInfo) {
        this.updateMyMatch();
        this.buildTriangleVm();
        this.buildDirectMatchVm();
        return;
      }
      this.isLoadingMatchInfo = true;
      this.chatService.getMatchGroupInfo(this.activeConversation.matchGroupId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (info) => {
            this.matchGroupInfo = info;
            this.updateMyMatch();
            this.buildTriangleVm();
            this.buildDirectMatchVm();
            this.isLoadingMatchInfo = false;
          },
          error: () => {
            this.isLoadingMatchInfo = false;
          }
        });
    }
  }

  private buildDirectMatchVm() {
    if (!this.activeConversation || this.activeConversation.type === 'TRIANGLE') {
      this.directMatchVm = null;
      return;
    }

    const participants = this.activeConversation.participants;
    if (!participants || participants.length === 0) {
      this.directMatchVm = null;
      return;
    }

    const other = participants.find(p => p.userId !== this.currentUserId);
    if (!other) {
      this.directMatchVm = null;
      return;
    }

    this.directMatchVm = {
      firstName: other.user.firstName,
      initial: other.user.firstName.charAt(0).toUpperCase()
    };
  }

  private buildTriangleVm() {
    if (!this.activeConversation || this.activeConversation.type !== 'TRIANGLE' || !this.matchGroupInfo) {
      this.triangleVm = null;
      return;
    }

    const matches = this.matchGroupInfo.matches;
    if (matches.length !== 3) {
      this.triangleVm = null;
      return;
    }

    // Chain: A -> B -> C -> A
    // Match A: seeker=A, target=B (house B owns)
    // Match B: seeker=B, target=C (house C owns)
    // Match C: seeker=C, target=A (house A owns)

    // Let's use a robust approach:
    // 1. Identify A (You)
    // 2. Identify B (The one whose house You want)
    // 3. Identify C (The one who wants Your house)

    if (this.myMatch && this.myMatch.snapshot && this.myMatch.snapshot.participants) {
      const snapshot = this.myMatch.snapshot;
      const pA = snapshot.participants.A;
      const pB = snapshot.participants.B;
      const pC = snapshot.participants.C;

      const all = [pA, pB, pC];
      const seekerIntentId = this.myMatch.seekerIntentId;
      const targetIntentId = this.myMatch.targetIntentId;

      const youP = all.find((p: any) => p.intentId === seekerIntentId);
      const targetP = all.find((p: any) => p.intentId === targetIntentId);
      const thirdP = all.find((p: any) => p.intentId !== seekerIntentId && p.intentId !== targetIntentId);

      if (youP && targetP && thirdP) {
        const targetFullName = `${targetP.firstName || ''} ${targetP.lastName?.charAt(0) || ''}.`.trim() || 'Participant';
        const thirdFullName = `${thirdP.firstName || ''} ${thirdP.lastName?.charAt(0) || ''}.`.trim() || 'Participant';

        this.triangleVm = {
          you: { name: 'Vous', initials: 'V' },
          target: {
            name: targetFullName,
            initials: this.getInitials(targetP.firstName || 'T'),
          },
          third: {
            name: thirdFullName,
            initials: this.getInitials(thirdP.firstName || 'C'),
          },
          instructions: {
            step1: `Vous visez le logement de ${targetFullName}. Contactez ${targetFullName} pour obtenir les coordonnées de son propriétaire/bailleur et envoyer votre dossier.`,
            step2: `${targetFullName} vise le logement de ${thirdFullName}. ${thirdFullName} transmettra les coordonnées de son bailleur à ${targetFullName}.`,
            step3: `${thirdFullName} vise votre logement. Vous transmettrez les coordonnées de votre propriétaire/bailleur à ${thirdFullName}.`,
          },
        };
        return;
      }
    }

    // Fallback if no snapshot: just use participants from activeConversation
    const participants = this.activeConversation.participants;
    const others = participants.filter(p => p.userId !== this.currentUserId);

    if (others.length >= 2) {
      const p1 = others[0];
      const p2 = others[1];

      const p1Name = `${p1.user.firstName} ${p1.user.lastName.charAt(0)}.`;
      const p2Name = `${p2.user.firstName} ${p2.user.lastName.charAt(0)}.`;

      this.triangleVm = {
        you: { name: 'Vous', initials: 'V' },
        target: { name: p1Name, initials: this.getInitials(p1.user.firstName) },
        third: { name: p2Name, initials: this.getInitials(p2.user.firstName) },
        instructions: {
          step1: `Vous visez le logement de ${p1Name}. Contactez-le pour avancer sur votre dossier.`,
          step2: `L'échange se poursuit avec ${p2Name} dans la chaîne.`,
          step3: `${p2Name} vise votre logement. Restez disponible pour l'aider.`,
        }
      };
    }
  }

  private getInitials(name: string): string {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  }

  goToMatchDetails() {
    if (!this.activeConversation?.matchGroupId) {
      console.warn('No matchGroupId for this conversation');
      return;
    }

    const navigateToMatch = (info: any) => {
      this.matchGroupInfo = info;
      this.updateMyMatch();

      if (this.myMatch) {
        this.router.navigate(['/matches', this.myMatch.uid]);
      } else {
        console.error('Could not find participant match in group', info);
      }
    };

    if (this.matchGroupInfo) {
      navigateToMatch(this.matchGroupInfo);
      return;
    }

    this.isLoadingMatchInfo = true;
    this.chatService.getMatchGroupInfo(this.activeConversation.matchGroupId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (info) => {
          this.isLoadingMatchInfo = false;
          navigateToMatch(info);
        },
        error: (err) => {
          this.isLoadingMatchInfo = false;
          console.error('Error fetching match group info:', err);
        }
      });
  }

  toggleCriteriaModal() {
    this.showCriteriaModal = !this.showCriteriaModal;
    if (this.showCriteriaModal && this.activeConversation?.matchGroupId) {
      if (this.matchGroupInfo) {
        this.updateMyMatch();
      } else {
        this.isLoadingMatchInfo = true;
        this.chatService.getMatchGroupInfo(this.activeConversation.matchGroupId).subscribe({
          next: (info) => {
            this.matchGroupInfo = info;
            this.updateMyMatch();
            this.isLoadingMatchInfo = false;
          },
          error: () => {
            this.isLoadingMatchInfo = false;
          }
        });
      }
    }
  }

  private updateMyMatch() {
    if (!this.matchGroupInfo) return;
    const currentUser = this.authService.getCurrentUser();
    if (!currentUser) return;

    const currentUserId = Number(currentUser.id);
    this.myMatch = this.matchGroupInfo.matches.find((m: any) => Number(m.seeker?.id) === currentUserId);
  }

  private reorderConversations(msg: Message) {
    const index = this.conversations.findIndex(c => c.id === msg.chatId);
    if (index !== -1) {
      const conv = this.conversations[index];

      // Update last message logic and ensure it is an array
      conv.messages = [msg];
      // Update timestamp for sidebar sort
      conv.lastMessageAt = msg.createdAt;

      this.conversations.splice(index, 1);
      this.conversations.unshift(conv);

      // Force reference update to trigger change detection in child components (Sidebar)
      this.conversations = [...this.conversations];
    }
  }

  toggleSelectionMode() {
    if (this.isBanned) return;
    this.selectionMode = !this.selectionMode;
    if (!this.selectionMode) {
      this.selectedMessageIds.clear();
    }
  }

  onMessageSelect(msgId: number) {
    if (this.selectedMessageIds.has(msgId)) {
      this.selectedMessageIds.delete(msgId);
    } else {
      this.selectedMessageIds.add(msgId);
    }
  }

  deleteSelectedMessages() {
    if (this.selectedMessageIds.size === 0 || !this.activeConversation) return;

    const ids = Array.from(this.selectedMessageIds);
    this.chatService.deleteMessages(this.activeConversation.id, ids).subscribe({
      next: () => {
        this.toggleSelectionMode();
      },
      error: (err) => {
        console.error('Error deleting messages:', err);
      }
    });
  }

  onReply(msg: Message) {
    this.replyingMessage = msg;
    this.editingMessage = null;
  }

  onEdit(msg: Message) {
    this.editingMessage = msg;
    this.replyingMessage = null;
  }

  onDelete(msg: Message) {
    this.messageToDelete = msg;
    this.showDeleteMessageConfirmation = true;
  }

  confirmDeleteMessage() {
    if (!this.messageToDelete) return;
    this.chatService.deleteMessages(this.messageToDelete.chatId, [this.messageToDelete.id]).subscribe();
    this.showDeleteMessageConfirmation = false;
    this.messageToDelete = null;
  }

  cancelReply() {
    this.replyingMessage = null;
  }

  cancelEdit() {
    this.editingMessage = null;
  }

  onEditContactMessage(msg: Message) {
    if (this.isBanned || Number(msg.senderId) !== Number(this.currentUserId)) return;

    this.editingContactMessage = msg;
    this.contactEditForm = {
      name: msg.contactName || '',
      email: msg.contactEmail || '',
      phone: msg.contactPhone || ''
    };
  }

  closeContactEditModal() {
    this.editingContactMessage = null;
    this.contactEditForm = { name: '', email: '', phone: '' };
  }

  saveContactEdit() {
    const hasName = !!this.contactEditForm.name?.trim();
    const hasContact = !!(this.contactEditForm.email?.trim() || this.contactEditForm.phone?.trim());

    if (this.editingContactMessage && hasName && hasContact) {
      this.chatService.updateContactMessage(this.editingContactMessage.chatId, this.editingContactMessage.id, this.contactEditForm)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.closeContactEditModal();
          },
          error: (err) => {
            console.error('Error updating contact:', err);
          }
        });
    }
  }

  closeMailTemplateModal(force = false) {
    if (!force && this.isMailTemplateEditMode) {
      this.showMailTemplateCloseConfirmation = true;
      return;
    }
    this.showMailTemplateModal = false;
    this.showMailTemplateCloseConfirmation = false;
    this.isMailTemplateEditMode = false;
  }

  loadConversationContacts(chatId: number) {
    this.chatService.getConversationContacts(chatId).subscribe(contacts => {
      this.contactMessages = contacts;
    });
  }
}

