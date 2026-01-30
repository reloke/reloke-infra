import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HelpService, HelpRequest, HelpRequestListItem, HelpTopic, PaginatedHelpRequests } from '../../../core/services/help.service';
import { firstValueFrom } from 'rxjs';

interface FilePreview {
  file: File;
  preview: string;
  uploading: boolean;
  error: boolean;
  key?: string;
}

@Component({
  selector: 'app-help-request',
  templateUrl: './help-request.component.html',
  styleUrls: ['./help-request.component.scss']
})
export class HelpRequestComponent implements OnInit {
 @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  helpForm: FormGroup;
  files: FilePreview[] = [];
  submitting = false;
  submitted = false;
  error = '';

  // My requests modal
  isMyRequestsModalOpen = false;
  myRequests: HelpRequestListItem[] = [];
  myRequestsTotal = 0;
  myRequestsHasMore = false;
  myRequestsNextCursor?: string;
  isLoadingMyRequests = false;
  isLoadingMyRequestDetails = false;
  myRequestsError = '';
  selectedRequest: HelpRequest | null = null;
  selectedRequestError = '';



  // Topic options
  topics: { value: HelpTopic; label: string }[] = [
    { value: 'HOME', label: 'Mon logement' },
    { value: 'SEARCH', label: 'Ma recherche' },
    { value: 'SEARCH_CRITERIA', label: 'Mes criteres de recherche' },
    { value: 'MATCHES', label: 'Mes matchs' },
    { value: 'PAYMENTS', label: 'Paiements et credits' },
    { value: 'OTHER', label: 'Autre' }
  ];

  // Status labels
  statusLabels: Record<string, { label: string; class: string }> = {
    OPEN: { label: 'En attente', class: 'bg-yellow-100 text-yellow-800' },
    IN_PROGRESS: { label: 'En cours', class: 'bg-blue-100 text-blue-800' },
    RESOLVED: { label: 'Resolu', class: 'bg-green-100 text-green-800' }
  };

  readonly MAX_FILES = 3;
  readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  readonly MAX_DESCRIPTION_LENGTH = 2000;

  constructor(
    private fb: FormBuilder,
    private helpService: HelpService,
    private router: Router
  ) {
    this.helpForm = this.fb.group({
      topic: ['', Validators.required],
      description: ['', [
        Validators.required,
        Validators.minLength(10),
        Validators.maxLength(this.MAX_DESCRIPTION_LENGTH)
      ]]
    });
  }

  ngOnInit() {

  }

  // ============================================================
  // My Requests Modal
  // ============================================================

  async openMyRequestsModal() {
    this.isMyRequestsModalOpen = true;
    this.selectedRequest = null;
    this.selectedRequestError = '';
    if (this.myRequests.length === 0) {
      await this.loadMyRequests(true);
    }
  }

  closeMyRequestsModal() {
    this.isMyRequestsModalOpen = false;
    this.selectedRequest = null;
    this.selectedRequestError = '';
    this.myRequestsError = '';
  }

  async loadMyRequests(reset = false) {
    if (this.isLoadingMyRequests) return;

    this.isLoadingMyRequests = true;
    this.myRequestsError = '';

    try {
      if (reset) {
        this.myRequests = [];
        this.myRequestsTotal = 0;
        this.myRequestsHasMore = false;
        this.myRequestsNextCursor = undefined;
      }

      const res: PaginatedHelpRequests = await firstValueFrom(
        this.helpService.getMyHelpRequestsPaginated(this.myRequestsNextCursor, 10)
      );

      this.myRequests = [...this.myRequests, ...(res.items || [])];
      this.myRequestsTotal = res.total || 0;
      this.myRequestsHasMore = !!res.hasMore;
      this.myRequestsNextCursor = res.nextCursor;
    } catch (err: any) {
      console.error('Error loading help requests', err);
      this.myRequestsError = err.error?.message || err.message || 'Une erreur est survenue.';
    } finally {
      this.isLoadingMyRequests = false;
    }
  }

