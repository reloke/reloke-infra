import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, fromEvent, merge } from 'rxjs';
import { startWith, takeUntil } from 'rxjs/operators';
import { OnboardingSummaryService } from './onboarding-summary.service';
import {
  buildOnboardingSteps,
  computeActiveStepKey,
  computeOnboardingDerivedState,
  OnboardingStepKey,
  OnboardingStepViewModel,
  OnboardingVisualState,
} from './onboarding-timeline.model';

type TooltipPosition = { topPx: number; leftPx: number };

@Component({
  selector: 'app-onboarding-timeline',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './onboarding-timeline.component.html',
  styleUrls: ['./onboarding-timeline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingTimelineComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly OnboardingStepKey = OnboardingStepKey;
  readonly OnboardingVisualState = OnboardingVisualState;

  isLoading = true;
  isCollapsed = false;
  activeStepKey: OnboardingStepKey = OnboardingStepKey.Home;

  mainSteps: OnboardingStepViewModel[] = [];

  progressPercent = 0;
  progressLabel = '';

  tooltipStep: OnboardingStepViewModel | null = null;
  tooltipPosition: TooltipPosition = { topPx: 0, leftPx: 0 };
  tooltipPlacement: 'top' | 'bottom' = 'top';
  isTooltipHovered = false;
  private tooltipHideTimer: number | null = null;
  private tooltipAnchorRect: DOMRect | null = null;

  private destroy$ = new Subject<void>();
  private viewInitialized = false;
  private hasUserInteracted = false;
  private hasAutoScrolled = false;
  private isProgrammaticScroll = false;

  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLElement>;
  @ViewChildren('stepItem') stepItems?: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('tooltipBox') tooltipBox?: ElementRef<HTMLElement>;

  constructor(
    private onboardingSummaryService: OnboardingSummaryService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;

    const container = this.scrollContainer?.nativeElement;
    if (container) {
      merge(
        fromEvent(container, 'wheel', { passive: true } as any),
        fromEvent(container, 'touchstart', { passive: true } as any),
        fromEvent(container, 'mousedown')
      )
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => {
          if (!this.isProgrammaticScroll) this.hasUserInteracted = true;
        });

      fromEvent(container, 'scroll', { passive: true } as any)
        .pipe(takeUntil(this.destroy$))
        .subscribe(() => this.hideTooltip());
    }

    this.stepItems?.changes
      .pipe(startWith(this.stepItems), takeUntil(this.destroy$))
      .subscribe(() => this.tryAutoScrollToActive());

    merge(fromEvent(window, 'resize'), fromEvent(window, 'scroll'))
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.repositionTooltip());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackByKey(_: number, step: OnboardingStepViewModel): OnboardingStepKey {
    return step.key;
  }

  toggleCollapsed(): void {
    this.isCollapsed = !this.isCollapsed;
    this.cdr.markForCheck();
    if (!this.isCollapsed) {
      window.setTimeout(() => this.tryAutoScrollToActive(), 0);
    }
    this.hideTooltip();
  }

  getCircleClass(step: OnboardingStepViewModel): Record<string, boolean> {
    const isOptional = !!step.isOptional;
    const isActive = step.visualState === OnboardingVisualState.Active;
    const isDone = step.visualState === OnboardingVisualState.Done;
    const isLocked = step.visualState === OnboardingVisualState.Locked;
    const isTodo = step.visualState === OnboardingVisualState.Todo;

    return {
      'h-12 w-12 rounded-full flex items-center justify-center border transition-all duration-300': true,
      'border-dashed': isOptional && !isDone,
      'bg-primary/10 text-primary border-primary/20': isDone,
      'bg-accent/15 text-accent border-accent/30 ring-4 ring-accent/20 animate-pulse': isActive,
      'bg-gray-50 text-gray-400 border-border-light': isLocked,
      'bg-white text-secondary border-border-light': isTodo && !isOptional,
      'bg-purple-50 text-purple-700 border-purple-200': isTodo && isOptional,
    };
  }

  getTitleClass(step: OnboardingStepViewModel): Record<string, boolean> {
    return {
      'mt-3 text-[11px] font-semibold text-center leading-snug max-w-[9rem]': true,
      'text-main': step.visualState !== OnboardingVisualState.Locked,
      'text-gray-400': step.visualState === OnboardingVisualState.Locked,
    };
  }

  getConnectorClass(
    step: OnboardingStepViewModel | undefined,
    nextStep: OnboardingStepViewModel | undefined
  ): Record<string, boolean> {
    const stepState = step?.visualState;
    const nextState = nextStep?.visualState;

    const isDone =
      stepState === OnboardingVisualState.Done ||
      nextState === OnboardingVisualState.Done;
    const isActive =
      stepState === OnboardingVisualState.Active ||
      nextState === OnboardingVisualState.Active;

    return {
      'h-[6px] rounded-full transition-colors duration-300': true,
      'bg-border-light': !isDone && !isActive,
      'bg-primary/50': isDone,
      'bg-gradient-to-r from-primary/30 to-accent/70': isActive,
    };
  }

  onStepMouseEnter(step: OnboardingStepViewModel, anchorEl: HTMLElement): void {
    this.clearTooltipHideTimer();
    this.tooltipStep = step;
    this.tooltipAnchorRect = anchorEl.getBoundingClientRect();
    this.cdr.markForCheck();
    window.requestAnimationFrame(() => this.repositionTooltip());
  }

  onStepMouseLeave(): void {
    this.scheduleHideTooltip();
  }

  onTooltipMouseEnter(): void {
    this.isTooltipHovered = true;
    this.clearTooltipHideTimer();
  }

  onTooltipMouseLeave(): void {
    this.isTooltipHovered = false;
    this.scheduleHideTooltip();
  }

  private repositionTooltip(): void {
    if (!this.tooltipStep || !this.tooltipAnchorRect) return;
    const box = this.tooltipBox?.nativeElement;
    if (!box) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 10;

    const boxRect = box.getBoundingClientRect();
    const anchor = this.tooltipAnchorRect;

    let left = anchor.left + anchor.width / 2 - boxRect.width / 2;
    left = Math.max(margin, Math.min(left, vw - boxRect.width - margin));

    const preferredTop = anchor.top - boxRect.height - 12;
    const preferredBottom = anchor.bottom + 12;

    let top = preferredTop;
    let placement: 'top' | 'bottom' = 'top';

    if (preferredTop < margin && preferredBottom + boxRect.height < vh - margin) {
      top = preferredBottom;
      placement = 'bottom';
    } else if (preferredTop < margin) {
      top = Math.max(margin, vh - boxRect.height - margin);
      placement = 'bottom';
    }

    this.tooltipPosition = { topPx: Math.round(top), leftPx: Math.round(left) };
    this.tooltipPlacement = placement;
    this.cdr.markForCheck();
  }

  private scheduleHideTooltip(): void {
    this.clearTooltipHideTimer();
    this.tooltipHideTimer = window.setTimeout(() => {
      if (!this.isTooltipHovered) this.hideTooltip();
    }, 160);
  }

  private clearTooltipHideTimer(): void {
    if (this.tooltipHideTimer) {
      window.clearTimeout(this.tooltipHideTimer);
      this.tooltipHideTimer = null;
    }
  }

  hideTooltip(): void {
    this.clearTooltipHideTimer();
    this.isTooltipHovered = false;
    this.tooltipStep = null;
    this.tooltipAnchorRect = null;
    this.cdr.markForCheck();
  }

  private load(): void {
    this.isLoading = true;
    this.cdr.markForCheck();

    this.onboardingSummaryService
      .getSnapshot()
      .pipe(takeUntil(this.destroy$))
      .subscribe((snapshot) => {
        const derived = computeOnboardingDerivedState(snapshot);
        const activeKey = computeActiveStepKey(derived);

        const steps = buildOnboardingSteps(derived, activeKey);
        const requiredSteps = steps.filter((s) => !s.isOptional);
        const doneRequired = requiredSteps.filter((s) => s.visualState === OnboardingVisualState.Done).length;
        const totalRequired = requiredSteps.length || 1;
        this.progressPercent = Math.round((doneRequired / totalRequired) * 100);
        this.progressLabel = `${doneRequired}/${totalRequired} étapes complétées`;

        this.activeStepKey = activeKey;
        this.mainSteps = steps;
        this.isLoading = false;
        this.cdr.markForCheck();

        // Wait for the view to render the new nodes before scrolling.
        window.setTimeout(() => this.tryAutoScrollToActive(), 0);
      });
  }

  private tryAutoScrollToActive(): void {
    if (!this.viewInitialized) return;
    if (this.hasAutoScrolled) return;
    if (this.hasUserInteracted) return;

    const activeEl = this.findStepElement(this.activeStepKey);
    if (!activeEl) return;

    this.isProgrammaticScroll = true;
    activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

    window.setTimeout(() => {
      this.isProgrammaticScroll = false;
    }, 800);

    this.hasAutoScrolled = true;
  }

  private findStepElement(key: OnboardingStepKey): HTMLElement | null {
    const items = this.stepItems?.toArray() ?? [];
    for (const item of items) {
      const el = item.nativeElement;
      if (el?.dataset?.['stepKey'] === key) return el;
    }
    return null;
  }
}
