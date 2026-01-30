import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';

export type AlertType = 'success' | 'error' | 'warning' | 'info';

@Component({
    selector: 'app-alert',
    templateUrl: './alert.component.html',
})
export class AlertComponent implements OnInit, OnDestroy {
    @Input() type: AlertType = 'info';
    @Input() message: string = '';
    @Input() duration?: number;
    @Input() dismissible: boolean = true;

    @Output() closed = new EventEmitter<void>();

    private timeoutId: any;

    ngOnInit(): void {
        if (this.duration) {
            this.timeoutId = setTimeout(() => {
                this.close();
            }, this.duration);
        }
    }

    ngOnDestroy(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
        }
    }

    close(): void {
        this.closed.emit();
    }

    get containerClasses(): string {
        const baseClasses = 'm-4 p-4 rounded-xl text-sm flex flex-col gap-2 border animate-fade-in';
        const typeClasses = {
            success: 'bg-green-50 text-green-600 border-green-100',
            error: 'bg-red-50 text-red-600 border-red-100',
            warning: 'bg-orange-50 text-orange-600 border-orange-100',
            info: 'bg-blue-50 text-blue-600 border-blue-100'
        };
        return `${baseClasses} ${typeClasses[this.type]}`;
    }
}

// <div [class]="containerClasses">
//     <div class="flex items-center gap-3 w-full">
//         <!-- Icon -->
//         <div class="flex-shrink-0">
//             <!-- Success Icon -->
//             <svg *ngIf="type === 'success'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
//                 viewBox="0 0 24 24" stroke="currentColor">
//                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
//             </svg>
//             <!-- Error Icon -->
//             <svg *ngIf="type === 'error'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
//                 viewBox="0 0 24 24" stroke="currentColor">
//                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
//                     d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
//             </svg>
//             <!-- Warning Icon -->
//             <svg *ngIf="type === 'warning'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
//                 viewBox="0 0 24 24" stroke="currentColor">
//                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
//                     d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
//             </svg>
//             <!-- Info Icon -->
//             <svg *ngIf="type === 'info'" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
//                 viewBox="0 0 24 24" stroke="currentColor">
//                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
//                     d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
//             </svg>
//         </div>

//         <!-- Message -->
//         <span class="flex-grow">{{ message }}</span>

//         <!-- Dismiss Button -->
//         <button *ngIf="dismissible" (click)="close()" class="flex-shrink-0 hover:opacity-75 transition-opacity">
//             <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
//                 stroke="currentColor">
//                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
//             </svg>
//         </button>
//     </div>
// </div>
