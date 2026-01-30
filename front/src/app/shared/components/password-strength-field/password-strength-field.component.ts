import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule, AbstractControl } from '@angular/forms';
import { FR } from '../../../core/i18n/fr';

@Component({
    selector: 'app-password-strength-field',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './password-strength-field.component.html'
})
export class PasswordStrengthFieldComponent implements OnInit {
    @Input() parentForm!: FormGroup;
    @Input() controlName: string = 'password';
    @Input() label: string = 'Mot de passe';
    @Input() placeholder: string = 'Entrez votre mot de passe';
    @Input() showFeedbackStart: boolean = true; // Show feedback immediately if true, or wait for touch
    @Input() showStrengthBar: boolean = true;
    @Input() enforceStrength: boolean = true; // Added to enable/disable validation logic

    showPassword = false;
    lang = FR;

    // Password Strength State
    passwordCriteria = {
        length: false,
        upper: false,
        lower: false,
        number: false,
        special: false
    };
    passwordScore = 0; // 0 to 5
    isPasswordStrong = false;

    get control(): AbstractControl | null {
        return this.parentForm.get(this.controlName);
    }

    ngOnInit() {
        this.control?.valueChanges.subscribe(value => {
            this.updateStrength(value);
        });
        // Initialize standard validation binding
        if (this.enforceStrength) {
            this.control?.addValidators(this.validateStrength.bind(this));
        }
        this.control?.updateValueAndValidity();

        // Initial check
        if (this.control?.value) {
            this.updateStrength(this.control.value);
        }
    }

    togglePasswordVisibility() {
        this.showPassword = !this.showPassword;
    }

    updateStrength(value: string) {
        if (!value) {
            this.passwordScore = 0;
            this.passwordCriteria = { length: false, upper: false, lower: false, number: false, special: false };
            this.isPasswordStrong = false;
            return;
        }

        this.passwordCriteria = {
            length: value.length >= 8,
            upper: /[A-Z]/.test(value),
            lower: /[a-z]/.test(value),
            number: /[0-9]/.test(value),
            special: /[!@#$%^&*(),.?":{}|<>]/.test(value)
        };

        const criteriaMet = Object.values(this.passwordCriteria).filter(Boolean).length;
        this.passwordScore = criteriaMet;
        this.isPasswordStrong = criteriaMet === 5;
    }

    validateStrength(control: AbstractControl): { [key: string]: boolean } | null {
        // Re-calculate simply for validation cycle return, using internal state if sync
        // But better to recalculate safely
        const value = control.value || '';
        const criteria = {
            length: value.length >= 8,
            upper: /[A-Z]/.test(value),
            lower: /[a-z]/.test(value),
            number: /[0-9]/.test(value),
            special: /[!@#$%^&*(),.?":{}|<>]/.test(value)
        };
        const isStrong = Object.values(criteria).every(Boolean);
        return isStrong ? null : { weakPassword: true };
    }

    getStrengthLabel(): string {
        if (this.passwordScore <= 1) return this.lang.auth.register.passwordStrength.weak;
        if (this.passwordScore === 2) return this.lang.auth.register.passwordStrength.fair;
        if (this.passwordScore === 3) return this.lang.auth.register.passwordStrength.good;
        if (this.passwordScore === 4) return this.lang.auth.register.passwordStrength.strong;
        return this.lang.auth.register.passwordStrength.excellent;
    }
}
