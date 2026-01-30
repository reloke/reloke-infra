import { Injectable } from '@angular/core';
import { environment } from 'src/environments/environment';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

declare const grecaptcha: any;

@Injectable({
  providedIn: 'root'
})
export class CaptchaService {
  private siteKey = environment.RECAPTCHA_ACCESS_KEY;
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  async execute(action: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // @ts-ignore
      grecaptcha.ready(async () => {
        try {
          // @ts-ignore
          const token = await grecaptcha.execute(this.siteKey, { action });
          resolve(token);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  verifyCaptcha(captchaToken: string): Observable<{ verificationToken: string }> {
    return this.http.post<{ verificationToken: string }>(`${this.apiUrl}/captcha/verify`, { captchaToken });
  }
}
