import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable, Subject, catchError, of, retry, takeUntil, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CHAT_CONSTANTS } from './chat.constants';

export interface ChatUser {
    id: number;
    firstName: string;
    lastName: string;
    profilePicture: string | null;
}

export interface Participant {
    id: number;
    userId: number;
    user: ChatUser;
}

export enum MessageType {
    TEXT = 'TEXT',
    IMAGE = 'IMAGE',
    FILE = 'FILE',
    SYSTEM = 'SYSTEM',
    CONTACT = 'CONTACT'
}

export interface Message {
    id: number;
    chatId: number;
    senderId: number;
    content: string;
    type: MessageType;
    fileUrl?: string;
    fileType?: string;
    createdAt: Date;
    sender: ChatUser;
    images?: Array<{ id: number; url: string }>;
    replyToId?: number;
    replyTo?: Message;
    // Contact gestionnaire fields
    isEdited?: boolean;
    editedAt?: Date;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    contactTargetUserId?: number;
    contactTargetUser?: ChatUser;
    // Client-side pending state
    _pending?: boolean;
    _failed?: boolean;
}

interface PendingMessage {
    chatId: number;
    content: string;
    type: MessageType;
    matchGroupId?: string;
    replyToId?: number;
    timestamp: number;
}

export interface ContactData {
    name: string;
    email: string;
    phone: string;
    targetUserId?: number | null;
}

export interface Conversation {
    id: number;
    matchGroupId: string;
    type: 'STANDARD' | 'TRIANGLE';
    status: 'ACTIVE' | 'READ_ONLY' | 'CLOSED';
    createdAt: Date;
    lastMessageAt: Date | null;
    participants: Participant[];
    messages: Message[];
    unread?: boolean;
    unreadCount?: number;
}

export interface QuotaStatus {
    count: number;
    isBlocked: boolean;
    limit: number;
    chatId: number;
    isEstablished?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
    private socket: Socket | null = null;
    private destroy$ = new Subject<void>();

    // Pending message queue for offline resilience
    private pendingMessages: PendingMessage[] = [];
    private readonly PENDING_TIMEOUT_MS = 30_000;

    // Active room tracking for reconnection
    private _activeRoom: string | null = null;

    private messageSubject = new Subject<Message>();
    public messages$ = this.messageSubject.asObservable();

    private conversationsSubject = new BehaviorSubject<Conversation[]>([]);
    public conversations$ = this.conversationsSubject.asObservable();

    private connectionStatusSubject = new BehaviorSubject<boolean>(false);
    public isConnected$ = this.connectionStatusSubject.asObservable();

    private typingSubject = new Subject<{ chatId: number, userId: number, isTyping: boolean }>();
    public typing$ = this.typingSubject.asObservable();

    private reportSubject = new Subject<{ message: string }>();
    public userReported$ = this.reportSubject.asObservable();

    private notificationSubject = new Subject<any>();
    public notifications$ = this.notificationSubject.asObservable();

    private messagesDeletedSubject = new Subject<{ chatId: number, messageIds: number[] }>();
    public messagesDeleted$ = this.messagesDeletedSubject.asObservable();

    private messageUpdatedSubject = new Subject<Message>();
    public messageUpdated$ = this.messageUpdatedSubject.asObservable();

    private quotaUpdateSubject = new Subject<QuotaStatus>();
    public quotaUpdate$ = this.quotaUpdateSubject.asObservable();

    // Emits when a message send fails definitively
    private messageSendFailedSubject = new Subject<{ content: string; error: string }>();
    public messageSendFailed$ = this.messageSendFailedSubject.asObservable();

    private userBannedSubject = new Subject<{ userId: number }>();
    public userBanned$ = this.userBannedSubject.asObservable();

    constructor(private http: HttpClient) { }

    public connect(token?: string) {
        if (this.socket?.connected) return;

        this.socket = io(`${environment.apiUrl}/chat`, {
            auth: token ? { token } : undefined,
            withCredentials: true,
            reconnection: true,
            reconnectionAttempts: CHAT_CONSTANTS.RECONNECT_ATTEMPTS,
            reconnectionDelay: CHAT_CONSTANTS.RECONNECT_DELAY,
            transports: ['websocket', 'polling']
        });

        this.setupSocketListeners();
    }

