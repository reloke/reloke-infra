import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { NotificationPermissionPromptService } from './notification-permission-prompt.service';

@Component({
  selector: 'app-notification-permission-prompt',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification-permission-prompt.component.html',
  styleUrls: ['./notification-permission-prompt.component.scss'],
})
export class NotificationPermissionPromptComponent implements OnInit, OnDestroy {
  isVisible = false;
  isRequesting = false;

  private destroy$ = new Subject<void>();

  constructor(public promptService: NotificationPermissionPromptService) { }

  ngOnInit(): void {
    this.promptService.showPrompt$
      .pipe(takeUntil(this.destroy$))
      .subscribe((show) => {
        this.isVisible = show;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async onAuthorize(): Promise<void> {
    if (this.isRequesting) return;

    this.isRequesting = true;
    try {
      await this.promptService.requestPermission();
    } finally {
      this.isRequesting = false;
    }
  }

  onDismissLater(): void {
    this.promptService.dismissLater();
  }

  onDismissForever(): void {
    this.promptService.dismissForever();
  }
}
