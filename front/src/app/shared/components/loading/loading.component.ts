import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center justify-center loader" [ngClass]="containerClass">
      <img [src]="white ? 'assets/images/reloke-key-only-white-logo.svg' : 'assets/images/reloke.png'" 
           alt="Loading..." 
           [class]="imageClass"
           class="animate-spin-slow">
    </div>
  `,
  styles: [`
    .loader {
      z-index: 1000;
    }
      
    .animate-spin-slow {
      animation: spin 3s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `]
})
export class LoadingComponent {
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() white: boolean = false;

  get containerClass() {
    return {
      'w-4 h-4': this.size === 'sm',
      'w-12 h-12': this.size === 'md',
      'w-24 h-24': this.size === 'lg'
    };
  }

  get imageClass() {
    return {
      'w-4 h-4': this.size === 'sm',
      'w-10 h-10': this.size === 'md',
      'w-20 h-20': this.size === 'lg'
    };
  }
}
