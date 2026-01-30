import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-error-page',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="h-screen w-full bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
      <!-- Background Blobs -->
      <div class="absolute -top-24 -left-24 w-96 h-96 bg-primary/10 rounded-full blur-[100px] animate-pulse"></div>
      <div class="absolute -bottom-24 -right-24 w-96 h-96 bg-primary/20 rounded-full blur-[100px] animate-pulse delay-1000"></div>

      <div class="max-w-md w-full text-center relative z-10 space-y-8 animate-fade-in-up">
        <!-- Animated Number -->
        <div class="relative">
          <h1 class="text-[120px] font-black text-main leading-none select-none tracking-tighter opacity-10 animate-float">
            {{ errorCode }}
          </h1>
          <div class="absolute inset-0 flex items-center justify-center">
             <span class="text-6xl font-heading font-black text-primary drop-shadow-2xl">
               {{ errorCode }}
             </span>
          </div>
        </div>

        <div class="space-y-3">
          <h2 class="text-3xl font-heading font-extrabold text-main">
            {{ errorTitle }}
          </h2>
          <p class="text-secondary leading-relaxed max-w-[280px] mx-auto">
            {{ errorMessage }}
          </p>
        </div>

        <div class="pt-4">
          <a routerLink="/" 
             class="inline-flex items-center gap-2 px-8 py-4 bg-primary text-white rounded-2xl font-bold shadow-xl shadow-primary/20 hover:bg-primary-dark hover:-translate-y-1 transition-all active:scale-95 group">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Retour au bercail
          </a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-20px); }
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-float { animation: float 6s ease-in-out infinite; }
    .animate-fade-in-up { animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; }
  `]
})
export class ErrorPageComponent implements OnInit {
  errorCode = '404';
  errorTitle = 'Page Non Trouvée';
  errorMessage = "La page que vous recherchez n'existe pas.";

  constructor(private route: ActivatedRoute) { }

  ngOnInit() {
    this.route.data.subscribe(data => {
      if (data['error'] === 403) {
        this.errorCode = '403';
        this.errorTitle = 'Accès Interdit';
        this.errorMessage = "Vous n'avez pas les droits nécessaires pour accéder à cette page.";
      }
    });
  }
}
