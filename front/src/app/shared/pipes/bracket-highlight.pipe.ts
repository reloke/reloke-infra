import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
    name: 'bracketHighlight',
    pure: true,
    standalone: true
})
export class BracketHighlightPipe implements PipeTransform {
    constructor(private sanitizer: DomSanitizer) { }

    transform(text: string): SafeHtml {
        if (!text) return '';

        // Escape HTML first to prevent XSS
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

        // Highlight text between brackets [...]
        const highlighted = escaped.replace(
            /\[([^\]]+)\]/g,
            '<span class="font-bold text-primary bg-primary/10 px-1 rounded">[$1]</span>'
        );

        return this.sanitizer.bypassSecurityTrustHtml(highlighted);
    }
}
