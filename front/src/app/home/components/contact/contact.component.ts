import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { firstValueFrom } from 'rxjs';

export type ContactTopic = 'ACCOUNT_ACCESS' | 'REGISTRATION' | 'HOW_IT_WORKS' | 'PARTNERSHIP' | 'OTHER';

interface ContactTopicOption {
  value: ContactTopic;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-contact',
  templateUrl: './contact.component.html',
  styleUrls: ['./contact.component.scss']
})
export class ContactComponent implements OnInit {
  contactForm: FormGroup;
  submitting = false;
  submitted = false;
  error = '';
  rateLimitRetryAfter = 0;

  readonly MAX_DESCRIPTION_LENGTH = 2000;

  topics: ContactTopicOption[] = [
    { value: 'ACCOUNT_ACCESS', label: 'Probleme d\'acces au compte', icon: 'pi-lock' },
    { value: 'REGISTRATION', label: 'Probleme d\'inscription', icon: 'pi-user-plus' },
    { value: 'HOW_IT_WORKS', label: 'Comment fonctionne Reloke ?', icon: 'pi-question-circle' },
    { value: 'PARTNERSHIP', label: 'Partenariat / Presse', icon: 'pi-briefcase' },
    { value: 'OTHER', label: 'Autre', icon: 'pi-ellipsis-h' }
  ];

  constructor(
    private fb: FormBuilder,
    private http: HttpClient
  ) {
    this.contactForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      topic: ['', Validators.required],
      description: ['', [
        Validators.required,
        Validators.minLength(10),
        Validators.maxLength(this.MAX_DESCRIPTION_LENGTH)
      ]],
      acceptPrivacy: [false, Validators.requiredTrue]
    });
  }

  ngOnInit(): void {}

  selectTopic(value: ContactTopic): void {
    this.contactForm.get('topic')?.setValue(value);
    this.contactForm.get('topic')?.markAsTouched();
  }

  get descriptionLength(): number {
    return this.contactForm.get('description')?.value?.length || 0;
  }

  async onSubmit(): Promise<void> {
    this.contactForm.markAllAsTouched();

    if (this.contactForm.invalid) {
      return;
    }

    if (this.submitting) return;

    this.submitting = true;
    this.error = '';
    this.rateLimitRetryAfter = 0;

    try {
      const payload = {
        email: this.contactForm.get('email')?.value,
        topic: this.contactForm.get('topic')?.value,
        description: this.contactForm.get('description')?.value
      };

      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/help/contact`, payload)
      );

      this.submitted = true;
    } catch (err: unknown) {
      const httpError = err as HttpErrorResponse;

      if (httpError.status === 429) {
        this.rateLimitRetryAfter = httpError.error?.retryAfter || 60;
        this.error = `Trop de demandes. Veuillez reessayer dans ${Math.ceil(this.rateLimitRetryAfter / 60)} minute(s).`;
      } else {
        this.error = httpError.error?.message || 'Une erreur est survenue. Veuillez reessayer.';
      }
    } finally {
      this.submitting = false;
    }
  }

  resetForm(): void {
    this.contactForm.reset();
    this.submitted = false;
    this.error = '';
  }

  getTopicIcon(value: ContactTopic): string {
    return this.topics.find(t => t.value === value)?.icon || 'pi-question';
  }
}
