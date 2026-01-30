import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class CameraService implements OnDestroy {
    private mediaStream: MediaStream | null = null;
    private isActiveSubject = new BehaviorSubject<boolean>(false);
    public isActive$ = this.isActiveSubject.asObservable();

    constructor() { }

    async startCamera(constraints: MediaStreamConstraints = { video: { facingMode: 'user' } }): Promise<MediaStream> {
        try {
            this.stopCamera(); // Ensure previous stream is stopped
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.isActiveSubject.next(true);
            return this.mediaStream;
        } catch (error) {
            this.isActiveSubject.next(false);
            throw error;
        }
    }

    stopCamera() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
            this.mediaStream = null;
        }
        this.isActiveSubject.next(false);
    }

    captureSnapshot(videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement): Promise<Blob | null> {
        return new Promise((resolve) => {
            const context = canvasElement.getContext('2d', { willReadFrequently: true });
            if (!context) {
                resolve(null);
                return;
            }

            canvasElement.width = videoElement.videoWidth;
            canvasElement.height = videoElement.videoHeight;
            context.drawImage(videoElement, 0, 0);

            canvasElement.toBlob((blob) => {
                resolve(blob);
            }, 'image/jpeg', 0.85);
        });
    }

    ngOnDestroy() {
        this.stopCamera();
    }
}
