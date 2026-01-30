import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  NgZone,
  HostListener,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, fromEvent } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, filter, switchMap, map } from 'rxjs/operators';

import { HomeService } from '../../services/home.service';
import { GooglePlacesService, PlacePrediction, PlaceDetails } from '../../../core/services/google-places.service';
import { environment } from '../../../../environments/environment';
import {
  Home,
  HomeImage,
  HomeType,
  HOME_TYPE_OPTIONS,
  CreateHomePayload,
  AddressSelection,
  CapturedImage,
} from '../../models/home.model';
import {
  addressSelectedValidator,
  strictlyPositiveValidator,
  notInPastValidator,
  HOME_FORM_ERROR_MESSAGES,
} from '../../validators/home.validators';

type FormStep = 1 | 2 | 3;

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 10;

@Component({
  selector: 'app-outgoing-profile',
  templateUrl: './outgoing-profile.component.html',
  styleUrls: ['./outgoing-profile.component.scss'],
})
export class OutgoingProfileComponent implements OnInit, OnDestroy {
  @ViewChild('addressInput') addressInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('videoElement') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('homeTypeDropdown') homeTypeDropdownRef?: ElementRef<HTMLElement>;
  @ViewChild('roomsDropdown') roomsDropdownRef?: ElementRef<HTMLElement>;

  // Form
  homeForm!: FormGroup;

  // State
  currentStep: FormStep = 1;
  isLoading = false;
  isNewHome = true;
  currentHomeId: number | null = null;

  // Address
  addressSelection: AddressSelection = { rawInput: '' };

  // Autocomplete State
  predictions: PlacePrediction[] = [];
  showPredictions = false;
  isLoadingPredictions = false;
  selectedPredictionIndex = -1;
  private googleApiInitialized = false;
  private inputSubscription$ = new Subject<void>();

  // Configuration
  private readonly DEBOUNCE_MS = 300;
  private readonly MIN_CHARS_FOR_SEARCH = 2;

  // Images
  capturedImages: CapturedImage[] = [];
  existingImages: HomeImage[] = [];

  // Camera
  isCameraActive = false;
  cameraError: string | null = null;
  private mediaStream: MediaStream | null = null;

  // Modal
  showCancelModal = false;
  showFullscreenPreview = false;
  fullscreenImage: CapturedImage | null = null;

  // Summary carousel
  currentImageIndex = 0;
  showSummaryGallery = false;
  galleryImageIndex = 0;
  showSuccessMessage = true; // Controls the success message visibility

  // Dropdown state
  isHomeTypeDropdownOpen = false;
  isRoomsDropdownOpen = false;
  selectedHomeTypeDescription = '';

  // Options
  readonly homeTypeOptions = HOME_TYPE_OPTIONS;
  readonly roomOptions = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly minDate: string;
  readonly minDateObj: Date;
  readonly errorMessages = HOME_FORM_ERROR_MESSAGES;

