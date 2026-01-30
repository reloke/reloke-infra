import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-match-criteria-modal',
  templateUrl: './match-criteria-modal.component.html',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['./match-criteria-modal.component.scss'],
})
export class MatchCriteriaModalComponent implements OnChanges {
  @Input() match: any;
  @Input() isOpen: boolean = false;
  @Input() isLoading: boolean = false;
  @Output() close = new EventEmitter<void>();

  criteriaVm: any = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['match'] || changes['isOpen']) {
      if (this.isOpen && this.match) {
        this.buildCriteriaVm();
      }
    }
  }

  onClose() {
    this.close.emit();
  }

  getHomeTypeLabel(homeType: string): string {
    const labels: { [key: string]: string } = {
      CHAMBRE: 'Chambre',
      STUDIO: 'Studio',
      T1: 'T1',
      T1_BIS: 'T1 bis',
      T2: 'T2',
      T2_BIS: 'T2 bis',
      T3: 'T3',
      T3_BIS: 'T3 bis',
      T4: 'T4',
      T5: 'T5',
      T6_PLUS: 'T6+',
    };
    return labels[homeType] || homeType;
  }

  private buildCriteriaVm(): void {
    const snapshot: any = this.match?.snapshot;

    console.log('[CriteriaModal] buildCriteriaVm() start', {
      matchType: this.match?.type,
      snapshotVersion: snapshot?.snapshotVersion,
      hasSeekerSearch: !!snapshot?.seekerSearch,
      hasSeekerZones: Array.isArray(snapshot?.seekerZones),
      hasTriangleSearches: !!snapshot?.searches,
      seekerIntentId: this.match?.seekerIntentId,
      targetIntentId: this.match?.targetIntentId,
      searchesKeys: snapshot?.searches ? Object.keys(snapshot.searches) : [],
    });

    if (!snapshot) {
      this.criteriaVm = null;
      return;
    }

    // STANDARD (snapshotVersion 1)
    if (
      this.match?.type !== 'TRIANGLE' &&
      (snapshot.seekerSearch || snapshot.seekerZones)
    ) {
      const search = snapshot?.seekerSearch;
      const zones = snapshot?.seekerZones ?? [];

      if (!search && (!zones || zones.length === 0)) {
        this.criteriaVm = null;
        return;
      }

      const start = this.parseDate(search?.searchStartDate);
      const end = this.parseDate(search?.searchEndDate);

      this.criteriaVm = {
        zones: Array.isArray(zones)
          ? zones.map((z: any) => ({
              label: z?.label ?? 'Zone',
              radiusLabel: this.formatRadius(z?.radius),
            }))
          : [],
        periodStartLabel: start
          ? `Du ${this.formatDate(start)}`
          : 'Début non renseigné',
        periodEndLabel: end
          ? `Au ${this.formatDate(end)}`
          : 'Fin non renseignée',
        minRent: this.toNumberOrNull(search?.minRent),
        maxRent: this.toNumberOrNull(search?.maxRent),
        budgetLabel: this.formatMoneyRange(search?.minRent, search?.maxRent),
        surfaceLabel: this.formatRange(
          search?.minSurface,
          search?.maxSurface,
          'm²'
        ),
        roomsLabel: this.formatRange(
          search?.minRooms,
          search?.maxRooms,
          'pièces'
        ),
        homeTypes: Array.isArray(search?.homeTypes) ? search.homeTypes : [],
      };

      console.log('[CriteriaModal] STANDARD criteriaVm built', this.criteriaVm);
      return;
    }

    // TRIANGLE (snapshotVersion 2)
    // snapshot.searches est un map : { "15": { zones, maxRent, ... }, "16": {...}, ... }
    const searchesMap = snapshot?.searches;
    if (!searchesMap || typeof searchesMap !== 'object') {
      console.warn(
        '[CriteriaModal] TRIANGLE: snapshot.searches missing -> criteriaVm null'
      );
      this.criteriaVm = null;
      return;
    }

    // Dans tes données, la clé correspond à intentId (souvent identique à homeId) : "15", "16", "17"
    const seekerKey =
      this.match?.seekerIntentId != null
        ? String(this.match.seekerIntentId)
        : null;

    const search = seekerKey ? searchesMap[seekerKey] : null;

    console.log('[CriteriaModal] TRIANGLE resolved seekerKey/search', {
      seekerKey,
      found: !!search,
      availableKeys: Object.keys(searchesMap),
    });

    if (!search) {
      // fallback brut : prendre le 1er search si jamais incohérence
      const firstKey = Object.keys(searchesMap)[0];
      const fallback = firstKey ? searchesMap[firstKey] : null;

      console.warn(
        '[CriteriaModal] TRIANGLE: search not found for seekerKey, fallback to firstKey',
        {
          firstKey,
          fallbackFound: !!fallback,
        }
      );

      if (!fallback) {
        this.criteriaVm = null;
        return;
      }

      this.buildCriteriaVmFromTriangleSearch(fallback);
      return;
    }

    this.buildCriteriaVmFromTriangleSearch(search);
  }

  private buildCriteriaVmFromTriangleSearch(search: any): void {
    const zones = Array.isArray(search?.zones) ? search.zones : [];

    const start = this.parseDate(search?.searchStartDate);
    const end = this.parseDate(search?.searchEndDate);

    this.criteriaVm = {
      zones: zones.map((z: any) => ({
        label: z?.label ?? 'Zone',
        radiusLabel: this.formatRadius(z?.radius),
      })),
      periodStartLabel: start
        ? `Du ${this.formatDate(start)}`
        : 'Début non renseigné',
      periodEndLabel: end ? `Au ${this.formatDate(end)}` : 'Fin non renseignée',

      // TRIANGLE utilise maxRent/minRent/maxRooms... mêmes noms mais pas "seekerSearch"
      minRent: this.toNumberOrNull(search?.minRent),
      maxRent: this.toNumberOrNull(search?.maxRent),
      budgetLabel: this.formatMoneyRange(search?.minRent, search?.maxRent),
      surfaceLabel: this.formatRange(
        search?.minSurface,
        search?.maxSurface,
        'm²'
      ),
      roomsLabel: this.formatRange(
        search?.minRooms,
        search?.maxRooms,
        'pièces'
      ),
      homeTypes: Array.isArray(search?.homeTypes) ? search.homeTypes : [],
    };

    console.log('[CriteriaModal] TRIANGLE criteriaVm built', this.criteriaVm);
  }

  private formatDate(dateStr?: string | Date): string {
    if (!dateStr) return '';
    const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  private formatRange(min: any, max: any, unit: string): string {
    const a = this.toNumberOrNull(min);
    const b = this.toNumberOrNull(max);
    if (a === null && b === null) return 'Non renseigné';
    if (a !== null && b !== null) return `${a}-${b} ${unit}`;
    if (a !== null) return `À partir de ${a} ${unit}`;
    return `Jusqu’à ${b} ${unit}`;
  }

  private formatMoneyRange(min: any, max: any): string {
    const a = this.toNumberOrNull(min);
    const b = this.toNumberOrNull(max);
    if (a === null && b === null) return 'Non renseigné';
    if (a !== null && b !== null) return `${a}-${b} € /mois`;
    if (a !== null) return `À partir de ${a} € /mois`;
    return `Jusqu’à ${b} € /mois`;
  }

  private formatRadius(radiusMeters: any): string {
    const r = this.toNumberOrNull(radiusMeters);
    if (r === null) return '?';
    if (r < 1000) return `${Math.round(r)} m`;
    return `${(r / 1000).toFixed(1)} km`;
  }

  private parseDate(value: any): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  private toNumberOrNull(value: any): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
}
