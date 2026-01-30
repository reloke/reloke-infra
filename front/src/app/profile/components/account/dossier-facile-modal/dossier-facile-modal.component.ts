import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { SharedModule } from 'src/app/shared/shared.module';
import { DossierFacileService } from 'src/app/core/services/dossier-facile.service';

@Component({
    selector: 'app-dossier-facile-modal',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, SharedModule],
    styleUrls: ['./dossier-facile-modal.component.scss'],
    templateUrl: './dossier-facile-modal.component.html'
})
export class DossierFacileModalComponent implements OnInit, OnChanges {
    @Input() isOpen = false;
    @Input() initialUrl: string | null = null;
    @Output() close = new EventEmitter<void>();
    @Output() saved = new EventEmitter<void>();

    form: FormGroup;
    isSubmitting = false;
    error: string | null = null;
    isEditing = false;

    requiredDocs: { label: string, url: string }[] = [
        { label: "Pièce d'identité", url: "https://aide.dossierfacile.logement.gouv.fr/fr/article/1-piece-identite-1j6eask/" },
        { label: "Situation d'hébergement", url: "https://aide.dossierfacile.logement.gouv.fr/fr/article/2-justificatif-domicile-bon-paiement-loyers-1ftrkb8/" },
        { label: "Situation professionnelle", url: "https://aide.dossierfacile.logement.gouv.fr/fr/article/3-justificatifs-de-situation-professionnelle-rpepjc/" },
        { label: "Justificatif de ressources", url: "https://aide.dossierfacile.logement.gouv.fr/fr/article/4-justificatifs-ressources-1uyf090/" },
        { label: "Avis d'imposition", url: "https://aide.dossierfacile.logement.gouv.fr/fr/article/5-avis-dimposition-eg82wt/" },
        { label: "Justificatifs du garant", url: "https://aide.dossierfacile.logement.gouv.fr/fr/article/6-les-justificatifs-du-ou-des-garants-1nt94gc/" }
    ];

    constructor(
        private fb: FormBuilder,
        private dfService: DossierFacileService
    ) {
        this.form = this.fb.group({
            url: ['', [Validators.required]]
        });
    }

    ngOnInit() {
        this.resetForm();
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['isOpen'] && changes['isOpen'].currentValue) {
            this.resetForm();
        }
    }

    private resetForm() {
        this.error = null;
        this.isSubmitting = false;
        if (this.initialUrl) {
            this.isEditing = true;
            this.form.patchValue({ url: this.initialUrl });
        } else {
            this.isEditing = false;
            this.form.patchValue({ url: '' });
        }
    }

    onClose() {
        this.close.emit();
    }

    /**
     * Nettoyage agressif de l'URL
     */
    private normalizeUrl(input: string): string {
        let url = input.trim();
        // Enlève guillemets, backticks, espaces invisibles
        url = url.replace(/^['"`\s]+|['"`\s]+$/g, '');

        if (!url) return '';

        // Ajout protocole si absent
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }

        // Correction sous-domaines (supporte les deux domaines)
        if (url.includes('dossierfacile.logement.gouv.fr') || url.includes('dossierfacile.fr')) {
            // Remplace ww. ou wwww. par www.
            url = url.replace(/\/\/(w+)\./, (match, p1) => {
                if (p1 !== 'www' && p1 !== 'locataire') return '//www.';
                return match;
            });
            // Si pas de sous-domaine du tout (https://dossierfacile...)
            if (!url.includes('www.') && !url.includes('locataire.')) {
                url = url.replace('://dossierfacile', '://www.dossierfacile');
            }
        }
        return url;
    }

    onSubmit(event?: Event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        console.log('[DossierFacileModal] onSubmit - Bouton cliqué');

        if (this.isSubmitting) return;

        const rawUrl = this.form.value.url || '';
        const url = this.normalizeUrl(rawUrl);

        console.log('[DossierFacileModal] URL après nettoyage:', url);

        // Regex supportant les deux domaines : dossierfacile.logement.gouv.fr ET dossierfacile.fr
        const pattern = /^https?:\/\/(www|locataire)\.(dossierfacile\.logement\.gouv\.fr|dossierfacile\.fr)\/(file|public-file|links|linkds|dossier|d)\//;

        if (!pattern.test(url)) {
            this.error = "Le format du lien n'est pas reconnu. Il doit ressembler à : https://www.dossierfacile.logement.gouv.fr/file/... ou https://www.dossierfacile.fr/file/...";
            console.error('[DossierFacileModal] Format invalide pour:', url);
            return;
        }

        this.isSubmitting = true;
        this.error = null;

        this.dfService.updateUrl(url).subscribe({
            next: (res) => {
                console.log('[DossierFacileModal] Enregistrement réussi');
                this.isSubmitting = false;
                this.saved.emit();
                this.onClose();
            },
            error: (err) => {
                this.isSubmitting = false;
                this.error = err.error?.message || "Erreur de validation. Vérifiez que le dossier est bien public.";
                console.error('[DossierFacileModal] Erreur Serveur:', err);
            }
        });
    }
}
