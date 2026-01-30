import { Directive, Input, OnInit, OnDestroy, TemplateRef, ViewContainerRef } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { PermissionsService } from '../../core/services/permissions.service';
import { Role } from '../../core/models/role.enum';

@Directive({
    selector: '[appHasRole]',
    standalone: true
})
export class HasRoleDirective implements OnInit, OnDestroy {
    private roles: Role[] = [];
    private destroy$ = new Subject<void>();
    private isVisible = false;

    @Input() set appHasRole(val: Role[] | Role | string | string[]) {
        // Allow strings to be passed from templates and cast them to Role
        const valArray = Array.isArray(val) ? val : [val];
        this.roles = valArray as Role[];
        this.updateView();
    }

    constructor(
        private templateRef: TemplateRef<any>,
        private viewContainer: ViewContainerRef,
        private permissionsService: PermissionsService
    ) { }

    ngOnInit() {
        // S'abonne aux changements d'utilisateur pour une réactivité totale
        this.permissionsService.hasRole(this.roles)
            .pipe(takeUntil(this.destroy$))
            .subscribe(hasRole => {
                if (hasRole && !this.isVisible) {
                    this.viewContainer.createEmbeddedView(this.templateRef);
                    this.isVisible = true;
                } else if (!hasRole && this.isVisible) {
                    this.viewContainer.clear();
                    this.isVisible = false;
                }
            });
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private updateView() {
        // Cette méthode peut être appelée si les rôles requis changent dynamiquement
    }
}
