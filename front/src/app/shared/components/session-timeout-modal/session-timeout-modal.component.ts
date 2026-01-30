import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-session-timeout-modal',
    templateUrl: './session-timeout-modal.component.html'
})
export class SessionTimeoutModalComponent {
    @Input() isOpen = false;
    @Output() close = new EventEmitter<void>();

    onClose() {
        this.close.emit();
    }
}
