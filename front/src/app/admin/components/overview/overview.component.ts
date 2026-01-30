import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  AdminService,
  FinancialStats,
  TimeSeriesResponse,
  TimeSeriesPeriod,
  TimeSeriesDataPoint
} from '../../../core/services/admin.service';

@Component({
  selector: 'app-admin-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './overview.component.html',
  styles: [`
    :host { display: block; }
    .chart-bar {
      transition: height 0.3s ease-out, background-color 0.2s;
    }
    .chart-bar:hover {
      filter: brightness(1.1);
    }
  `]
})
export class OverviewComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Basic stats
  stats: any;
  statsLoading = true;

  // Financial stats
  financialStats: FinancialStats | null = null;
  financialLoading = true;

  // Time series data
  timeSeriesData: TimeSeriesResponse | null = null;
  timeSeriesLoading = true;
  selectedPeriod: TimeSeriesPeriod = 'day';
  periods: { value: TimeSeriesPeriod; label: string }[] = [
    { value: 'day', label: 'Jour' },
    { value: 'week', label: 'Semaine' },
    { value: 'month', label: 'Mois' },
    { value: 'year', label: 'Annee' }
  ];

  // Chart display options
  showRevenueChart = true; // true = revenue, false = matches count

  constructor(private adminService: AdminService) { }

  ngOnInit() {
    this.loadStats();
    this.loadFinancialStats();
    this.loadTimeSeries();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStats() {
    this.statsLoading = true;
    this.adminService.getStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.stats = data;
          this.statsLoading = false;
        },
        error: () => {
          this.statsLoading = false;
        }
      });
  }

  loadFinancialStats() {
    this.financialLoading = true;
    this.adminService.getFinancialStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.financialStats = data;
          this.financialLoading = false;
        },
        error: () => {
          this.financialLoading = false;
        }
      });
  }

  loadTimeSeries() {
    this.timeSeriesLoading = true;
    this.adminService.getFinancialTimeSeries(this.selectedPeriod)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.timeSeriesData = data;
          this.timeSeriesLoading = false;
        },
        error: () => {
          this.timeSeriesLoading = false;
        }
      });
  }

  onPeriodChange(period: TimeSeriesPeriod) {
    this.selectedPeriod = period;
    this.loadTimeSeries();
  }

  toggleChartType() {
    this.showRevenueChart = !this.showRevenueChart;
  }

  // Chart helpers
  getMaxValue(type: 'used' | 'refunded'): number {
    if (!this.timeSeriesData?.data) return 0;

    if (this.showRevenueChart) {
      return Math.max(
        ...this.timeSeriesData.data.map(d =>
          type === 'used' ? parseFloat(d.revenueUsed) : parseFloat(d.revenueRefunded)
        ),
        1 // Minimum to avoid division by zero
      );
    } else {
      return Math.max(
        ...this.timeSeriesData.data.map(d =>
          type === 'used' ? d.matchesUsed : d.matchesRefunded
        ),
        1
      );
    }
  }

  getBarHeight(dataPoint: TimeSeriesDataPoint, type: 'used' | 'refunded'): number {
    const maxValue = this.getMaxValue(type);
    let value: number;

    if (this.showRevenueChart) {
      value = type === 'used' ? parseFloat(dataPoint.revenueUsed) : parseFloat(dataPoint.revenueRefunded);
    } else {
      value = type === 'used' ? dataPoint.matchesUsed : dataPoint.matchesRefunded;
    }

    return (value / maxValue) * 100;
  }

  getBarValue(dataPoint: TimeSeriesDataPoint, type: 'used' | 'refunded'): string {
    if (this.showRevenueChart) {
      const value = type === 'used' ? dataPoint.revenueUsed : dataPoint.revenueRefunded;
      return `${value} EUR`;
    } else {
      const value = type === 'used' ? dataPoint.matchesUsed : dataPoint.matchesRefunded;
      return `${value}`;
    }
  }

  formatDateLabel(dateStr: string): string {
    if (!dateStr) return '';

    // Handle different formats
    if (dateStr.length === 4) {
      // Year only
      return dateStr;
    } else if (dateStr.length === 7) {
      // Month (YYYY-MM)
      const [year, month] = dateStr.split('-');
      const months = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aout', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${months[parseInt(month) - 1]} ${year.slice(2)}`;
    } else {
      // Day (YYYY-MM-DD)
      const date = new Date(dateStr);
      return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    }
  }

  // Format currency with proper thousands separator
  formatCurrency(value: string | number): string {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  }

  // Format number with proper thousands separator
  formatNumber(value: number): string {
    return new Intl.NumberFormat('fr-FR').format(value);
  }
}
