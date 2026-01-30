import {
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
  FormGroup,
} from '@angular/forms';

/**
 * Validateur pour vérifier qu'une adresse a été sélectionnée via Google Autocomplete
 */
export function addressSelectedValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    if (!value || typeof value !== 'object') {
      return null; // Le required validator gère le cas vide
    }

    if (!value.placeId) {
      return { addressNotSelected: true };
    }

    return null;
  };
}

/**
 * Validateur pour les valeurs strictement positives (> 0)
 */
export function strictlyPositiveValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    if (value === null || value === undefined || value === '') {
      return null; // Le required validator gère le cas vide
    }

    const numValue = Number(value);

    if (isNaN(numValue)) {
      return { notANumber: true };
    }

    if (numValue === 0) {
      return { isZero: true };
    }

    if (numValue < 0) {
      return { isNegative: true };
    }

    return null;
  };
}

/**
 * Validateur pour les dates qui ne doivent pas être dans le passé
 */
export function notInPastValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    if (!value) {
      return null; // Le champ est optionnel ou required le gère
    }

    const inputDate = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (inputDate < today) {
      return { dateInPast: true };
    }

    return null;
  };
}



/**
 * Messages d'erreur pour les champs du formulaire
 */
export const HOME_FORM_ERROR_MESSAGES: Record<string, Record<string, string>> =
  {
    address: {
      required: "L'adresse est obligatoire.",
      addressNotSelected:
        'Veuillez sélectionner une adresse complète dans la liste proposée.',
    },
    homeType: {
      required: 'Le type de logement est obligatoire.',
    },
    nbRooms: {
      required: 'Le nombre de pièces est obligatoire.',
      min: 'Le nombre de pièces doit être au moins 1.',
    },
    surface: {
      required: 'La surface est obligatoire.',
      isZero: 'La surface ne peut pas être égale à 0.',
      isNegative: 'La surface ne peut pas être négative.',
      notANumber: 'La surface doit être un nombre valide.',
    },
    rent: {
      required: 'Le loyer est obligatoire.',
      isZero: 'Le loyer ne peut pas être égal à 0.',
      isNegative: 'Le loyer ne peut pas être négatif.',
      notANumber: 'Le loyer doit être un nombre valide.',
    },
    entryDate: {
      dateInPast: "La date d'entrée ne peut pas être antérieure à aujourd'hui.",
    },

    description: {
      maxlength: 'La description ne peut pas dépasser 1000 caractères.',
    },
  };