  async openRequestDetails(uid: string) {
    if (this.isLoadingMyRequestDetails) return;

    this.isLoadingMyRequestDetails = true;
    this.selectedRequestError = '';

    try {
      this.selectedRequest = await firstValueFrom(this.helpService.getHelpRequest(uid));
    } catch (err: any) {
      console.error('Error loading help request details', err);
      this.selectedRequestError = err.error?.message || err.message || 'Une erreur est survenue.';
      this.selectedRequest = null;
    } finally {
      this.isLoadingMyRequestDetails = false;
    }
  }



  // === Topic Selection ===

  selectTopic(value: HelpTopic) {
    this.helpForm.get('topic')?.setValue(value);
    this.helpForm.get('topic')?.markAsTouched();
  }

triggerFileInput() {
  if (this.fileInput?.nativeElement) {
    const input = this.fileInput.nativeElement;

    // Temporairement l'ajouter au body
    const parent = input.parentElement;
    document.body.appendChild(input);

    input.click();

    // Le remettre à sa place après
    if (parent) {
      parent.appendChild(input);
    }

    console.log('click!');
  }
}
  onFileSelect(event: Event) {
    console.log("enter ");
    const input = event.target as HTMLInputElement;
    if (!input.files) return;

    const newFiles = Array.from(input.files);

    for (const file of newFiles) {
      if (this.files.length >= this.MAX_FILES) {
        this.error = `Maximum ${this.MAX_FILES} fichiers autorises`;
        break;
      }

      if (file.size > this.MAX_FILE_SIZE) {
        this.error = `Le fichier ${file.name} depasse la taille maximale de 10 Mo`;
        continue;
      }

      if (!file.type.startsWith('image/')) {
        this.error = `Le fichier ${file.name} n'est pas une image`;
        continue;
      }

      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.files.push({
          file,
          preview: e.target?.result as string,
          uploading: false,
          error: false
        });
      };
      reader.readAsDataURL(file);
    }

    // Reset input
    input.value = '';
  }

  removeFile(index: number) {
    this.files.splice(index, 1);
  }

  // === Form Submission ===

  async onSubmit() {
    // Mark all fields as touched to show validation errors
    this.helpForm.markAllAsTouched();

    if (this.helpForm.invalid) {
      console.log('Form is invalid:', this.helpForm.errors, this.helpForm.value);
      return;
    }

    if (this.submitting) return;

    this.submitting = true;
    this.error = '';

    try {
      // Step 1: Upload files via backend (if any)
      const attachmentKeys: string[] = [];

      if (this.files.length > 0) {
        for (let i = 0; i < this.files.length; i++) {
          this.files[i].uploading = true;
          try {
            const result = await firstValueFrom(this.helpService.uploadAttachment(this.files[i].file));
            this.files[i].key = result.key;
            attachmentKeys.push(result.key);
          } catch (err) {
            this.files[i].error = true;
            throw new Error(`Erreur lors de l'upload de ${this.files[i].file.name}`);
          } finally {
            this.files[i].uploading = false;
          }
        }
      }

      // Step 2: Create the help request
      const topic = this.helpForm.get('topic')?.value as HelpTopic;
      const description = this.helpForm.get('description')?.value;

      await firstValueFrom(this.helpService.createHelpRequest(
        topic,
        description,
        attachmentKeys.length > 0 ? attachmentKeys : undefined
      ));

      this.submitted = true;
      this.submitting = false;

    } catch (err: any) {
      console.error('Error submitting help request', err);
      this.error = err.error?.message || err.message || 'Une erreur est survenue. Veuillez reessayer.';
      this.submitting = false;
    }
  }

  resetForm() {
    this.helpForm.reset();
    this.files = [];
    this.submitted = false;
    this.error = '';
  }

  goBack() {
    this.router.navigate(['/profile/account']);
  }

  // === Helpers ===

  get descriptionLength(): number {
    return this.helpForm.get('description')?.value?.length || 0;
  }

  getTopicLabel(topic: string): string {
    return this.topics.find(t => t.value === topic)?.label || topic;
  }

  getStatusInfo(status: string) {
    return this.statusLabels[status] || { label: status, class: 'bg-gray-100 text-gray-800' };
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
