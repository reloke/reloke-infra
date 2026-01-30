import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { environment } from '../../../environments/environment';

@Pipe({
    name: 'imageUrl',
    pure: true,
    standalone: true
})
export class ImageUrlPipe implements PipeTransform {
    constructor(private sanitizer: DomSanitizer) { }

    transform(url: string | null | undefined): string | SafeUrl {
        if (!url) {
            return 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&q=80';
        }

        if (url.startsWith('blob:')) {
            return this.sanitizer.bypassSecurityTrustUrl(url);
        }

        if (url.startsWith('http')) {
            return url;
        }

        if (url.startsWith('/')) {
            return `${environment.apiUrl}${url}`;
        }

        return `${environment.apiUrl}/uploads/${url}`;
    }
}
