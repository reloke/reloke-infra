import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  ChangeDetectorRef,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PrimeNGConfig } from 'primeng/api';
import { Subject, fromEvent } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, filter, switchMap, map } from 'rxjs/operators';
import { GooglePlacesService, PlacePrediction, PlaceDetails } from '../../../core/services/google-places.service';
import { environment } from '../../../../environments/environment';

import { SearcherService } from '../../services/searcher.service';
import {
  Search,
  SearchZone,
  CreateSearchPayload,
  HomeType,
  HOME_TYPE_OPTIONS,
  MAX_SEARCH_ZONES,
  SEARCH_FORM_ERROR_MESSAGES,
} from '../../models/search.model';
import {
  notInPastValidator,
  endDateAfterStartValidator,
  minLessThanMaxValidator,
  strictlyPositiveValidator,
  minZonesValidator,
  maxZonesValidator,
} from '../../validators/search.validators';
import {
  formatLocalYmd,
  normalizeApiDate,
  ensureDate,
  getClientTimeZone,
} from '../../utils/date-utils';

type FormStep = 1 | 2 | 3;

@Component({
  selector: 'app-searcher-profile',
  templateUrl: './searcher-profile.component.html',
  styleUrls: ['./searcher-profile.component.scss'],
})
export class SearcherProfileComponent implements OnInit, OnDestroy {
  @ViewChild('zoneInput') zoneInputRef!: ElementRef<HTMLInputElement>;

  // Form
  searchForm!: FormGroup;

  // State
  currentStep: FormStep = 1;
  isLoading = false;
  isNewSearch = true;
  currentSearchId: number | null = null;
  showSuccessMessage = false;

  // Zones
  zones: SearchZone[] = [];

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

  // Modal
  showCancelModal = false;

  // Options
  readonly homeTypeOptions = HOME_TYPE_OPTIONS;
  readonly minDate: string;
  readonly minDateObj: Date;
  readonly defaultEndDate: string;
  readonly defaultEndDateObj: Date;
  readonly errorMessages = SEARCH_FORM_ERROR_MESSAGES;
  readonly maxZones = MAX_SEARCH_ZONES;
  readonly frLocale = {
    dayNames: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
    dayNamesShort: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
    dayNamesMin: ['D', 'L', 'M', 'M', 'J', 'V', 'S'],
    monthNames: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    monthNamesShort: ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'],
    today: "Aujourd'hui",
    clear: 'Effacer',
    dateFormat: 'dd/mm/yy',
    firstDayOfWeek: 1,
  };