  // Steps config
  readonly steps = [
    { number: 1, label: 'Informations' },
    { number: 2, label: 'Photos' },
    { number: 3, label: 'Confirmation' },
  ];

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private homeService: HomeService,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
    private ngZone: NgZone,
    private googlePlacesService: GooglePlacesService
  ) {
    // Calculer la date minimum (aujourd'hui)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    this.minDate = today.toISOString().split('T')[0];
    this.minDateObj = today;
  }

  ngOnInit(): void {
    this.initForm();

    // Check if we should go directly to view mode (step 3)
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['view'] === 'true') {
        this.showSuccessMessage = false; // Don't show success message in view mode
      }
    });

    this.loadExistingHome();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.inputSubscription$.next();
    this.inputSubscription$.complete();
    this.stopCamera();
    this.googlePlacesService.cleanup();

    // Cleanup image previews
    this.capturedImages.forEach((img) => {
      if (img.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(img.previewUrl);
      }
    });
  }

  // ==================== FORM INITIALIZATION ====================

  private initForm(): void {
    this.homeForm = this.fb.group(
      {
        // Step 1 fields
        address: [null, [Validators.required, addressSelectedValidator()]],
        homeType: [HomeType.T2, Validators.required],
        nbRooms: [2, [Validators.required, Validators.min(1)]],
        surface: [null, [Validators.required, strictlyPositiveValidator()]],
        rent: [null, [Validators.required, strictlyPositiveValidator()]],
        // Step 2 fields
        description: [null, [Validators.maxLength(1000)]],
      }
    );

    // Update description when homeType changes
    this.homeForm
      .get('homeType')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((value) => {
        const option = this.homeTypeOptions.find((opt) => opt.value === value);
        this.selectedHomeTypeDescription = option?.description || '';
      });

    // Set initial description
    const initialType = this.homeForm.get('homeType')?.value;
    const initialOption = this.homeTypeOptions.find(
      (opt) => opt.value === initialType
    );
    this.selectedHomeTypeDescription = initialOption?.description || '';
  }

  private loadExistingHome(): void {
    this.isLoading = true;
    const viewMode = this.route.snapshot.queryParams['view'] === 'true';

    this.homeService
      .getMyHome()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (home) => {
          this.isLoading = false;
          if (home) {
            this.isNewHome = false;
            this.currentHomeId = home.id;
            this.populateForm(home);
            this.existingImages = home.images;
            // Convert existing images to CapturedImage format
            this.capturedImages = home.images.map((img) => ({
              id: `existing-${img.id}`,
              file: null,
              previewUrl: img.publicUrl,
              isExisting: true,
              existingId: img.id,
              markedForDeletion: false,
            }));

            // If view mode, go directly to step 3 (summary)
            if (viewMode) {
              this.currentStep = 3;
              this.showSuccessMessage = false;
            }
          }
          // Initialize Google Places if on step 1
          if (this.currentStep === 1) {
            this.initGooglePlacesForStep1();
          }
        },
        error: (err) => {
          this.isLoading = false;
          // If no home exists, that's fine - we're creating a new one
          if (err.status !== 404) {
            console.error('Error loading home:', err);
          }
          // Initialize Google Places if on step 1
          if (this.currentStep === 1) {
            this.initGooglePlacesForStep1();
          }
        },
      });
  }

  private populateForm(home: Home): void {


    this.homeForm.patchValue({
      address: {
        rawInput: home.addressFormatted,
        placeId: home.addressPlaceId,
        formattedAddress: home.addressFormatted,
        lat: home.lat,
        lng: home.lng,
      },
      homeType: home.homeType,
      nbRooms: home.nbRooms,
      surface: home.surface,
      rent: home.rent,

      description: home.description,
    });

    this.addressSelection = {
      rawInput: home.addressFormatted,
      placeId: home.addressPlaceId,
      formattedAddress: home.addressFormatted,
      lat: home.lat,
      lng: home.lng,
    };
  }

  // ==================== GOOGLE PLACES AUTOCOMPLETE ====================

  /**
   * Initialise Google Places UNIQUEMENT sur l'étape 1
   */
  private async initGooglePlacesForStep1(): Promise<void> {
    if (this.googleApiInitialized) {
      this.setupInputListener();
      return;
    }

    try {
      await this.googlePlacesService.loadGoogleMapsApi(environment.googleMapsApiKey);
      this.googleApiInitialized = true;
      this.setupInputListener();
    } catch (error) {
      console.error('Erreur chargement Google Places:', error);
      this.snackBar.open('Erreur de chargement. Rafraîchissez la page.', 'Fermer', {
        duration: 5000,
        panelClass: ['custom-snackbar-action-error']
      });
    }
  }

  /**
   * Setup du listener avec DEBOUNCE 300ms
   */
  private setupInputListener(): void {
    this.inputSubscription$.next(); // Cleanup précédent

    setTimeout(() => {
      if (!this.addressInputRef?.nativeElement) {
        return;
      }

      const input = this.addressInputRef.nativeElement;

      // Input avec debounce - utilise map pour extraire la valeur
      fromEvent<Event>(input, 'input').pipe(
        takeUntil(this.inputSubscription$),
        takeUntil(this.destroy$),
        debounceTime(this.DEBOUNCE_MS),
        map((event: Event) => (event.target as HTMLInputElement).value.trim()),
        distinctUntilChanged(),
        filter((value: string) => {
          return value.length >= this.MIN_CHARS_FOR_SEARCH || value.length === 0;
        }),
        switchMap((value: string) => {
          if (value.length < this.MIN_CHARS_FOR_SEARCH) {
            this.predictions = [];
            this.showPredictions = false;
            return Promise.resolve([] as PlacePrediction[]);
          }
          this.isLoadingPredictions = true;
          // Pour les adresses, on utilise le type 'address'
          return this.googlePlacesService.getPredictions(value, { country: 'fr', types: ['address'] })
            .catch(() => {
              return [] as PlacePrediction[];
            });
        })
      ).subscribe({
        next: predictions => {
          this.predictions = predictions;
          this.showPredictions = predictions.length > 0;
          this.isLoadingPredictions = false;
          this.selectedPredictionIndex = -1;
        },
        error: () => {
          this.isLoadingPredictions = false;
        }
      });

      // Blur pour fermer
      fromEvent(input, 'blur').pipe(
        takeUntil(this.inputSubscription$),
        takeUntil(this.destroy$),
        debounceTime(200)
      ).subscribe(() => {
        this.showPredictions = false;
      });

      // Focus pour réouvrir
      fromEvent(input, 'focus').pipe(
        takeUntil(this.inputSubscription$),
        takeUntil(this.destroy$)
      ).subscribe(() => {
        if (this.predictions.length > 0) {
          this.showPredictions = true;
        }
      });
    }, 100);
  }

  /**
   * Navigation clavier dans les suggestions
   */
  onKeyDown(event: KeyboardEvent): void {
    if (!this.showPredictions || !this.predictions.length) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.selectedPredictionIndex = Math.min(this.selectedPredictionIndex + 1, this.predictions.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.selectedPredictionIndex = Math.max(this.selectedPredictionIndex - 1, -1);
        break;
      case 'Enter':
        event.preventDefault();
        if (this.selectedPredictionIndex >= 0) {
          this.selectPrediction(this.predictions[this.selectedPredictionIndex]);
        }
        break;
      case 'Escape':
        this.showPredictions = false;
        break;
    }
  }

  /**
   * Sélection d'une prédiction
   */
  async selectPrediction(prediction: PlacePrediction): Promise<void> {
    try {
      this.isLoadingPredictions = true;

      const details = await this.googlePlacesService.getPlaceDetails(prediction.placeId);

      this.addressSelection = {
        rawInput: details.formattedAddress,
        placeId: details.placeId,
        formattedAddress: details.formattedAddress,
        lat: details.latitude,
        lng: details.longitude,
      };

      this.homeForm.patchValue({
        address: this.addressSelection,
      });
      this.homeForm.get('address')?.markAsTouched();

      if (this.addressInputRef?.nativeElement) {
        this.addressInputRef.nativeElement.value = details.formattedAddress;
      }
      this.predictions = [];
      this.showPredictions = false;
      this.isLoadingPredictions = false;
    } catch (error) {
      console.error('Erreur lors de la sélection:', error);
      this.isLoadingPredictions = false;
      this.snackBar.open('Erreur lors de la sélection.', 'Fermer', { duration: 3000 });
    }
  }

  // Track by pour optimisation ngFor
  trackByPredictionId(index: number, prediction: PlacePrediction): string {
    return prediction.placeId;
  }

  onAddressInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addressSelection = {
      rawInput: input.value,
      placeId: undefined,
      formattedAddress: undefined,
    };
    this.homeForm.patchValue({
      address: this.addressSelection,
    });
  }

  // ==================== STEP NAVIGATION ====================

  private closeCameraIfLeavingStep2(nextStep: FormStep): void {
    if (this.currentStep === 2 && nextStep !== 2) {
      this.stopCamera();
      this.cameraError = null;
      this.videoReady = false;
    }
  }

  nextStep(): void {
    if (this.currentStep === 1 && this.isStep1Valid()) {
      this.saveStep1Data();
    } else if (this.currentStep === 2 && this.isStep2Valid()) {
      this.saveStep2Data();
    }
  }

  previousStep(): void {
    if (this.currentStep > 1) {
      const previousStep = (this.currentStep - 1) as FormStep;
      this.closeCameraIfLeavingStep2(previousStep);
      this.currentStep = previousStep;
      // Re-init Google Places if going back to step 1
      if (this.currentStep === 1) {
        this.initGooglePlacesForStep1();
      }
    }
  }

  goToStep(step: number): void {
    if (step >= 1 && step <= 3) {
      // Only allow going to previous steps or current step
      if (step <= this.currentStep) {
        const wasNotOnStep1 = this.currentStep !== 1;
        this.closeCameraIfLeavingStep2(step as FormStep);
        this.currentStep = step as FormStep;
        // Re-init Google Places if going to step 1
        if (this.currentStep === 1 && wasNotOnStep1) {
          this.initGooglePlacesForStep1();
        }
      }
    }
  }

  private isStep1Valid(): boolean {
    const step1Controls = [
      'address',
      'homeType',
      'nbRooms',
      'surface',
      'rent',
    ];
    let isValid = true;

    step1Controls.forEach((controlName) => {
      const control = this.homeForm.get(controlName);
      control?.markAsTouched();
      if (control?.invalid) {
        isValid = false;
      }
    });

    return isValid;
  }

  private isStep2Valid(): boolean {
    const activeCount = this.activePhotosCount;
    if (activeCount < MIN_PHOTOS) {
      this.snackBar.open(
        `Veuillez ajouter au moins ${MIN_PHOTOS} photos de votre logement.`,
        'Fermer',
        { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
      );
      return false;
    }
    return true;
  }

  private saveStep1Data(): void {
    this.isLoading = true;

    const formValues = this.homeForm.value;

    // Convert Date object to ISO string for API
    const formatDateForApi = (date: Date | string | null): string | undefined => {
      if (!date) return undefined;
      if (date instanceof Date) {
        return date.toISOString().split('T')[0];
      }
      return date;
    };

    const payload: CreateHomePayload = {
      addressFormatted:
        this.addressSelection.formattedAddress ||
        this.addressSelection.rawInput,
      addressPlaceId: this.addressSelection.placeId || '',
      lat: this.addressSelection.lat!,
      lng: this.addressSelection.lng!,
      homeType: formValues.homeType,
      nbRooms: formValues.nbRooms,
      surface: formValues.surface,
      rent: formValues.rent,
      description: formValues.description || undefined,
    };

    this.homeService
      .saveHome(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (home) => {
          this.isLoading = false;
          this.currentHomeId = home.id;
          this.isNewHome = false;
          this.currentStep = 2;
        },
        error: (err) => {
          this.isLoading = false;
          this.snackBar.open(
            err.message || 'Erreur lors de la sauvegarde.',
            'Fermer',
            { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
          );
        },
      });
  }

  private saveStep2Data(): void {
    if (!this.currentHomeId) {
      this.snackBar.open(
        'Veuillez d\'abord compléter l\'étape 1.',
        'Fermer',
        { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
      );
      return;
    }

    // Fermer la caméra avant de quitter l’étape 2
    this.stopCamera();
    this.cameraError = null;
    this.videoReady = false;

    const deleteIds = this.capturedImages
      .filter((img) => img.isExisting && img.markedForDeletion && img.existingId)
      .map((img) => img.existingId!) ;

    const newFiles = this.capturedImages
      .filter((img) => !img.isExisting && img.file)
      .map((img) => img.file as File);

    this.isLoading = true;

    this.homeService
      .syncHomeImages(this.currentHomeId, newFiles, deleteIds)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (images) => {
          // Reset local state with server response
          this.capturedImages = images.map((img) => ({
            id: `existing-${img.id}`,
            file: null,
            previewUrl: img.publicUrl,
            isExisting: true,
            existingId: img.id,
            markedForDeletion: false,
          }));

          this.saveDescription();
        },
        error: (err) => {
          this.isLoading = false;
          this.snackBar.open(
            err.message || 'Erreur lors de la sauvegarde des images.',
            'Fermer',
            { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
          );
        },
      });
  }

  private saveDescription(): void {
    const description = this.homeForm.get('description')?.value;
    this.homeService
      .updateDescription(description)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isLoading = false;
          this.currentStep = 3;
        },
        error: (err) => {
          this.isLoading = false;
          this.snackBar.open(
            err.message || 'Erreur lors de la sauvegarde.',
            'Fermer',
            { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
          );
        },
      });
  }

  // ==================== CAMERA & PHOTOS ====================

  private videoReady = false;

private waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onReady = async () => {
      cleanup();
      try {
        // play() est nécessaire après re-render (et parfois sur mobile)
        await video.play().catch(() => {});
      } finally {
        this.videoReady = true;
        resolve();
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error('Video error'));
    };

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
    };

    // Si déjà prêt
    if (video.readyState >= 2) {
      onReady();
      return;
    }

    // Sinon attendre un vrai événement
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });

    // Filet de sécurité (si aucun event ne part)
    setTimeout(() => {
      if (video.readyState >= 2) onReady();
    }, 500);
  });
}


  async startCamera(): Promise<void> {
  try {
    this.cameraError = null;
    this.videoReady = false;

    // Si flux déjà existant, réutilise-le (sinon create)
    if (!this.mediaStream) {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
    }

    this.isCameraActive = true;

    // Attendre que le <video> soit réellement présent après ngIf
    setTimeout(async () => {
      const video = this.videoRef?.nativeElement;
      if (!video || !this.mediaStream) return;

      video.srcObject = this.mediaStream;

      try {
        await this.waitForVideoReady(video);
      } catch {
        // si nécessaire, tu peux afficher un message
      }
    }, 0);

  } catch (error: any) {
    this.cameraError = "Impossible d'accéder à la caméra. Vérifiez les autorisations.";
    console.error('Camera error:', error);
  }
}


  stopCamera(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.isCameraActive = false;
  }



