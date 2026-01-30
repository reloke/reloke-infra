import { Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { AdminGuard } from './core/guards/admin.guard';
import { RoleGuard } from './core/guards/role.guard';
import { UserGuard } from './core/guards/user.guard';
import { GuestGuard } from './core/guards/guest.guard';
import { ErrorPageComponent } from './shared/components/error-page/error-page.component';

export const routes: Routes = [
    {
        path: '',
        loadChildren: () => import('./home/home.module').then(m => m.HomeModule)
    },
    {
        path: 'auth',
        loadChildren: () => import('./auth/auth.module').then(m => m.AuthModule)
    },
    {
        path: 'profile',
        loadChildren: () => import('./profile/profile.module').then(m => m.ProfileModule),
        canActivate: [AuthGuard, UserGuard]
    },
    {
        path: 'matching',
        loadChildren: () => import('./matching/matching.module').then(m => m.MatchingModule),
        canActivate: [AuthGuard, UserGuard]
    },
    {
        path: 'payment',
        loadChildren: () => import('./payment/payment.module').then(m => m.PaymentModule),
        canActivate: [AuthGuard, UserGuard]
    },
    {
        path: 'admin',
        loadChildren: () => import('./admin/admin.module').then(m => m.AdminModule),
        canActivate: [AuthGuard, RoleGuard],
        data: { roles: ['ADMIN'] }
    },
    {
        path: 'legal',
        loadChildren: () => import('./legal/legal.module').then(m => m.LegalModule)
    },
    {
        path: 'error',
        component: ErrorPageComponent
    },
    {
        path: '**',
        redirectTo: 'error'
    }
];
