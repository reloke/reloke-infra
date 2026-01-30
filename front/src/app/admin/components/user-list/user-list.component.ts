import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-user-list',
  templateUrl: './user-list.component.html',
  styleUrls: ['./user-list.component.scss']
})
export class UserListComponent implements OnInit {
  @Input() limit: number = 10;
  users: any[] = [];
  searchTerm: string = '';
  roleFilter: string = '';
  statusFilter: string = '';

  loading = false;
  hasMore = false;
  nextCursor?: string;
  total = 0;

  selectedUserLogs: any[] | null = null;
  selectedUserId: number | null = null;

  // UI State
  openActionMenuId: number | null = null;
  isUnbanModalOpen = false;
  isBanModalOpen = false;
  userToUnban: any = null;
  userToBan: any = null;

  constructor(
    private adminService: AdminService,
    private router: Router,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit() {
    this.loadUsers();
  }

  loadUsers(append = false) {
    if (this.loading) return;
    this.loading = true;

    const cursor = append ? this.nextCursor : undefined;

    this.adminService.getUsers(
      this.searchTerm || undefined,
      this.roleFilter || undefined,
      this.statusFilter || undefined,
      undefined,
      cursor,
      this.limit
    ).subscribe({
      next: (data) => {
        if (append) {
          this.users = [...this.users, ...data.items];
        } else {
          this.users = data.items;
        }
        this.total = data.total;
        this.hasMore = data.hasMore;
        this.nextCursor = data.nextCursor;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading users', err);
        this.loading = false;
      }
    });
  }

  onSearch() {
    this.nextCursor = undefined;
    this.loadUsers();
  }

  setRoleFilter(role: string) {
    this.roleFilter = role;
    this.nextCursor = undefined;
    this.loadUsers();
  }

  setStatusFilter(status: string) {
    this.statusFilter = status;
    this.nextCursor = undefined;
    this.loadUsers();
  }

  loadMore() {
    if (this.hasMore && !this.loading) {
      this.loadUsers(true);
    }
  }

  toggleActionMenu(id: number) {
    if (this.openActionMenuId === id) {
      this.openActionMenuId = null;
    } else {
      this.openActionMenuId = id;
    }
  }

  viewProfile(uid: string) {
    this.router.navigate(['/admin/dashboard/users', uid]);
  }

  viewLogs(userId: number) {
    this.openActionMenuId = null;
    if (this.selectedUserId === userId) {
      this.selectedUserId = null;
      this.selectedUserLogs = null;
      return;
    }
    this.selectedUserId = userId;
    this.selectedUserLogs = null; // Reset while loading
    this.adminService.getUserLogs(userId).subscribe(logs => {
      this.selectedUserLogs = logs;
    });
  }

  ban(userId: number) {
    this.openActionMenuId = null;
    this.userToBan = this.users.find(u => u.id === userId);
    this.isBanModalOpen = true;
  }

  confirmBan() {
    if (!this.userToBan) return;

    const userId = this.userToBan.id;
    this.isBanModalOpen = false;

    this.adminService.banUser(userId).subscribe({
      next: () => {
        this.snackBar.open('Utilisateur banni.', 'Fermer', {
          duration: 3000,
          panelClass: ['custom-snackbar-success']
        });
        this.loadUsers();
        this.userToBan = null;
      },
      error: (err) => {
        this.snackBar.open('Erreur lors du bannissement.', 'Fermer', {
          duration: 3000,
          panelClass: ['custom-snackbar-error']
        });
        this.userToBan = null;
      }
    });
  }

  cancelBan() {
    this.isBanModalOpen = false;
    this.userToBan = null;
  }

  unban(userId: number) {
    this.openActionMenuId = null;
    this.userToUnban = this.users.find(u => u.id === userId);
    this.isUnbanModalOpen = true;
  }

  confirmUnban() {
    if (!this.userToUnban) return;

    const userId = this.userToUnban.id;
    this.isUnbanModalOpen = false;

    this.adminService.unbanUser(userId).subscribe({
      next: () => {
        this.snackBar.open('Utilisateur débanni avec succès.', 'Fermer', {
          duration: 3000,
          panelClass: ['custom-snackbar-success']
        });
        this.loadUsers();
        this.userToUnban = null;
      },
      error: (err) => {
        this.snackBar.open('Erreur lors du débannissement.', 'Fermer', {
          duration: 3000,
          panelClass: ['custom-snackbar-error']
        });
        this.userToUnban = null;
      }
    });
  }

  cancelUnban() {
    this.isUnbanModalOpen = false;
    this.userToUnban = null;
  }
}

