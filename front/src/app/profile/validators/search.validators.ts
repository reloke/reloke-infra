import { AbstractControl, ValidationErrors, ValidatorFn, FormGroup } from '@angular/forms';
import { ensureDate, ymdKeyFromDate } from '../utils/date-utils';

/**
 * Validator that checks if a date is not in the past
 */
export function notInPastValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }

    const inputDate = ensureDate(control.value);
    const today = new Date();

    if (ymdKeyFromDate(inputDate) < ymdKeyFromDate(today)) {
      return { notInPast: true };
    }

    return null;
  };
}

/**
 * Validator that checks if end date is after start date
 */
export function endDateAfterStartValidator(startDateControlName: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }

    const parent = control.parent as FormGroup;
    if (!parent) {
      return null;
    }

    const startDateControl = parent.get(startDateControlName);
    if (!startDateControl?.value) {
      return null;
    }

    const startDate = ensureDate(startDateControl.value);
    const endDate = ensureDate(control.value);

    if (ymdKeyFromDate(endDate) < ymdKeyFromDate(startDate)) {
      return { beforeStart: true };
    }

    return null;
  };
}

/**
 * Validator that checks if min value is less than or equal to max value
 */
export function minLessThanMaxValidator(maxControlName: string): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (control.value === null || control.value === undefined || control.value === '') {
      return null;
    }

    const parent = control.parent as FormGroup;
    if (!parent) {
      return null;
    }

    const maxControl = parent.get(maxControlName);
    if (!maxControl?.value && maxControl?.value !== 0) {
      return null;
    }

    const minValue = Number(control.value);
    const maxValue = Number(maxControl.value);

    if (minValue > maxValue) {
      return { greaterThanMax: true };
    }

    return null;
  };
}

/**
 * Validator that ensures a value is strictly positive (> 0)
 */
export function strictlyPositiveValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (control.value === null || control.value === undefined || control.value === '') {
      return null;
    }

    const value = Number(control.value);
    if (value <= 0) {
      return { min: true };
    }

    return null;
  };
}

/**
 * Validator that ensures zones array has at least one zone
 */
export function minZonesValidator(minZones: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const zones = control.value;
    if (!zones || !Array.isArray(zones) || zones.length < minZones) {
      return { required: true };
    }
    return null;
  };
}

/**
 * Validator that ensures zones array doesn't exceed max zones
 */
export function maxZonesValidator(maxZones: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const zones = control.value;
    if (zones && Array.isArray(zones) && zones.length > maxZones) {
      return { maxZones: true };
    }
    return null;
  };
}
