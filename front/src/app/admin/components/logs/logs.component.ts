
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminService } from '../../../core/services/admin.service';
import { SharedModule } from '../../../shared/shared.module';

@Component({
    selector: 'app-admin-logs',
    standalone: true,
    imports: [CommonModule, SharedModule],
    template: `
    <div class="p-8 max-w-7xl mx-auto">
      <h2 class="text-3xl font-serif font-black mb-6 text-gray-900">Logs d'audit</h2>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-gray-50 border-b border-gray-200">
              <tr>
                <th class="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                <th class="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Admin</th>
                <th class="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                <th class="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Entité</th>
                <th class="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Détails</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr *ngFor="let log of logs" class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                  {{ log.createdAt | date:'dd/MM/yyyy HH:mm' }}
                </td>
                <td class="px-6 py-4 text-sm font-medium text-gray-900">
                  <div *ngIf="log.admin; else unknownAdmin" class="flex items-center gap-2">
                    <span class="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold">
                        {{ log.admin.firstName.charAt(0) }}
                    </span>
                    {{ log.admin.firstName }} {{ log.admin.lastName }}
                  </div>
                  <ng-template #unknownAdmin>
                      <span class="text-gray-400 italic">Système/Inconnu</span>
                  </ng-template>
                </td>
                <td class="px-6 py-4">
                  <span [ngClass]="getActionClass(log.action)" 
                        class="px-2 py-1 rounded-full text-xs font-bold border">
                    {{ log.action }}
                  </span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600">
                    <span class="font-medium text-gray-800">{{ log.entityType }}</span>
                    <span *ngIf="log.entityId" class="text-xs text-gray-400 ml-1">#{{ log.entityId }}</span>
                </td>
                <td class="px-6 py-4 text-sm text-gray-600">
                  <pre class="bg-gray-50 p-2 rounded text-xs overflow-x-auto max-w-xs">{{ log.changedFields | json }}</pre>
                </td>
              </tr>
              <tr *ngIf="logs.length === 0 && !loading">
                  <td colspan="5" class="px-6 py-12 text-center text-gray-500">
                      Aucun log trouvé
                  </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="px-6 py-4 border-t border-gray-100 flex justify-between items-center bg-gray-50">
          <span class="text-sm text-gray-500">
            Page {{ page }} sur {{ totalPages }} ({{ total }} entrées)
          </span>
          <div class="flex gap-2">
            <button (click)="changePage(page - 1)" [disabled]="page === 1"
              class="px-3 py-1 text-sm bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              Précédent
            </button>
            <button (click)="changePage(page + 1)" [disabled]="page >= totalPages"
              class="px-3 py-1 text-sm bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              Suivant
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class ActionLogsComponent implements OnInit {
    logs: any[] = [];
    loading = false;
    total = 0;
    page = 1;
    totalPages = 0;
    limit = 20;

    constructor(private adminService: AdminService) { }

    ngOnInit() {
        this.loadLogs();
    }

    loadLogs() {
        this.loading = true;
        this.adminService.getAuditLogs(this.page, this.limit).subscribe({
            next: (data) => {
                this.logs = data.items;
                this.total = data.total;
                this.totalPages = data.totalPages;
                this.loading = false;
            },
            error: (err) => {
                console.error('Error loading logs', err);
                this.loading = false;
            }
        });
    }

    changePage(newPage: number) {
        if (newPage >= 1 && newPage <= this.totalPages) {
            this.page = newPage;
            this.loadLogs();
        }
    }

    getActionClass(action: string): string {
        switch (action) {
            case 'CREATE': return 'bg-green-100 text-green-700 border-green-200';
            case 'UPDATE': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'DELETE': return 'bg-red-100 text-red-700 border-red-200';
            default: return 'bg-gray-100 text-gray-600 border-gray-200';
        }
    }
}