  // Steps config
  readonly steps = [
    { number: 1, label: 'Zones & période' },
    { number: 2, label: 'Critères' },
    { number: 3, label: 'Récapitulatif' },
  ];

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private searcherService: SearcherService,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
    private googlePlacesService: GooglePlacesService,
    private cdr: ChangeDetectorRef,
    private primengConfig: PrimeNGConfig,
) {
  // Calculate minimum date (today)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  this.minDate = formatLocalYmd(today);
  this.minDateObj = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);

  // Calculate default end date (3 months from now)
  const threeMonthsLater = new Date();
  threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
  threeMonthsLater.setHours(0, 0, 0, 0);
  this.defaultEndDate = formatLocalYmd(threeMonthsLater);
  this.defaultEndDateObj = new Date(
    threeMonthsLater.getFullYear(),
    threeMonthsLater.getMonth(),
    threeMonthsLater.getDate(),
    12,
  );
}

  ngOnInit(): void {
    this.primengConfig.setTranslation(this.frLocale);

    this.initForm();

    // Check if we should go directly to view mode (step 3)
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      if (params['view'] === 'true') {
        this.showSuccessMessage = false;
      }
    });

    this.loadExistingSearch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.inputSubscription$.next();
    this.inputSubscription$.complete();
    this.googlePlacesService.cleanup();
  }

  // ==================== FORM INITIALIZATION ====================

  private initForm(): void {
    this.searchForm = this.fb.group({
      // Step 1 fields
      zones: [[], [minZonesValidator(1), maxZonesValidator(MAX_SEARCH_ZONES)]],
      searchStartDate: [this.minDateObj, [Validators.required, notInPastValidator()]],
      searchEndDate: [
        this.defaultEndDateObj,
        [Validators.required, notInPastValidator(), endDateAfterStartValidator('searchStartDate')],
      ],

      // Step 2 fields
      minRent: [null, [minLessThanMaxValidator('maxRent')]],
      maxRent: [null, [Validators.required, strictlyPositiveValidator()]],
      minRoomSurface: [null, [strictlyPositiveValidator(), minLessThanMaxValidator('maxRoomSurface')]],
      maxRoomSurface: [null, [strictlyPositiveValidator()]],
      minRoomNb: [null, [Validators.min(1), minLessThanMaxValidator('maxRoomNb')]],
      maxRoomNb: [null, [Validators.min(1)]],
      homeTypes: [[]],
    });

    // Update end date validation when start date changes
    this.searchForm.get('searchStartDate')?.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.searchForm.get('searchEndDate')?.updateValueAndValidity();
    });

    // Update min validators when max changes
    this.searchForm.get('maxRent')?.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.searchForm.get('minRent')?.updateValueAndValidity();
    });

    this.searchForm.get('maxRoomSurface')?.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.searchForm.get('minRoomSurface')?.updateValueAndValidity();
    });

    this.searchForm.get('maxRoomNb')?.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.searchForm.get('minRoomNb')?.updateValueAndValidity();
    });
  }

  private loadExistingSearch(): void {
    this.isLoading = true;
    const viewMode = this.route.snapshot.queryParams['view'] === 'true';

    this.searcherService
      .getMySearch()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (search) => {
          this.isLoading = false;
          if (search) {
            this.isNewSearch = false;
            this.currentSearchId = search.id;
            this.populateForm(search);

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
          // If no search exists, that's fine - we're creating a new one
          if (err.status !== 404) {
            console.error('Error loading search:', err);
          }
          // Initialize Google Places if on step 1
          if (this.currentStep === 1) {
            this.initGooglePlacesForStep1();
          }
        },
      });
  }

  private populateForm(search: Search): void {
    // Populate zones
    this.zones = search.zones.map((zone) => ({
      id: zone.id,
      latitude: zone.latitude,
      longitude: zone.longitude,
      radius: zone.radius,
      label: zone.label,
    }));

    // Convert date strings to Date objects for p-calendar (date-only semantics)
    let startDate = normalizeApiDate(search.searchStartDate, this.minDateObj);
    let endDate = normalizeApiDate(search.searchEndDate, this.defaultEndDateObj);

    // Ajuster les dates si elles sont dans le passé (le p-calendar n'accepte pas les dates < minDate)
    if (startDate < this.minDateObj) {
      startDate = this.minDateObj;
    }
    if (endDate < this.minDateObj) {
      endDate = this.defaultEndDateObj;
    }

    this.searchForm.patchValue({
      zones: this.zones,
      searchStartDate: startDate,
      searchEndDate: endDate,
      minRent: search.minRent,
      maxRent: search.maxRent,
      minRoomSurface: search.minRoomSurface,
      maxRoomSurface: search.maxRoomSurface,
      minRoomNb: search.minRoomNb,
      maxRoomNb: search.maxRoomNb,
      homeTypes: search.homeTypes || [],
    });
  }

  // ==================== GOOGLE PLACES AUTOCOMPLETE ====================

  /**
   * Initialise Google Places UNIQUEMENT sur l'étape 1
   */
  private async initGooglePlacesForStep1(): Promise<void> {
    console.log('[DEBUG] initGooglePlacesForStep1 called');
    console.log('[DEBUG] googleApiInitialized:', this.googleApiInitialized);


    if (this.googleApiInitialized) {
      console.log('[DEBUG] API already initialized, setting up input listener');
      this.setupInputListener();
      return;
    }

    try {
      console.log('[DEBUG] Loading Google Maps API...');
      await this.googlePlacesService.loadGoogleMapsApi(environment.googleMapsApiKey);
      console.log('[DEBUG] Google Maps API loaded successfully');
      this.googleApiInitialized = true;
      this.setupInputListener();
    } catch (error) {
      console.error('[DEBUG] Erreur chargement Google Places:', error);
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
    console.log('[DEBUG] setupInputListener called');
    this.inputSubscription$.next(); // Cleanup précédent

    setTimeout(() => {
      console.log('[DEBUG] setTimeout callback executing');

      if (!this.zoneInputRef?.nativeElement) {
        console.error('[DEBUG] zoneInputRef.nativeElement is NULL - input not found!');
        return;
      }

      const input = this.zoneInputRef.nativeElement;
      console.log('[DEBUG] Input element found:', input);

      // Input avec debounce - utilise map pour extraire la valeur
      fromEvent<Event>(input, 'input').pipe(
        takeUntil(this.inputSubscription$),
        takeUntil(this.destroy$),
        debounceTime(this.DEBOUNCE_MS),
        map((event: Event) => (event.target as HTMLInputElement).value.trim()),
        distinctUntilChanged(),
        filter((value: string) => {
          console.log('[DEBUG] Input value after debounce:', value, 'length:', value.length);
          return value.length >= this.MIN_CHARS_FOR_SEARCH || value.length === 0;
        }),
        switchMap((value: string) => {
          console.log('[DEBUG] switchMap - value:', value);
          if (value.length < this.MIN_CHARS_FOR_SEARCH) {
            this.predictions = [];
            this.showPredictions = false;
            return Promise.resolve([] as PlacePrediction[]);
          }
          this.isLoadingPredictions = true;
          console.log('[DEBUG] Calling googlePlacesService.getPredictions with:', value);
          return this.googlePlacesService.getPredictions(value, { country: 'fr', types: ['geocode'] })
            .catch(err => {
              console.error('[DEBUG] getPredictions error:', err);
              return [] as PlacePrediction[]; // Retourne un tableau vide en cas d'erreur, ne casse pas le flux
            });
        })
      ).subscribe({
        next: predictions => {
          console.log('[DEBUG] Predictions received:', predictions);
          this.predictions = predictions;
          this.showPredictions = predictions.length > 0;
          this.isLoadingPredictions = false;
          this.selectedPredictionIndex = -1;
        },
        error: (err) => {
          console.error('[DEBUG] Subscription error:', err);
          this.isLoadingPredictions = false;
        }
      });

      console.log('[DEBUG] Input event listener set up successfully');

      // Blur pour fermer
      fromEvent(input, 'blur').pipe(
        takeUntil(this.inputSubscription$),
        takeUntil(this.destroy$),
        debounceTime(200)
      ).subscribe(() => {
        console.log('[DEBUG] Blur event - hiding predictions');
        this.showPredictions = false;
      });

      // Focus pour réouvrir
      fromEvent(input, 'focus').pipe(
        takeUntil(this.inputSubscription$),
        takeUntil(this.destroy$)
      ).subscribe(() => {
        console.log('[DEBUG] Focus event - predictions.length:', this.predictions.length);
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
    console.log('[DEBUG] onKeyDown called - key:', event.key, 'showPredictions:', this.showPredictions, 'predictions.length:', this.predictions.length);
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
    console.log('[DEBUG] selectPrediction called with:', prediction);
    if (this.zones.length >= MAX_SEARCH_ZONES) {
      this.snackBar.open(`Maximum ${MAX_SEARCH_ZONES} zones.`, 'Fermer', {
        duration: 4000,
        panelClass: ['custom-snackbar-action-error']
      });
      return;
    }

    try {
      this.isLoadingPredictions = true;

      console.log('[DEBUG] Calling getPlaceDetails for placeId:', prediction.placeId);
      const details = await this.googlePlacesService.getPlaceDetails(prediction.placeId);
      console.log('[DEBUG] getPlaceDetails result:', details);
      this.addZoneFromDetails(details);

      if (this.zoneInputRef?.nativeElement) {
        this.zoneInputRef.nativeElement.value = '';
      }
      this.predictions = [];
      this.showPredictions = false;
      this.isLoadingPredictions = false;
    } catch (error) {
      console.error('[DEBUG] selectPrediction error:', error);
      this.isLoadingPredictions = false;
      this.snackBar.open('Erreur lors de la sélection.', 'Fermer', { duration: 3000 });
    }
  }

  private addZoneFromDetails(details: PlaceDetails): void {
    const newZone: SearchZone = {
      latitude: details.latitude,
      longitude: details.longitude,
      radius: details.radius,
      label: details.formattedAddress,
    };

    const isDuplicate = this.zones.some(z =>
      z.label === newZone.label || (z.latitude === newZone.latitude && z.longitude === newZone.longitude)
    );

    if (isDuplicate) {
      this.snackBar.open('Zone déjà ajoutée.', 'Fermer', { duration: 3000 });
      return;
    }

    this.zones.push(newZone);
    this.searchForm.patchValue({ zones: this.zones });
    this.searchForm.get('zones')?.markAsTouched();
  }

  // Track by pour optimisation ngFor
  trackByPredictionId(index: number, prediction: PlacePrediction): string {
    return prediction.placeId;
  }

  removeZone(index: number): void {
    this.zones.splice(index, 1);
    this.searchForm.patchValue({ zones: this.zones });
    this.searchForm.get('zones')?.markAsTouched();
  }

  // ==================== HOUSING TYPES ====================

  isHomeTypeSelected(type: HomeType): boolean {
    const selected = this.searchForm.get('homeTypes')?.value || [];
    return selected.includes(type);
  }

  toggleHomeType(type: HomeType): void {
    const selected = [...(this.searchForm.get('homeTypes')?.value || [])];
    const index = selected.indexOf(type);

    if (index > -1) {
      selected.splice(index, 1);
    } else {
      selected.push(type);
    }

    this.searchForm.patchValue({ homeTypes: selected });
  }

  getSelectedHomeTypesLabels(): string {
    const selected = this.searchForm.get('homeTypes')?.value || [];
    if (selected.length === 0) return 'Tous types';

    return selected
      .map((type: HomeType) => {
        const option = this.homeTypeOptions.find((opt) => opt.value === type);
        return option?.label || type;
      })
      .join(', ');
  }

  // ==================== STEP NAVIGATION ====================

  nextStep(): void {
    if (this.currentStep === 1 && this.isStep1Valid()) {
      this.currentStep = 2;
      this.inputSubscription$.next(); // Cleanup listeners
    } else if (this.currentStep === 2 && this.isStep2Valid()) {
      this.saveSearch();
    }
  }

  previousStep(): void {
    if (this.currentStep > 1) {
      const previousStep = (this.currentStep - 1) as FormStep;
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
        const wasNotStep1 = this.currentStep !== 1;
        this.currentStep = step as FormStep;
        // Re-init Google Places if going to step 1
        if (this.currentStep === 1 && wasNotStep1) {
          this.initGooglePlacesForStep1();
        }
      }
    }
  }

  private isStep1Valid(): boolean {
    const step1Controls = ['zones', 'searchStartDate', 'searchEndDate'];
    let isValid = true;

    step1Controls.forEach((controlName) => {
      const control = this.searchForm.get(controlName);
      control?.markAsTouched();
      if (control?.invalid) {
        isValid = false;
      }
    });

    // Also check zones array
    if (this.zones.length < 1) {
      this.snackBar.open('Veuillez ajouter au moins une zone de recherche.', 'Fermer', {
        duration: 4000,
        panelClass: ['custom-snackbar-action-error'],
      });
      return false;
    }

    return isValid;
  }

  private isStep2Valid(): boolean {
    const step2Controls = ['minRent', 'maxRent', 'minRoomSurface', 'maxRoomSurface', 'minRoomNb', 'maxRoomNb'];
    let isValid = true;

    step2Controls.forEach((controlName) => {
      const control = this.searchForm.get(controlName);
      control?.markAsTouched();
      if (control?.invalid) {
        isValid = false;
      }
    });

    return isValid;
  }

  private saveSearch(): void {
    this.isLoading = true;

    const formValues = this.searchForm.value;

    const payload: CreateSearchPayload = {
      minRent: formValues.minRent || null,
      maxRent: formValues.maxRent,
      minRoomSurface: formValues.minRoomSurface || null,
      maxRoomSurface: formValues.maxRoomSurface || null,
      minRoomNb: formValues.minRoomNb || null,
      maxRoomNb: formValues.maxRoomNb || null,
      homeTypes: formValues.homeTypes?.length > 0 ? formValues.homeTypes : undefined,
      searchStartDate: formatLocalYmd(ensureDate(formValues.searchStartDate)),
      searchEndDate: formatLocalYmd(ensureDate(formValues.searchEndDate)),
      clientTimeZone: getClientTimeZone(),
      zones: this.zones.map((z) => ({
        latitude: z.latitude,
        longitude: z.longitude,
        radius: z.radius,
        label: z.label,
      })),
    };

    const saveObservable =
      this.isNewSearch || !this.currentSearchId
        ? this.searcherService.createSearch(payload)
        : this.searcherService.updateSearch(this.currentSearchId, payload);

    saveObservable.pipe(takeUntil(this.destroy$)).subscribe({
      next: (search) => {
        this.isLoading = false;
        this.currentSearchId = search.id;
        this.isNewSearch = false;
        this.showSuccessMessage = true;
        this.currentStep = 3;
      },
      error: (err) => {
        this.isLoading = false;
        this.snackBar.open(err.message || 'Erreur lors de la sauvegarde.', 'Fermer', {
          duration: 4000,
          panelClass: ['custom-snackbar-action-error'],
        });
      },
    });
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
    // Sauvegarder les valeurs AVANT de changer d'étape
    let currentStartDate = this.searchForm.get('searchStartDate')?.value;
    let currentEndDate = this.searchForm.get('searchEndDate')?.value;

    // Ajuster la date de début si elle est dans le passé (< minDateObj)
    if (currentStartDate && currentStartDate < this.minDateObj) {
      currentStartDate = this.minDateObj;
    }

    // Ajuster la date de fin si elle est dans le passé ou avant la date de début
    if (currentEndDate && currentEndDate < this.minDateObj) {
      currentEndDate = this.defaultEndDateObj;
    }

    this.currentStep = 1;
    this.showSuccessMessage = false;

    // Forcer la détection de changement pour que le DOM soit mis à jour
    this.cdr.detectChanges();

    // Re-patch après que le p-calendar soit rendu
    setTimeout(() => {
      // Forcer setValue avec emitEvent pour s'assurer que le p-calendar reçoit la valeur
      this.searchForm.get('searchStartDate')?.setValue(currentStartDate, { emitEvent: true });
      this.searchForm.get('searchEndDate')?.setValue(currentEndDate, { emitEvent: true });
      this.cdr.detectChanges();
      this.initGooglePlacesForStep1();
    }, 50);
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  // ==================== HELPERS ====================

  formatDate(dateValue: string | Date): string {
    if (!dateValue) return '';
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  getFieldError(fieldName: string): string | null {
    const control = this.searchForm.get(fieldName);
    if (control?.touched && control?.errors) {
      const errorKey = Object.keys(control.errors)[0];
      return this.errorMessages[fieldName]?.[errorKey] || null;
    }
    return null;
  }

  get canAddMoreZones(): boolean {
    return this.zones.length < MAX_SEARCH_ZONES;
  }

  get zonesHelperText(): string {
    if (this.zones.length === 0) {
      return 'Ajoutez au moins une zone de recherche';
    }
    return `${this.zones.length}/${MAX_SEARCH_ZONES} zones`;
  }

  // Format radius for display
  formatRadius(radiusInMeters: number): string {
    if (radiusInMeters >= 1000) {
      return `${(radiusInMeters / 1000).toFixed(1)} km`;
    }
    return `${radiusInMeters} m`;
  }

  // Get summary text for zones
  getZonesSummary(): string {
    if (this.zones.length === 0) return 'Aucune zone';
    if (this.zones.length === 1) return this.zones[0].label;
    return `${this.zones[0].label} (+${this.zones.length - 1} autre${this.zones.length > 2 ? 's' : ''})`;
  }

  // Get budget summary
  getBudgetSummary(): string {
    const min = this.searchForm.get('minRent')?.value;
    const max = this.searchForm.get('maxRent')?.value;

    if (min && max) {
      return `${min} € - ${max} € / mois`;
    } else if (max) {
      return `Max ${max} € / mois`;
    }
    return 'Non défini';
  }

  // Get surface summary
  getSurfaceSummary(): string {
    const min = this.searchForm.get('minRoomSurface')?.value;
    const max = this.searchForm.get('maxRoomSurface')?.value;

    if (min && max) {
      return `${min} - ${max} m²`;
    } else if (min) {
      return `Min ${min} m²`;
    } else if (max) {
      return `Max ${max} m²`;
    }
    return 'Non défini';
  }

  // Get rooms summary
  getRoomsSummary(): string {
    const min = this.searchForm.get('minRoomNb')?.value;
    const max = this.searchForm.get('maxRoomNb')?.value;

    if (min && max) {
      return `${min} - ${max} pièces`;
    } else if (min) {
      return `Min ${min} pièces`;
    } else if (max) {
      return `Max ${max} pièces`;
    }
    return 'Non défini';
  }

  // Get period summary
  getPeriodSummary(): string {
    const start = this.searchForm.get('searchStartDate')?.value;
    const end = this.searchForm.get('searchEndDate')?.value;

    if (start && end) {
      return `Du ${this.formatDate(start)} au ${this.formatDate(end)}`;
    }
    return 'Non défini';
  }
}