    private setupSocketListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            this.connectionStatusSubject.next(true);
            this.flushPendingMessages();
            if (this._activeRoom) {
                this.socket?.emit('enterRoom', { roomName: this._activeRoom });
            }
        });
        this.socket.on('disconnect', () => this.connectionStatusSubject.next(false));

        this.socket.on('newMessage', (msg: Message) => this.messageSubject.next(msg));
        this.socket.on('userTyping', (data) => this.typingSubject.next(data));
        this.socket.on('userReported', (data) => this.reportSubject.next(data));
        this.socket.on('newNotification', (data) => this.notificationSubject.next(data));
        this.socket.on('messagesDeleted', (data) => this.messagesDeletedSubject.next(data));
        this.socket.on('messageUpdated', (msg: Message) => this.messageUpdatedSubject.next(msg));
        this.socket.on('quotaUpdate', (data: QuotaStatus) => this.quotaUpdateSubject.next(data));
        this.socket.on('userBanned', (data) => this.userBannedSubject.next(data));

        this.socket.on('connect_error', (err) => {
            console.error('[ChatService] Connection Error:', err);
            this.connectionStatusSubject.next(false);
        });
    }

    private flushPendingMessages() {
        if (this.pendingMessages.length === 0) return;
        const now = Date.now();
        const toSend: PendingMessage[] = [];
        const expired: PendingMessage[] = [];
        for (const msg of this.pendingMessages) {
            if (now - msg.timestamp > this.PENDING_TIMEOUT_MS) {
                expired.push(msg);
            } else {
                toSend.push(msg);
            }
        }
        this.pendingMessages = [];
        for (const msg of expired) {
            this.messageSendFailedSubject.next({ content: msg.content, error: 'Message non envoyé (délai dépassé)' });
        }
        for (const msg of toSend) {
            this.emitSendMessage(msg.chatId, msg.content, msg.type, msg.matchGroupId, msg.replyToId);
        }
    }

    private emitSendMessage(chatId: number, content: string, type: MessageType, matchGroupId?: string, replyToId?: number) {
        if (!this.socket?.connected) return;

        // Set up a 5-second timeout for ACK
        const ackTimeout = setTimeout(() => {
            this.messageSendFailedSubject.next({ content, error: '⚠ Non envoyé (timeout)' });
        }, 5000);

        this.socket.emit('sendMessage', { chatId, content, type, matchGroupId, replyToId }, (ack: any) => {
            clearTimeout(ackTimeout);

            if (ack?.event === 'error') {
                this.messageSendFailedSubject.next({ content, error: ack.data || 'Erreur serveur' });
            } else if (!ack?.success) {
                // If we received a response but it's not a success, treat as error
                this.messageSendFailedSubject.next({ content, error: 'Échec d\'envoi' });
            }
            // If ack.success is true, message was successfully received by server
        });
    }

    getConversations(): Observable<Conversation[]> {
        return this.http.get<Conversation[]>(`${environment.apiUrl}/chat/conversations`).pipe(
            retry(2),
            tap(convs => this.conversationsSubject.next(convs)),
            catchError(this.handleError('getConversations', []))
        );
    }

    getChatByMatchGroupId(matchGroupId: string): Observable<Conversation> {
        return this.http.get<Conversation>(`${environment.apiUrl}/chat/match-group/${matchGroupId}`).pipe(
            catchError(this.handleError<Conversation>('getChatByMatchGroupId'))
        );
    }

    getMessages(chatId: number, limit = CHAT_CONSTANTS.MESSAGES_PER_PAGE, cursor?: number): Observable<Message[]> {
        let params = new HttpParams().set('limit', limit.toString());
        if (cursor) params = params.set('cursor', cursor.toString());

        return this.http.get<Message[]>(`${environment.apiUrl}/chat/${chatId}/messages`, { params }).pipe(
            catchError(this.handleError('getMessages', []))
        );
    }

    getQuotaStatus(chatId: number): Observable<QuotaStatus> {
        return this.http.get<QuotaStatus>(`${environment.apiUrl}/chat/${chatId}/quota`).pipe(
            catchError(this.handleError<QuotaStatus>('getQuotaStatus'))
        );
    }

    sendMessage(chatId: number, content: string, type: MessageType = MessageType.TEXT, matchGroupId?: string, replyToId?: number) {
        if (this.socket?.connected) {
            this.emitSendMessage(chatId, content, type, matchGroupId, replyToId);
        } else {
            // Queue message for delivery on reconnect
            this.pendingMessages.push({ chatId, content, type, matchGroupId, replyToId, timestamp: Date.now() });
        }
    }

    markAsRead(chatId: number): Observable<any> {
        return this.http.post(`${environment.apiUrl}/chat/${chatId}/read`, {}).pipe(
            catchError(this.handleError('markAsRead'))
        );
    }

    deleteMessages(chatId: number, messageIds: number[]): Observable<any> {
        return this.http.post(`${environment.apiUrl}/chat/${chatId}/messages/delete`, { messageIds }).pipe(
            catchError(this.handleError('deleteMessages'))
        );
    }

    deleteImage(chatId: number, messageId: number, imageId: number): Observable<any> {
        return this.http.post(`${environment.apiUrl}/chat/${chatId}/messages/${messageId}/images/${imageId}/delete`, {}).pipe(
            catchError(this.handleError('deleteImage'))
        );
    }

    editMessage(messageId: number, content: string) {
        if (this.socket?.connected) {
            this.socket.emit('editMessage', { messageId, content });
        }
    }

    sendTyping(chatId: number, isTyping: boolean, matchGroupId?: string) {
        if (this.socket?.connected) {
            this.socket.emit('typing', { chatId, isTyping, matchGroupId });
        }
    }

    joinChat(chatId: number, matchGroupId?: string) {
        if (this.socket?.connected) {
            this.socket.emit('joinChat', { chatId, matchGroupId });
        }
    }

    enterRoom(roomName: string) {
        if (this.socket?.connected) {
            this.socket.emit('enterRoom', { roomName });
        }
    }

    leaveRoom() {
        if (this.socket?.connected && this._activeRoom) {
            this.socket.emit('leaveRoom', { roomName: this._activeRoom });
        }
    }

    uploadFilesDirect(formData: FormData): Observable<Message> {
        return this.http.post<Message>(`${environment.apiUrl}/chat/upload`, formData).pipe(
            catchError(this.handleError<Message>('uploadFilesDirect'))
        );
    }

    reportUser(chatId: number, reportedUserId: number, description: string): Observable<any> {
        return this.http.post(`${environment.apiUrl}/report`, { chatId, reportedUserId, description }).pipe(
            catchError(this.handleError('reportUser'))
        );
    }

    exitFlow(chatId: number): Observable<any> {
        return this.http.get(`${environment.apiUrl}/chat/${chatId}/exit-flow`).pipe(
            catchError(this.handleError('exitFlow'))
        );
    }

    getMatchGroupInfo(matchGroupId: string): Observable<any> {
        return this.http.get(`${environment.apiUrl}/chat/match-group/${matchGroupId}/info`).pipe(
            catchError(this.handleError('getMatchGroupInfo'))
        );
    }

    sendContactMessage(chatId: number, matchGroupId: string, contact: ContactData): Observable<Message> {
        return this.http.post<Message>(`${environment.apiUrl}/chat/${chatId}/contact`, {
            matchGroupId,
            contactName: contact.name,
            contactEmail: contact.email,
            contactPhone: contact.phone,
            contactTargetUserId: contact.targetUserId
        }).pipe(
            catchError(this.handleError<Message>('sendContactMessage'))
        );
    }

    updateContactMessage(chatId: number, messageId: number, contact: ContactData): Observable<Message> {
        return this.http.patch<Message>(`${environment.apiUrl}/chat/${chatId}/contact/${messageId}`, {
            contactName: contact.name,
            contactEmail: contact.email,
            contactPhone: contact.phone
        }).pipe(
            catchError(this.handleError<Message>('updateContactMessage'))
        );
    }

    getConversationContacts(chatId: number): Observable<Message[]> {
        return this.http.get<Message[]>(`${environment.apiUrl}/chat/${chatId}/contacts`).pipe(
            catchError(this.handleError('getConversationContacts', []))
        );
    }

    public getSocket(): Socket | null {
        return this.socket;
    }

    public disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.connectionStatusSubject.next(false);
        }
    }

    private handleError<T>(operation = 'operation', result?: T) {
        return (error: any): Observable<T> => {
            console.error(`${operation} failed:`, error);
            if (result === undefined) throw error;
            return of(result as T);
        };
    }

    ngOnDestroy() {
        this.socket?.disconnect();
        this.destroy$.next();
        this.destroy$.complete();
    }
}