async capturePhoto(): Promise<void> {
  if (!this.videoRef?.nativeElement || !this.isCameraActive) return;

  if (this.capturedImages.length >= MAX_PHOTOS) {
    this.snackBar.open(`Vous ne pouvez pas ajouter plus de ${MAX_PHOTOS} photos.`, 'Fermer', {
      duration: 4000, panelClass: ['custom-snackbar-action-error']
    });
    return;
  }

  const video = this.videoRef.nativeElement;

  // Si pas prêt, on attend (au lieu de return)
  if (video.readyState < 2) {
    console.warn('Video not ready yet - waiting...');
    try {
      await this.waitForVideoReady(video);
    } catch {
      return;
    }
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    if (!blob) return;

    const timestamp = Date.now();
    const file = new File([blob], `photo-${timestamp}.jpg`, { type: 'image/jpeg' });
    const previewUrl = URL.createObjectURL(blob);

    this.ngZone.run(() => {
      this.capturedImages.push({
        id: `new-${timestamp}`,
        file,
        previewUrl,
        isExisting: false,
      });
    });
  }, 'image/jpeg', 0.9);
}


  removeImage(imageId: string): void {
    const imageIndex = this.capturedImages.findIndex(
      (img) => img.id === imageId
    );
    if (imageIndex === -1) return;

    const image = this.capturedImages[imageIndex];

    // If it's an existing image, toggle deletion marker
    if (image.isExisting) {
      this.capturedImages[imageIndex] = {
        ...image,
        markedForDeletion: !image.markedForDeletion,
      };
      return;
    }

    // It's a new image, just remove from array
    if (image.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(image.previewUrl);
    }
    this.capturedImages.splice(imageIndex, 1);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;

    const remainingSlots = MAX_PHOTOS - this.capturedImages.length;
    const filesToAdd = Array.from(input.files).slice(0, remainingSlots);

    filesToAdd.forEach((file) => {
      if (
        file.type.startsWith('image/') &&
        this.capturedImages.length < MAX_PHOTOS
      ) {
        const previewUrl = URL.createObjectURL(file);
        this.capturedImages.push({
          id: `new-${Date.now()}-${Math.random()}`,
          file,
          previewUrl,
          isExisting: false,
        });
      }
    });

    // Reset input
    input.value = '';
  }

  // ==================== DROPDOWN HANDLERS ====================

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node | null;
    if (!target) return;

    if (
      this.isHomeTypeDropdownOpen &&
      this.homeTypeDropdownRef?.nativeElement &&
      !this.homeTypeDropdownRef.nativeElement.contains(target)
    ) {
      this.isHomeTypeDropdownOpen = false;
    }

    if (
      this.isRoomsDropdownOpen &&
      this.roomsDropdownRef?.nativeElement &&
      !this.roomsDropdownRef.nativeElement.contains(target)
    ) {
      this.isRoomsDropdownOpen = false;
    }
  }

  selectHomeType(type: HomeType): void {
    this.homeForm.patchValue({ homeType: type });
    this.isHomeTypeDropdownOpen = false;
  }

  selectRooms(rooms: number): void {
    this.homeForm.patchValue({ nbRooms: rooms });
    this.isRoomsDropdownOpen = false;
  }

  getSelectedHomeTypeLabel(): string {
    const type = this.homeForm.get('homeType')?.value;
    const option = this.homeTypeOptions.find((opt) => opt.value === type);
    return option?.label || 'Sélectionner';
  }

  // ==================== MODAL & NAVIGATION ====================

  openCancelModal(): void {
    this.showCancelModal = true;
  }

  closeCancelModal(): void {
    this.showCancelModal = false;
  }

  confirmCancel(): void {
    this.closeCancelModal();
    this.router.navigate(['/dashboard']);
  }

  modifyProfile(): void {
    this.closeCameraIfLeavingStep2(1);
    this.currentStep = 1;
    this.initGooglePlacesForStep1();
  }

  goToDashboard(): void {
       this.router.navigate(['/dashboard']);
  }

  openFullscreenPreview(image: CapturedImage): void {
    this.fullscreenImage = image;
    this.showFullscreenPreview = true;
  }

  closeFullscreenPreview(): void {
    this.showFullscreenPreview = false;
    this.fullscreenImage = null;
  }

  // ==================== SUMMARY CAROUSEL ====================

  previousImage(): void {
    if (this.currentImageIndex > 0) {
      this.currentImageIndex--;
    } else {
      this.currentImageIndex = this.capturedImages.length - 1;
    }
  }

  nextImage(): void {
    if (this.currentImageIndex < this.capturedImages.length - 1) {
      this.currentImageIndex++;
    } else {
      this.currentImageIndex = 0;
    }
  }

  goToImage(index: number): void {
    this.currentImageIndex = index;
  }

  openSummaryFullscreen(index: number): void {
    this.galleryImageIndex = index;
    this.showSummaryGallery = true;
  }

  closeSummaryGallery(): void {
    this.showSummaryGallery = false;
  }

  previousGalleryImage(): void {
    if (this.galleryImageIndex > 0) {
      this.galleryImageIndex--;
    } else {
      this.galleryImageIndex = this.capturedImages.length - 1;
    }
  }

  nextGalleryImage(): void {
    if (this.galleryImageIndex < this.capturedImages.length - 1) {
      this.galleryImageIndex++;
    } else {
      this.galleryImageIndex = 0;
    }
  }

  goToGalleryImage(index: number): void {
    this.galleryImageIndex = index;
  }

  // ==================== HELPERS ====================

  formatDate(dateValue: string | Date): string {
    if (!dateValue) return '';
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  getFieldError(fieldName: string): string | null {
    const control = this.homeForm.get(fieldName);
    if (control?.touched && control?.errors) {
      const errorKey = Object.keys(control.errors)[0];
      return this.errorMessages[fieldName]?.[errorKey] || null;
    }
    return null;
  }

  get photoCountText(): string {
    const count = this.activePhotosCount;
    if (count < MIN_PHOTOS) {
      return `${count}/${MIN_PHOTOS} photos minimum`;
    }
    return `${count}/${MAX_PHOTOS} photos`;
  }

  get canAddMorePhotos(): boolean {
    return this.activePhotosCount < MAX_PHOTOS;
  }

  get activePhotosCount(): number {
    return this.capturedImages.reduce(
      (acc, img) => acc + (img.markedForDeletion ? 0 : 1),
      0,
    );
  }

  get isMinPhotosMet(): boolean {
    return this.activePhotosCount >= MIN_PHOTOS;
  }

  get progress(): number {
    return Math.round((this.currentStep / 3) * 100);
  }
}
